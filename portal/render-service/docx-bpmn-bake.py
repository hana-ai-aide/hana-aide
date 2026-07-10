"""
FX-B (SPEC-doc-fidelity-export.md §4): 擬真 docx 交付檔 — OOXML 影像置換器.

以 source.docx 為底，只把「被辨識為流程圖」的那幾張圖元換成前端渲好的 BPMN 光柵 PNG。
純圖 / 文字 / 表格 / 版面 (header / 頁碼 / logo / 樣式) 一律不碰 —— 逐 byte 保真。

身分對位 (§13.11)：BPMN 資產檔名前綴 imageN 是 load-bearing，對應 word/media/imageN.*。
extract_flow_anchors (docx-convert.py) 從 source.docx 現場算出每張流程圖圖元的 rId + sourceMedia，
故本器以「media 檔名 stem」對位，**完全不依賴 docPr**（§13.8-5 的 docPr strip blocker 因此不咬本路徑），
也不重匯入、不改 import。對不齊 / _pending / 找不到圖元 → 跳過該圖、誠實回報，不硬猜。

置換手法（比照 image-writeback.py 的 media binary 置換，但流程圖多為 EMF/OLE，直接覆寫 EMF part
會與 [Content_Types] 的 image/x-emf 衝突而破圖）：新增一個 png media part + 一條 image 關聯 →
把該圖元的 v:imagedata@r:id（VML/OLE）或 a:blip@r:embed（DrawingML）改指向新 png →
同步等比修正尺寸（吃原圖框寬、BPMN 比例定高，比照擬真層 _placeFlowFrame）避免變形。
原 media 與 OLE 內嵌 Visio 皆保留不動（交付檔以 imagedata 預覽呈現 BPMN；真身另由 Phase C 處理）。

Usage:
  python docx-bpmn-bake.py --docx <source.docx> --out <exports/x.fidelity.docx> --manifest <m.json>
  python docx-bpmn-bake.py --docx <source.docx> --in-place --manifest <m.json>   # Phase C 覆寫真身

manifest.json = {"images":[{"stem":"image1","png":"<abs.png>","w":<px>,"h":<px>}, ...]}
Outputs JSON report to stdout: {ok, out, replaced:[...], skipped:[{stem,reason}], anchorsTotal}.
"""
import sys, os, json, argparse, importlib.util, re, shutil, zipfile

# ── 沿用既有 render-service 模組（檔名帶連字號 → 用 importlib 載入，不複製程式碼）──────────────
_HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod_name, filename):
    spec = importlib.util.spec_from_file_location(mod_name, os.path.join(_HERE, filename))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_conv = _load('docx_convert', 'docx-convert.py')          # extract_flow_anchors
_imgwb = _load('image_writeback', 'image-writeback.py')    # _read_zip / _write_zip

from lxml import etree

_R  = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
_A  = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
_WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
_CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
_IMG_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'


def _stem(media_path):
    """word/media/image1.emf → 'image1' (lower-cased for robust matching)."""
    return os.path.splitext(os.path.basename(media_path or ''))[0].lower()


def _next_rid(rids):
    """Smallest 'rIdN' not already used."""
    used = set()
    for r in rids:
        m = re.match(r'rId(\d+)$', r or '')
        if m:
            used.add(int(m.group(1)))
    n = 1
    while n in used:
        n += 1
    return 'rId%d' % n


def _find_media_ref(doc_root, rid):
    """Return (element, kind) for the drawing element that references rId as its picture:
       VML/OLE v:imagedata (attr r:id) → kind 'vml'; DrawingML a:blip (attr r:embed) → 'dml'.
       OLEObject also carries an r:id (to the embedded .bin) — filtered out by tag localname."""
    for el in doc_root.iter():
        local = el.tag.rsplit('}', 1)[-1] if '}' in el.tag else el.tag
        if local == 'imagedata' and el.get(_R + 'id') == rid:
            return el, 'vml'
        if local == 'blip' and el.get(_R + 'embed') == rid:
            return el, 'dml'
    return None, None


def _fix_vml_size(imagedata_el, w_px, h_px):
    """Keep the v:shape frame width, set height = width * (h/w). Returns True if adjusted."""
    if not w_px or not h_px:
        return False
    shape = imagedata_el.getparent()          # v:imagedata's parent is v:shape
    if shape is None:
        return False
    style = shape.get('style') or ''
    mw = re.search(r'width:\s*([0-9.]+)\s*(pt|px|in|cm|mm|pc|em)?', style, re.I)
    if not mw:
        return False
    width_val = float(mw.group(1))
    unit = mw.group(2) or 'pt'
    new_h = round(width_val * (float(h_px) / float(w_px)), 2)
    new_style, n = re.subn(r'height:\s*[0-9.]+\s*(pt|px|in|cm|mm|pc|em)?',
                           'height:%g%s' % (new_h, unit), style, count=1, flags=re.I)
    if not n:
        sep = '' if new_style.rstrip().endswith(';') or not new_style.strip() else ';'
        new_style = new_style + sep + 'height:%g%s' % (new_h, unit)
    shape.set('style', new_style)
    return True


def _fix_dml_size(blip_el, w_px, h_px):
    """Keep wp:extent/a:ext cx, set cy = cx * (h/w). Returns True if adjusted."""
    if not w_px or not h_px:
        return False
    # walk up to the enclosing w:drawing, then adjust its wp:extent + a:ext
    node = blip_el
    drawing = None
    while node is not None:
        local = node.tag.rsplit('}', 1)[-1] if '}' in node.tag else node.tag
        if local == 'drawing':
            drawing = node
            break
        node = node.getparent()
    if drawing is None:
        return False
    ratio = float(h_px) / float(w_px)
    changed = False
    ext = drawing.find('.//' + _WP + 'extent')
    if ext is not None and ext.get('cx'):
        try:
            ext.set('cy', str(int(round(int(ext.get('cx')) * ratio))))
            changed = True
        except (ValueError, TypeError):
            pass
    aext = drawing.find('.//' + _A + 'ext')
    if aext is not None and aext.get('cx'):
        try:
            aext.set('cy', str(int(round(int(aext.get('cx')) * ratio))))
            changed = True
        except (ValueError, TypeError):
            pass
    return changed


def _ensure_png_default(all_data):
    """Guarantee [Content_Types].xml declares a png Default (a real client docx already does; defensive)."""
    ct_name = '[Content_Types].xml'
    ct = all_data.get(ct_name)
    if not ct:
        return
    root = etree.fromstring(ct)
    for d in root.findall('{%s}Default' % _CT):
        if (d.get('Extension') or '').lower() == 'png':
            return
    d = etree.SubElement(root, '{%s}Default' % _CT)
    d.set('Extension', 'png')
    d.set('ContentType', 'image/png')
    all_data[ct_name] = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def bake(docx_path, out_path, images, in_place=False):
    report = {'ok': False, 'out': out_path, 'replaced': [], 'skipped': [], 'anchorsTotal': 0}

    # 1) 現場算流程圖圖元（rId + sourceMedia），建 stem → anchor
    anchors = _conv.extract_flow_anchors(docx_path)
    report['anchorsTotal'] = len(anchors)
    anchor_by_stem = {}
    for a in anchors:
        st = _stem(a.get('sourceMedia'))
        if st and st not in anchor_by_stem:      # 首見為準（media part 唯一）
            anchor_by_stem[st] = a

    # 2) 讀 zip（沿用 image-writeback 的讀寫，保留壓縮型別）
    all_data, compress = _imgwb._read_zip(docx_path)
    doc_xml = all_data.get('word/document.xml')
    rels_name = 'word/_rels/document.xml.rels'
    rels_xml = all_data.get(rels_name)
    if not doc_xml or not rels_xml:
        report['error'] = 'word/document.xml or its rels missing'
        return report

    doc_root = etree.fromstring(doc_xml)
    rels_root = etree.fromstring(rels_xml)
    existing_rids = [r.get('Id', '') for r in rels_root]
    _ensure_png_default(all_data)

    used_media = set(all_data.keys())
    n_new = 0

    for item in images:
        stem = str(item.get('stem') or '').lower()
        png_path = item.get('png')
        w_px, h_px = item.get('w'), item.get('h')
        if not stem or stem.endswith('_pending'):
            report['skipped'].append({'stem': stem, 'reason': 'pending or empty stem'})
            continue
        anchor = anchor_by_stem.get(stem)
        if not anchor:
            report['skipped'].append({'stem': stem, 'reason': 'no flowchart anchor for this stem'})
            continue
        rid = anchor.get('rid')
        el, kind = _find_media_ref(doc_root, rid)
        if el is None:
            report['skipped'].append({'stem': stem, 'reason': 'drawing element for rId %s not found' % rid})
            continue
        if not png_path or not os.path.exists(png_path):
            report['skipped'].append({'stem': stem, 'reason': 'png missing on disk'})
            continue
        with open(png_path, 'rb') as f:
            png_bytes = f.read()

        # 新 png media part（唯一命名，不覆蓋任何既有 part）
        n_new += 1
        new_part = 'word/media/hana_bpmn_%s.png' % re.sub(r'[^A-Za-z0-9_]', '_', stem)
        while new_part in used_media:
            new_part = 'word/media/hana_bpmn_%s_%d.png' % (re.sub(r'[^A-Za-z0-9_]', '_', stem), n_new)
            n_new += 1
        used_media.add(new_part)
        all_data[new_part] = png_bytes

        # 新關聯（image type），target 為 word/-relative
        new_rid = _next_rid(existing_rids)
        existing_rids.append(new_rid)
        rel = etree.SubElement(rels_root, '{%s}Relationship' % _PKG_REL)
        rel.set('Id', new_rid)
        rel.set('Type', _IMG_REL_TYPE)
        rel.set('Target', new_part[len('word/'):])   # 'media/hana_bpmn_x.png'

        # 圖元改指向新 png ＋ 等比修尺寸
        if kind == 'vml':
            el.set(_R + 'id', new_rid)
            sized = _fix_vml_size(el, w_px, h_px)
        else:
            el.set(_R + 'embed', new_rid)
            sized = _fix_dml_size(el, w_px, h_px)

        report['replaced'].append({'stem': stem, 'rid': rid, 'newRid': new_rid,
                                    'newPart': new_part, 'kind': kind, 'resized': bool(sized)})

    if not report['replaced']:
        report['error'] = 'no flowchart replaced (all skipped)'
        report['ok'] = False
        return report

    # 3) 回寫 xml → zip
    all_data['word/document.xml'] = etree.tostring(doc_root, xml_declaration=True, encoding='UTF-8', standalone=True)
    all_data[rels_name] = etree.tostring(rels_root, xml_declaration=True, encoding='UTF-8', standalone=True)

    if in_place:
        # Phase C：先寫 temp 再原子換上（避免中途壞檔）——但快照由呼叫端負責
        tmp = out_path + '.baking.tmp'
        _imgwb._write_zip(tmp, all_data, compress)
        shutil.move(tmp, out_path)
    else:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        _imgwb._write_zip(out_path, all_data, compress)

    report['ok'] = True
    return report


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='FX-B: bake BPMN rasters into a docx (OOXML image swap)')
    ap.add_argument('--docx', required=True, help='source.docx (base, read-only unless --in-place)')
    ap.add_argument('--out', help='output .fidelity.docx path (Phase B)')
    ap.add_argument('--in-place', action='store_true', dest='in_place',
                    help='overwrite --docx itself (Phase C; caller must snapshot first)')
    ap.add_argument('--manifest', required=True, help='JSON {images:[{stem,png,w,h}]}')
    args = ap.parse_args()

    if not os.path.exists(args.docx):
        print(json.dumps({'ok': False, 'error': 'docx not found: ' + args.docx}, ensure_ascii=False))
        sys.exit(1)
    try:
        manifest = json.load(open(args.manifest, encoding='utf-8'))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': 'bad manifest: ' + str(e)}, ensure_ascii=False))
        sys.exit(1)

    out = args.docx if args.in_place else args.out
    if not out:
        print(json.dumps({'ok': False, 'error': 'must give --out (Phase B) or --in-place (Phase C)'}, ensure_ascii=False))
        sys.exit(1)

    result = bake(args.docx, out, manifest.get('images', []), in_place=args.in_place)
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get('ok') else 2)
