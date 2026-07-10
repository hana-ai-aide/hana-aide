"""
L2-04: Replace an image binary in source.docx / source.pptx by its el anchor id.
  docx: el-id = wp:docPr id (e.g. "42")      -> replaces word/media/<x> binary.
  pptx: el-id = "<shapeId>/image" (e.g. "5/image") -> replaces ppt/media/<x> binary.
Usage:
  python image-writeback.py --docx <source.docx> --el-id <42>       --new-image <path>
  python image-writeback.py --pptx <source.pptx> --el-id <5/image>  --new-image <path>
Outputs JSON to stdout: {ok, media_part, size} or {ok:false, error}.
"""
import sys, os, zipfile, json, argparse
from lxml import etree

_WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
_A  = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
_R  = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def _resolve_target(target, source_dir):
    """Resolve a zip-relative relationship target path.
    target like 'media/img.png' or '../media/img.png'.
    source_dir like 'word' or 'ppt/slides'."""
    parts = (source_dir + '/' + target).split('/')
    out = []
    for p in parts:
        if p == '..':
            if out:
                out.pop()
        elif p and p != '.':
            out.append(p)
    return '/'.join(out)


def _read_zip(path):
    """Read all parts of a zip into {name: bytes} plus {name: compress_type}."""
    with zipfile.ZipFile(path, 'r') as z:
        infos = z.infolist()
        data = {i.filename: z.read(i.filename) for i in infos}
        compress = {i.filename: i.compress_type for i in infos}
    return data, compress


def _write_zip(path, all_data, compress):
    """Write all parts back to zip, preserving original compression types."""
    with zipfile.ZipFile(path, 'w') as zout:
        for name, data in all_data.items():
            info = zipfile.ZipInfo(name)
            info.compress_type = compress.get(name, zipfile.ZIP_DEFLATED)
            zout.writestr(info, data)


def replace_image_docx(docx_path, el_id, new_image_path):
    """Replace the drawing with wp:docPr id=el_id in docx_path with new image binary.
    Preserves all other media parts and XML untouched."""
    all_data, compress = _read_zip(docx_path)

    doc_xml = all_data.get('word/document.xml')
    if not doc_xml:
        return {'ok': False, 'error': 'word/document.xml not found in docx'}

    rels_xml = all_data.get('word/_rels/document.xml.rels', b'')
    rid_to_target = {}
    if rels_xml:
        for rel in etree.fromstring(rels_xml):
            rid_to_target[rel.get('Id', '')] = rel.get('Target', '')

    root = etree.fromstring(doc_xml)
    found_part = None

    for docPr in root.iter(_WP + 'docPr'):
        if str(docPr.get('id')) != str(el_id):
            continue
        # container is wp:inline or wp:anchor — parent of docPr
        container = docPr.getparent()
        if container is None:
            break
        for blip in container.iter(_A + 'blip'):
            rid = blip.get(_R + 'embed')
            if rid and rid in rid_to_target:
                found_part = _resolve_target(rid_to_target[rid], 'word')
                break
        break   # found the right docPr; stop searching

    if not found_part:
        return {'ok': False, 'error': 'el-id %s not found in document.xml or has no blip rId' % el_id}
    if found_part not in all_data:
        return {'ok': False, 'error': 'media part not in docx zip: ' + found_part}

    with open(new_image_path, 'rb') as f:
        new_bytes = f.read()
    all_data[found_part] = new_bytes

    _write_zip(docx_path, all_data, compress)
    return {'ok': True, 'media_part': found_part, 'size': len(new_bytes)}


def _ordered_slide_files(all_data):
    """Return slide part names in PRESENTATION order (sldIdLst), matching python-pptx
    Presentation.slides and the renderer's data-slide-index. Falls back to filename order."""
    import re as _re
    fallback = sorted(
        (n for n in all_data
         if n.startswith('ppt/slides/slide') and n.endswith('.xml') and '/_rels/' not in n),
        key=lambda n: int((_re.search(r'slide(\d+)\.xml$', n) or [0, 0])[1]) if _re.search(r'slide(\d+)\.xml$', n) else 0,
    )
    pres = all_data.get('ppt/presentation.xml')
    rels = all_data.get('ppt/_rels/presentation.xml.rels')
    if not pres or not rels:
        return fallback
    try:
        rid_to_target = {}
        for rel in etree.fromstring(rels):
            rid_to_target[rel.get('Id', '')] = rel.get('Target', '')
        ordered = []
        proot = etree.fromstring(pres)
        for sldId in proot.iter('{http://schemas.openxmlformats.org/presentationml/2006/main}sldId'):
            rid = sldId.get(_R + 'id')
            tgt = rid_to_target.get(rid)
            if not tgt:
                continue
            part = _resolve_target(tgt, 'ppt')     # 'slides/slideN.xml' -> 'ppt/slides/slideN.xml'
            if part in all_data:
                ordered.append(part)
        return ordered or fallback
    except Exception:
        return fallback


def replace_image_pptx(pptx_path, el_id, new_image_path):
    """Replace the picture shape with p:cNvPr id=<shapeId> in pptx_path with new image binary.
    el_id format: '<shapeId>/image' (e.g. '5/image') or '<slide>:<shapeId>/image'
    (e.g. '2:5/image'). The optional 1-based slide prefix (presentation order) disambiguates
    because a shapeId is only unique WITHIN a slide (PowerPoint restarts ids per slide)."""
    head = el_id.split('/')[0]              # '<shapeId>' or '<slide>:<shapeId>'
    slide_filter = None                     # 1-based slide number, or None = search all
    if ':' in head:
        s_part, sid_part = head.split(':', 1)
        try:
            slide_filter = int(s_part)
        except ValueError:
            slide_filter = None
        shape_id = str(sid_part)
    else:
        shape_id = str(head)

    all_data, compress = _read_zip(pptx_path)

    slide_files = _ordered_slide_files(all_data)

    found_part = None
    for slide_num, slide_file in enumerate(slide_files, start=1):
        if slide_filter is not None and slide_num != slide_filter:
            continue
        slide_root = etree.fromstring(all_data[slide_file])
        slide_name = slide_file.rsplit('/', 1)[-1]          # e.g. 'slide1.xml'
        rels_path  = 'ppt/slides/_rels/' + slide_name + '.rels'
        rid_to_target = {}
        rels_xml = all_data.get(rels_path, b'')
        if rels_xml:
            for rel in etree.fromstring(rels_xml):
                rid_to_target[rel.get('Id', '')] = rel.get('Target', '')

        for elem in slide_root.iter():
            local = elem.tag.rsplit('}', 1)[-1] if '}' in elem.tag else elem.tag
            if local == 'cNvPr' and str(elem.get('id')) == shape_id:
                # cNvPr -> nvPicPr -> pic:pic; search pic:pic for a:blip
                nvPicPr = elem.getparent()
                if nvPicPr is None:
                    continue
                pic_pic = nvPicPr.getparent()
                if pic_pic is None:
                    continue
                for blip in pic_pic.iter(_A + 'blip'):
                    rid = blip.get(_R + 'embed')
                    if rid and rid in rid_to_target:
                        found_part = _resolve_target(rid_to_target[rid], 'ppt/slides')
                        break
                if found_part:
                    break
        if found_part:
            break

    if not found_part:
        return {'ok': False, 'error': 'shape %s not found in any slide or has no blip rId' % shape_id}
    if found_part not in all_data:
        return {'ok': False, 'error': 'media part not in pptx zip: ' + found_part}

    with open(new_image_path, 'rb') as f:
        new_bytes = f.read()
    all_data[found_part] = new_bytes

    _write_zip(pptx_path, all_data, compress)
    return {'ok': True, 'media_part': found_part, 'size': len(new_bytes)}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='L2-04: Replace image binary in source docx/pptx')
    ap.add_argument('--docx', help='path to source.docx (modified in-place)')
    ap.add_argument('--pptx', help='path to source.pptx (modified in-place)')
    ap.add_argument('--el-id', required=True, dest='el_id',
                    help='el anchor id: wp:docPr id for docx (e.g. "42"); shapeId/image for pptx (e.g. "5/image")')
    ap.add_argument('--new-image', required=True, dest='new_image',
                    help='path to new image file to embed')
    args = ap.parse_args()

    if not os.path.exists(args.new_image):
        print(json.dumps({'ok': False, 'error': 'new-image not found: ' + args.new_image}))
        sys.exit(1)

    if args.docx:
        result = replace_image_docx(args.docx, args.el_id, args.new_image)
    elif args.pptx:
        result = replace_image_pptx(args.pptx, args.el_id, args.new_image)
    else:
        result = {'ok': False, 'error': 'must specify --docx or --pptx'}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get('ok') else 1)
