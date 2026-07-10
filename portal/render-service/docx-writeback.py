#!/usr/bin/env python3
# docx-writeback.py — K2/K3: run-level paragraph writeback to source.docx
# K2: per-paraId char diff → run rebuild
# K3: new-paragraph insertion (style donor), table anchor map, paragraph deletion
# Usage:
#   python docx-writeback.py --docx <source.docx> --new <new_doc.md> --base <base_doc.md>
# stdout: JSON { ok, changed, inserted, deleted, skipped, errors }

import sys, os, re, json, zipfile, copy, difflib, argparse, random as _random
from io import BytesIO
from lxml import etree

# ── OOXML namespaces ───────────────────────────────────────────────────────────
_NS_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
_NS_W   = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
_NS_XML = 'http://www.w3.org/XML/1998/namespace'
_W14 = '{%s}' % _NS_W14
_W   = '{%s}' % _NS_W
_XML = '{%s}' % _NS_XML

_ANCHOR_RE = re.compile(r'\s*<!--\s*el:([0-9A-Fa-f]+)\s*-->')


# ── MD anchor parsing (K2) ─────────────────────────────────────────────────────

def parse_md_anchors(md_content):
    """Return dict {PARA_ID_UPPER: md_line_text} for all anchored paragraphs.
    Strips front-matter. Tables are returned as their GFM text (to detect and skip later)."""
    body = md_content
    stripped = body.lstrip()
    if stripped.startswith('---'):
        end = body.find('\n---\n', 3)
        if end >= 0:
            body = body[end + 5:]

    result = {}
    lines = body.split('\n')

    for i, line in enumerate(lines):
        m = _ANCHOR_RE.search(line)
        if not m:
            continue
        para_id = m.group(1).upper()
        line_text = _ANCHOR_RE.sub('', line).rstrip()
        if line_text.strip():
            # Inline anchor — single-line paragraph
            result[para_id] = line_text.strip()
        else:
            # Standalone anchor — collect block of non-empty lines above
            block = []
            j = i - 1
            while j >= 0 and lines[j].strip():
                block.insert(0, lines[j])
                j -= 1
            result[para_id] = '\n'.join(block).strip()

    return result


def _strip_md_markup(text):
    """Strip markdown formatting markers to get plain text for char-level diff."""
    text = _ANCHOR_RE.sub('', text)        # remove anchor comments
    text = re.sub(r'^#{1,6}\s+', '', text) # heading prefixes
    # List item prefixes (with optional indentation up to 9 spaces)
    text = re.sub(r'^[ \t]{0,9}[-*+]\s+', '', text)
    text = re.sub(r'^[ \t]{0,9}\d+\.\s+', '', text)
    # Inline formatting: bold+italic, bold, italic
    text = re.sub(r'\*{3}([^*\n]+)\*{3}', r'\1', text)
    text = re.sub(r'\*{2}([^*\n]+)\*{2}', r'\1', text)
    text = re.sub(r'\*([^*\n]+)\*',       r'\1', text)
    return text.strip()


def _is_table_md(text):
    """Detect GFM table block (skip in K2; handled in K3)."""
    first_line = text.strip().split('\n')[0]
    return first_line.startswith('|') or '|' in first_line


# ── MD segment parser (K3-01) ─────────────────────────────────────────────────

def parse_md_segments_ordered(md_content):
    """
    Return ordered list of {'pid': str|None, 'text': str}:
    - pid=str: existing paragraph anchored to that paraId
    - pid=None: new/unanchored paragraph (to be inserted by K3-01)
    Skips front-matter and PAGE_BREAK sentinels.
    """
    body = md_content.lstrip()
    if body.startswith('---'):
        end = body.find('\n---\n', 3)
        if end >= 0:
            body = body[end + 5:]

    segments = []
    lines = body.split('\n')
    n = len(lines)
    i = 0

    while i < n:
        if not lines[i].strip():
            i += 1
            continue

        # Collect contiguous non-empty lines as a block
        block = []
        while i < n and lines[i].strip():
            block.append(lines[i])
            i += 1

        # Look for an anchor comment inside the block
        anchor_idx = None
        for j, bl in enumerate(block):
            if _ANCHOR_RE.search(bl):
                anchor_idx = j
                break

        if anchor_idx is not None:
            m = _ANCHOR_RE.search(block[anchor_idx])
            pid = m.group(1).upper()
            # Strip anchor from that line
            block[anchor_idx] = _ANCHOR_RE.sub('', block[anchor_idx]).rstrip()
            # Remove the line if it became empty (standalone anchor)
            cleaned = [l for l in block if l.strip()]
            text = '\n'.join(cleaned).strip()
            if text and not text.startswith('<!-- PAGE_BREAK'):
                segments.append({'pid': pid, 'text': text})
        else:
            text = '\n'.join(block).strip()
            if text and not text.startswith('<!-- PAGE_BREAK'):
                segments.append({'pid': None, 'text': text})

    return segments


# ── Logical type helpers (K3-01) ───────────────────────────────────────────────

def _get_logical_type(md_text):
    """Detect logical paragraph type from md text: headingN, list, list_ordered, table, normal."""
    first = (md_text or '').strip().split('\n')[0]
    m = re.match(r'^(#{1,6})\s', first)
    if m:
        return 'heading' + str(len(m.group(1)))
    if re.match(r'^[ \t]{0,9}[-*+]\s', first):
        return 'list'
    if re.match(r'^[ \t]{0,9}\d+\.\s', first):
        return 'list_ordered'
    if first.startswith('|'):
        return 'table'
    return 'normal'


def _get_docx_para_type(p_elem):
    """Derive logical type from <w:p> pStyle and numPr."""
    pPr = p_elem.find(_W + 'pPr')
    if pPr is not None:
        pStyle = pPr.find(_W + 'pStyle')
        if pStyle is not None:
            val = (pStyle.get(_W + 'val') or '').lower().replace(' ', '')
            # Heading detection
            m = re.match(r'^(?:heading|標題)(\d)$', val)
            if m:
                return 'heading' + m.group(1)
            if val in ('title',):
                return 'heading1'
            if 'list' in val or 'bullet' in val:
                return 'list'
            if 'number' in val:
                return 'list_ordered'
        # Detect list via numPr
        numPr = pPr.find(_W + 'numPr')
        if numPr is not None:
            ni = numPr.find(_W + 'numId')
            if ni is not None and ni.get(_W + 'val', '0') != '0':
                return 'list'
    return 'normal'


# ── Run-level XML helpers (K2) ─────────────────────────────────────────────────

def _get_run_chars(p_elem):
    """Flatten <w:r> children to list of (char, rPr_elem_or_None).
    Skips non-text runs (drawings, bookmarks, etc.)."""
    result = []
    for child in p_elem:
        if child.tag != _W + 'r':
            continue
        rPr   = child.find(_W + 'rPr')
        t_elem = child.find(_W + 't')
        if t_elem is None or not t_elem.text:
            continue
        for ch in t_elem.text:
            result.append((ch, rPr))
    return result


def _rpr_key(rPr):
    """Comparable string key for rPr element (for run-merging equality test)."""
    if rPr is None:
        return ''
    return etree.tostring(rPr, encoding='unicode')


def _make_run_elem(text, rPr):
    """Create a <w:r> lxml element with the given text and rPr (may be None)."""
    r = etree.Element(_W + 'r')
    if rPr is not None:
        r.append(copy.deepcopy(rPr))
    t = etree.SubElement(r, _W + 't')
    t.text = text
    # Preserve leading/trailing whitespace
    if text and (text[0] in (' ', '\t') or text[-1] in (' ', '\t')):
        t.set(_XML + 'space', 'preserve')
    return r


def _rewrite_para_runs(p_elem, new_plain_text):
    """Rewrite <w:r> children so text equals new_plain_text.
    Unchanged chars keep their original run format; replaced/inserted chars
    inherit the format of the first replaced char (spec §5 decision 1).
    Returns True if runs were actually changed."""
    old_chars = _get_run_chars(p_elem)
    old_text  = ''.join(ch for ch, _ in old_chars)

    if old_text == new_plain_text:
        return False

    # Determine the "inherit format" = rPr of first char being replaced or deleted.
    _NOT_SET = object()
    inherit_rPr = _NOT_SET
    matcher = difflib.SequenceMatcher(None, old_text, new_plain_text, autojunk=False)
    opcodes  = matcher.get_opcodes()
    for tag, i1, i2, j1, j2 in opcodes:
        if tag in ('replace', 'delete') and i1 < len(old_chars):
            inherit_rPr = old_chars[i1][1]
            break
        if tag == 'insert':
            inherit_rPr = old_chars[i1][1] if i1 < len(old_chars) else None
            break
    if inherit_rPr is _NOT_SET:
        inherit_rPr = old_chars[0][1] if old_chars else None

    # Build new (char, rPr) sequence
    new_char_seq = []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == 'equal':
            new_char_seq.extend(old_chars[i1:i2])
        elif tag in ('replace', 'insert'):
            for ch in new_plain_text[j1:j2]:
                new_char_seq.append((ch, inherit_rPr))
        # 'delete': skip

    # Group consecutive chars with the same rPr into runs
    runs = []
    if new_char_seq:
        cur_key   = _rpr_key(new_char_seq[0][1])
        cur_rPr   = new_char_seq[0][1]
        cur_chars = [new_char_seq[0][0]]
        for ch, rPr in new_char_seq[1:]:
            k = _rpr_key(rPr)
            if k == cur_key:
                cur_chars.append(ch)
            else:
                runs.append((''.join(cur_chars), cur_rPr))
                cur_key, cur_rPr, cur_chars = k, rPr, [ch]
        runs.append((''.join(cur_chars), cur_rPr))

    # Remove existing <w:r> elements (preserve <w:pPr> and other non-run elements)
    for r in p_elem.findall(_W + 'r'):
        p_elem.remove(r)

    # Find insertion point: after <w:pPr> if present
    insert_idx = 0
    for idx, child in enumerate(p_elem):
        if child.tag == _W + 'pPr':
            insert_idx = idx + 1
            break

    # Insert new runs
    for offset, (text, rPr) in enumerate(runs):
        p_elem.insert(insert_idx + offset, _make_run_elem(text, rPr))

    return True


# ── K3-02: table anchor map ────────────────────────────────────────────────────

def _build_table_anchor_map(root):
    """K3-02: Map {first_para_paraId → <w:tbl>} for each table in document.
    First para = first <w:p> with a paraId found anywhere inside the table.
    Mirrors the anchor logic in docx-convert.py _table_to_md_block()."""
    tbl_map = {}
    for tbl in root.iter(_W + 'tbl'):
        for p in tbl.iter(_W + 'p'):
            pid = p.get(_W14 + 'paraId')
            if pid:
                tbl_map[pid.upper()] = tbl
                break
    return tbl_map


# ── K3-01: new paragraph helpers ──────────────────────────────────────────────

def _gen_para_id(existing_ids):
    """Generate a unique 8-char uppercase hex paraId not already in existing_ids."""
    while True:
        pid = '%08X' % _random.randint(0, 0xFFFFFFFF)
        if pid not in existing_ids:
            existing_ids.add(pid)
            return pid


def _find_style_donor(target_type, before_pid, after_pid, pid_to_elem, segments):
    """Find a <w:p> to donate pPr to the new paragraph.
    Priority order: same-type near before_pid → same-type near after_pid →
    same-type anywhere → before_pid regardless of type → after_pid → None."""
    # Build ordered candidate list: before first, then after, then rest
    candidate_pids = []
    if before_pid:
        candidate_pids.append(before_pid)
    if after_pid:
        candidate_pids.append(after_pid)
    for seg in segments:
        if seg['pid'] and seg['pid'] not in candidate_pids:
            candidate_pids.append(seg['pid'])

    # First pass: same logical type
    for pid in candidate_pids:
        p = pid_to_elem.get(pid)
        if p is not None and _get_docx_para_type(p) == target_type:
            return p

    # Fallback: before_pid or after_pid regardless of type
    for pid in (before_pid, after_pid):
        if pid:
            p = pid_to_elem.get(pid)
            if p is not None:
                return p
    return None


def _make_new_para(donor_p_elem, plain_text, new_pid):
    """Create a new <w:p> with pPr from donor, plain_text as a single run, and injected paraId."""
    p = etree.Element(_W + 'p')
    p.set(_W14 + 'paraId', new_pid)

    rPr = None
    if donor_p_elem is not None:
        pPr_elem = donor_p_elem.find(_W + 'pPr')
        if pPr_elem is not None:
            p.append(copy.deepcopy(pPr_elem))
        first_run = donor_p_elem.find(_W + 'r')
        if first_run is not None:
            rPr_elem = first_run.find(_W + 'rPr')
            if rPr_elem is not None:
                rPr = copy.deepcopy(rPr_elem)

    if plain_text:
        p.append(_make_run_elem(plain_text, rPr))
    return p


def _get_body_child(root, elem):
    """Return (body_elem, direct_child_of_body) that is or contains elem."""
    body = None
    for b in root.iter(_W + 'body'):
        body = b
        break
    if body is None:
        return None, None
    current = elem
    while current is not None:
        parent = current.getparent()
        if parent is body:
            return body, current
        current = parent
    return body, None


def _insert_new_para_after_pid(root, pid_to_elem, before_pid, new_para):
    """Insert new_para after the body-level element that contains before_pid's <w:p>.
    Returns True on success."""
    if not before_pid:
        return False
    before_p = pid_to_elem.get(before_pid)
    if before_p is None:
        return False
    body, body_child = _get_body_child(root, before_p)
    if body is None or body_child is None:
        return False
    children = list(body)
    try:
        idx = children.index(body_child)
    except ValueError:
        return False
    body.insert(idx + 1, new_para)
    return True


# ── K3-03: safe paragraph deletion ────────────────────────────────────────────

def _delete_para_safe(p_elem):
    """Remove <w:p> from its parent.
    Safety: if it is the sole <w:p> in a <w:tc>, clear its runs instead (leaves empty cell).
    Returns True if element was removed, False if only emptied."""
    parent = p_elem.getparent()
    if parent is None:
        return False
    if parent.tag == _W + 'tc':
        paras = parent.findall(_W + 'p')
        if len(paras) <= 1:
            # Clear runs, keep paragraph (empty cell para required by OOXML)
            for r in list(p_elem.findall(_W + 'r')):
                p_elem.remove(r)
            return False
    parent.remove(p_elem)
    return True


# ── Main writeback function ────────────────────────────────────────────────────

def writeback(new_md_path, base_md_path, docx_path):
    """Apply text changes (new_md vs base_md) to source.docx using paraId anchors.
    K2: per-paraId char diff → run rebuild.
    K3: new para insertion, table anchor map, paragraph deletion.
    Modifies docx_path in-place. Returns dict: {ok, changed, inserted, deleted, skipped, errors}."""
    with open(new_md_path,  encoding='utf-8') as f:
        new_md  = f.read()
    with open(base_md_path, encoding='utf-8') as f:
        base_md = f.read()

    new_paras  = parse_md_anchors(new_md)
    base_paras = parse_md_anchors(base_md)

    # K2: identify changed text paragraphs
    changed_pids = {}   # {pid: (old_plain, new_plain)}
    for pid, new_text in new_paras.items():
        old_text = base_paras.get(pid)
        if old_text is None:
            continue   # new paragraph not in base → K3-01 handles unanchored new paras
        if new_text == old_text:
            continue
        if _is_table_md(new_text) or _is_table_md(old_text):
            continue   # table text diff skipped in K2 (K3-02 scope)
        if '<!-- PAGE_BREAK -->' in (new_text + old_text):
            continue
        old_plain = _strip_md_markup(old_text)
        new_plain = _strip_md_markup(new_text)
        if old_plain == new_plain:
            continue
        changed_pids[pid] = (old_plain, new_plain)

    # K3-01: ordered segments to find unanchored (new) paragraphs
    new_segments = parse_md_segments_ordered(new_md)

    # Build insertion plan: unanchored segments with their surrounding anchor context
    insertions = []  # [{before_pid, after_pid, text, type}]
    for idx, seg in enumerate(new_segments):
        if seg['pid'] is not None:
            continue
        before_pid = None
        for j in range(idx - 1, -1, -1):
            if new_segments[j]['pid'] is not None:
                before_pid = new_segments[j]['pid']
                break
        after_pid = None
        for j in range(idx + 1, len(new_segments)):
            if new_segments[j]['pid'] is not None:
                after_pid = new_segments[j]['pid']
                break
        insertions.append({
            'before_pid': before_pid,
            'after_pid': after_pid,
            'text': seg['text'],
            'type': _get_logical_type(seg['text']),
        })

    # K3-03: pids present in base but absent in new → delete
    deleted_pids = set(base_paras.keys()) - set(new_paras.keys())

    # Early exit if nothing to do
    if not changed_pids and not insertions and not deleted_pids:
        return {'ok': True, 'changed': 0, 'inserted': 0, 'deleted': 0, 'skipped': 0, 'errors': []}

    # Read docx zip
    with zipfile.ZipFile(docx_path, 'r') as z:
        names    = z.namelist()
        all_data = {n: z.read(n) for n in names}

    if 'word/document.xml' not in all_data:
        return {'ok': False, 'error': 'word/document.xml not found in docx',
                'changed': 0, 'inserted': 0, 'deleted': 0}

    # Parse document XML
    xml_bytes = all_data['word/document.xml']
    try:
        root = etree.fromstring(xml_bytes)
    except etree.XMLSyntaxError as e:
        return {'ok': False, 'error': 'XML parse error: ' + str(e),
                'changed': 0, 'inserted': 0, 'deleted': 0}

    # Build paraId → <w:p> element map (all paragraphs, including inside tables)
    pid_to_elem = {}
    for p in root.iter(_W + 'p'):
        pid = p.get(_W14 + 'paraId')
        if pid:
            pid_to_elem[pid.upper()] = p

    # K3-02: table anchor map
    tbl_anchor_map = _build_table_anchor_map(root)

    # Collect existing paraIds for uniqueness when generating new ones (K3-01)
    existing_pids = set(pid_to_elem.keys())

    changed = 0
    skipped = 0
    inserted = 0
    deleted  = 0
    errors   = []

    # ── K2: apply run-level text changes ──────────────────────────────────────
    for pid, (old_plain, new_plain) in changed_pids.items():
        p_elem = pid_to_elem.get(pid)
        if p_elem is None:
            skipped += 1
            errors.append({'paraId': pid, 'note': 'not found in docx'})
            continue
        try:
            did_change = _rewrite_para_runs(p_elem, new_plain)
            if did_change:
                changed += 1
            else:
                skipped += 1
        except Exception as e:
            errors.append({'paraId': pid, 'error': str(e)})

    # ── K3-01: insert new (unanchored) paragraphs ─────────────────────────────
    for ins in insertions:
        donor = _find_style_donor(
            ins['type'], ins['before_pid'], ins['after_pid'],
            pid_to_elem, new_segments
        )
        new_pid = _gen_para_id(existing_pids)
        plain   = _strip_md_markup(ins['text'])
        new_p   = _make_new_para(donor, plain, new_pid)
        if _insert_new_para_after_pid(root, pid_to_elem, ins['before_pid'], new_p):
            pid_to_elem[new_pid] = new_p  # register so subsequent insertions can use it
            inserted += 1
        else:
            errors.append({'note': 'K3-01 insert failed', 'text': ins['text'][:50]})

    # ── K3-03: delete disappeared paragraphs ──────────────────────────────────
    for pid in deleted_pids:
        if pid in tbl_anchor_map:
            # Table anchor gone → delete whole <w:tbl>
            tbl = tbl_anchor_map[pid]
            tbl_parent = tbl.getparent()
            if tbl_parent is not None:
                tbl_parent.remove(tbl)
                deleted += 1
            continue
        p_elem = pid_to_elem.get(pid)
        if p_elem is None:
            continue
        if _delete_para_safe(p_elem):
            deleted += 1

    # ── Serialize & save ──────────────────────────────────────────────────────
    if changed > 0 or inserted > 0 or deleted > 0:
        new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        all_data['word/document.xml'] = new_xml

        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                zout.writestr(name, all_data[name])
        with open(docx_path, 'wb') as f:
            f.write(buf.getvalue())

    return {
        'ok':      True,
        'changed':  changed,
        'inserted': inserted,
        'deleted':  deleted,
        'skipped':  skipped,
        'errors':   errors,
    }


# ── P2-DOCX (DOC-P2D-01): in-place text edits keyed directly by paraId ─────────
# The realistic-preview in-place editor edits the docx-preview DOM's <p data-el=paraId>
# directly, so it already knows {paraId: newPlainText} — no md diff/alignment needed.
# Reuses the same run-level rewrite machinery as K2 (only the changed chars move, all
# other runs' formatting is preserved byte-for-byte).

def writeback_edits(docx_path, edits):
    """Apply {paraId: new_plain_text} directly to source.docx via run-level rewrite.
    Only paragraphs whose text actually differs are touched. Returns
    {ok, changed, skipped, errors}."""
    edits = {str(k).upper(): (v if v is not None else '') for k, v in (edits or {}).items()}
    if not edits:
        return {'ok': True, 'changed': 0, 'skipped': 0, 'errors': []}

    with zipfile.ZipFile(docx_path, 'r') as z:
        names    = z.namelist()
        all_data = {n: z.read(n) for n in names}

    if 'word/document.xml' not in all_data:
        return {'ok': False, 'error': 'word/document.xml not found in docx', 'changed': 0}

    try:
        root = etree.fromstring(all_data['word/document.xml'])
    except etree.XMLSyntaxError as e:
        return {'ok': False, 'error': 'XML parse error: ' + str(e), 'changed': 0}

    pid_to_elem = {}
    for p in root.iter(_W + 'p'):
        pid = p.get(_W14 + 'paraId')
        if pid:
            pid_to_elem[pid.upper()] = p

    changed = 0
    skipped = 0
    errors  = []
    for pid, new_text in edits.items():
        p_elem = pid_to_elem.get(pid)
        if p_elem is None:
            skipped += 1
            errors.append({'paraId': pid, 'note': 'not found in docx'})
            continue
        try:
            if _rewrite_para_runs(p_elem, new_text):
                changed += 1
            else:
                skipped += 1
        except Exception as e:
            errors.append({'paraId': pid, 'error': str(e)})

    if changed > 0:
        new_xml = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        all_data['word/document.xml'] = new_xml
        buf = BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for name in names:
                zout.writestr(name, all_data[name])
        with open(docx_path, 'wb') as f:
            f.write(buf.getvalue())

    return {'ok': True, 'changed': changed, 'skipped': skipped, 'errors': errors}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='K2/K3: docx run-level writeback')
    ap.add_argument('--docx',  required=True, help='path to source.docx (modified in-place)')
    ap.add_argument('--new',   help='path to new doc.md (md-diff mode; with --base)')
    ap.add_argument('--base',  help='path to base doc.md (md-diff mode; with --new)')
    ap.add_argument('--edits', help='path to JSON {paraId: newPlainText} (in-place mode, DOC-P2D-01)')
    args = ap.parse_args()

    if args.edits:
        with open(args.edits, encoding='utf-8') as f:
            edits = json.load(f)
        result = writeback_edits(args.docx, edits)
    elif args.new and args.base:
        result = writeback(args.new, args.base, args.docx)
    else:
        result = {'ok': False, 'error': 'must pass either --edits, or both --new and --base'}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get('ok') else 1)
