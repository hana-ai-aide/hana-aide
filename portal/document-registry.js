// document-registry.js — .documents/ storage helpers + registry (index.json) read/write
// DOC-I1-01 / DOC-I1-02 / DOC-I1-03
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOCS_DIR   = '.documents';
const INDEX_FILE = 'index.json';

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDocumentsDir(workspaceRoot) {
  return path.join(workspaceRoot, DOCS_DIR);
}

function getDocumentDir(workspaceRoot, id) {
  return path.join(workspaceRoot, DOCS_DIR, id);
}

function getRegistryPath(workspaceRoot) {
  return path.join(workspaceRoot, DOCS_DIR, INDEX_FILE);
}

// ── UUID ──────────────────────────────────────────────────────────────────────

function generateDocId() {
  return crypto.randomUUID();
}

// ── Directory structure ───────────────────────────────────────────────────────
// Creates <workspace>/.documents/<id>/assets/ and .../exports/

function ensureDocumentDir(workspaceRoot, id) {
  const dir = getDocumentDir(workspaceRoot, id);
  fs.mkdirSync(path.join(dir, 'assets'),  { recursive: true });
  fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
  return dir;
}

// ── Registry read/write ───────────────────────────────────────────────────────
// Schema: { documents: [ { id, sourcePath, mdPath, type, exports[], convertedAt, updatedAt } ] }
// 無 title 欄：顯示名稱由 sourcePath（原始檔名）推導。Word 自由格式無可靠標題、title 又易誤解。

function readRegistry(workspaceRoot) {
  const p = getRegistryPath(workspaceRoot);
  if (!fs.existsSync(p)) return { documents: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('[DocRegistry] Failed to read registry:', e.message);
    return { documents: [] };
  }
}

function writeRegistry(workspaceRoot, registry) {
  const dir = getDocumentsDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getRegistryPath(workspaceRoot), JSON.stringify(registry, null, 2), 'utf8');
}

// Add or update a document entry; updatedAt is always refreshed.
function upsertDocument(workspaceRoot, doc) {
  const reg = readRegistry(workspaceRoot);
  const idx = reg.documents.findIndex(d => d.id === doc.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    reg.documents[idx] = { ...reg.documents[idx], ...doc, updatedAt: now };
  } else {
    reg.documents.push({ convertedAt: now, exports: [], ...doc, updatedAt: now });
  }
  writeRegistry(workspaceRoot, reg);
  return reg.documents.find(d => d.id === doc.id);
}

function removeDocument(workspaceRoot, id) {
  const reg = readRegistry(workspaceRoot);
  reg.documents = reg.documents.filter(d => d.id !== id);
  writeRegistry(workspaceRoot, reg);
}

// ── 刪除 / 資源回收桶（soft-delete + recycle bin）─────────────────────────────
// 軟刪除＝從 documents 移到 trash[]（蓋 deletedAt），目錄留著、從列表消失、可還原。
// 徹底刪除（purge）才真的 rm 目錄。孤兒＝磁碟上有、documents/trash 都沒關聯的 UUID 目錄。
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function _dirSizeBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += _dirSizeBytes(p);
    else { try { total += fs.statSync(p).size; } catch (_) {} }
  }
  return total;
}

function softDeleteDocument(workspaceRoot, id) {
  const reg = readRegistry(workspaceRoot);
  if (!Array.isArray(reg.trash)) reg.trash = [];
  const i = reg.documents.findIndex(d => d.id === id);
  if (i < 0) return null;
  const doc = reg.documents.splice(i, 1)[0];
  doc.deletedAt = new Date().toISOString();
  reg.trash.push(doc);
  writeRegistry(workspaceRoot, reg);
  return doc;
}

function restoreDocument(workspaceRoot, id) {
  const reg = readRegistry(workspaceRoot);
  if (!Array.isArray(reg.trash)) reg.trash = [];
  const i = reg.trash.findIndex(d => d.id === id);
  if (i < 0) return null;                 // 孤兒（不在 trash）無法還原——沒有 registry 記錄
  const doc = reg.trash.splice(i, 1)[0];
  delete doc.deletedAt;
  doc.updatedAt = new Date().toISOString();
  reg.documents.push(doc);
  writeRegistry(workspaceRoot, reg);
  return doc;
}

// 徹底刪除：從 trash/documents 移除 + rm 目錄。孤兒也可 purge（只 rm 目錄）。
function purgeDocument(workspaceRoot, id) {
  if (!_UUID_RE.test(id)) throw new Error('refuse to purge non-UUID id: ' + id);   // 防呆
  const reg = readRegistry(workspaceRoot);
  if (Array.isArray(reg.trash)) reg.trash = reg.trash.filter(d => d.id !== id);
  reg.documents = reg.documents.filter(d => d.id !== id);
  writeRegistry(workspaceRoot, reg);
  const dir = getDocumentDir(workspaceRoot, id);
  try { fs.rmSync(dir, { recursive: true, force: true }); }
  catch (e) { console.error('[DocRegistry] purge rm failed:', e.message); }
  return true;
}

// 資源回收桶清單＝軟刪除的 trash[] ＋ 孤兒目錄（帶推導的檔名/時間/大小）。
function listRecycle(workspaceRoot) {
  const reg = readRegistry(workspaceRoot);
  const trash = Array.isArray(reg.trash) ? reg.trash : [];
  const known = new Set([...reg.documents.map(d => d.id), ...trash.map(d => d.id)]);
  const docsRoot = getDocumentsDir(workspaceRoot);

  const items = trash.map(d => ({
    id: d.id, sourcePath: d.sourcePath || '', title: d.title || '',
    bornAt: d.bornAt || d.convertedAt || null, deletedAt: d.deletedAt || null,
    sizeBytes: _dirSizeBytes(getDocumentDir(workspaceRoot, d.id)), kind: 'trash',
  }));

  let dirs = [];
  try { dirs = fs.readdirSync(docsRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch (_) {}
  for (const name of dirs) {
    if (!_UUID_RE.test(name) || known.has(name)) continue;      // 只認 UUID 目錄、排除已知的
    let sourcePath = '', bornAt = null;
    try {
      const parsed = parseFrontMatter(fs.readFileSync(path.join(docsRoot, name, 'doc.md'), 'utf8'));
      sourcePath = parsed.meta.source || '';
      bornAt = parsed.meta.convertedAt || null;
    } catch (_) {}
    if (!bornAt) { try { bornAt = fs.statSync(path.join(docsRoot, name)).birthtime.toISOString(); } catch (_) {} }
    items.push({ id: name, sourcePath, title: '', bornAt, deletedAt: null,
      sizeBytes: _dirSizeBytes(path.join(docsRoot, name)), kind: 'orphan' });
  }
  // 刪除時間新→舊；孤兒(無 deletedAt)排後面
  items.sort((a, b) => (b.deletedAt || '') < (a.deletedAt || '') ? -1 : 1);
  return items;
}

function emptyRecycle(workspaceRoot) {
  const items = listRecycle(workspaceRoot);
  let purged = 0;
  for (const it of items) { try { purgeDocument(workspaceRoot, it.id); purged++; } catch (_) {} }
  return purged;
}

// DOC-P2D-04: mark/clear a document's "已變更" (working copy edited, not yet written back to
// the original sourcePath 真身). Distinct from `revisions` (which counts history events).
function setDocDirty(workspaceRoot, id, dirty) {
  const reg = readRegistry(workspaceRoot);
  const doc = reg.documents.find(d => d.id === id);
  if (!doc) return null;
  if (dirty) doc.dirty = true;
  else       delete doc.dirty;
  doc.updatedAt = new Date().toISOString();
  writeRegistry(workspaceRoot, reg);
  return doc;
}

// ── Version history (DOC-J5) ──────────────────────────────────────────────────
// Per-document timeline that unifies birth + every later edit, layered ON TOP of git
// (the app keeps fine-grained snapshots+log; git stays the durable backup). Storage:
//   .documents/<id>/history/
//     log.json        ← event array (rev 0 = born; rev>0 = edit)
//     doc.<rev>.md    ← snapshot of doc.md *after* that event
// registry caches origin/bornAt/revisions so the list needn't scan the log.

const HISTORY_DIR = 'history';
const HISTORY_LOG = 'log.json';

function getHistoryDir(workspaceRoot, id) {
  return path.join(getDocumentDir(workspaceRoot, id), HISTORY_DIR);
}

function readDocHistory(workspaceRoot, id) {
  const p = path.join(getHistoryDir(workspaceRoot, id), HISTORY_LOG);
  if (!fs.existsSync(p)) return [];
  try {
    const events = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(events) ? events : [];
  } catch (e) {
    console.error('[DocHistory] Failed to read log:', e.message);
    return [];
  }
}

function writeDocHistory(workspaceRoot, id, events) {
  const dir = getHistoryDir(workspaceRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, HISTORY_LOG), JSON.stringify(events, null, 2), 'utf8');
}

// Record one event: snapshot the current doc.md as doc.<nextRev>.md, append to log,
// then sync the registry cache (revisions/updatedAt; born also sets origin/bornAt).
//   opts = {
//     kind: 'born' | 'edit', by, summary, origin?,
//     change?:  'text' | 'flow' | 'image'             — J8: type of change for timeline icon/diff
//     assets?:  [{type:'flow'|'image', path:'assets/foo.bpmn', beforeContent?:Buffer}]
//               path relative to docDir; beforeContent = file state BEFORE this edit for COW baseline
//   }
// Returns the appended event.
function appendDocHistory(workspaceRoot, id, { kind, by, summary, origin, change, assets } = {}) {
  const docDir  = getDocumentDir(workspaceRoot, id);
  const mdPath  = path.join(docDir, 'doc.md');
  const histDir = getHistoryDir(workspaceRoot, id);
  fs.mkdirSync(histDir, { recursive: true });

  const events  = readDocHistory(workspaceRoot, id);
  const nextRev = events.length === 0 ? 0 : (events[events.length - 1].rev + 1);
  const ts      = new Date().toISOString();

  // ── Copy-on-write baseline for sibling assets (DOC-J8-01) ──────────────────
  // First time a sibling asset (bpmn/image) is touched: write its "before" content as a baseline
  // under the born event so that `resolveAssetSnapshot(rev < firstEdit)` has something to return.
  // This makes the first diff's "before" available without snapshotting everything at birth.
  const assetList = Array.isArray(assets) ? assets : [];
  for (const a of assetList) {
    if (!a.path || a.beforeContent == null) continue;
    const base = path.basename(a.path);
    const alreadySnapshotted = events.some(ev =>
      Array.isArray(ev.assets) && ev.assets.some(ea => path.basename(ea.path || '') === base && ea.snapshot)
    );
    if (!alreadySnapshotted && events.length > 0) {
      // Baseline under the born event (events[0])
      const bornRev   = events[0].rev;
      const baseDir   = path.join(histDir, 'assets', String(bornRev));
      fs.mkdirSync(baseDir, { recursive: true });
      try {
        fs.writeFileSync(path.join(baseDir, base), a.beforeContent);
        if (!Array.isArray(events[0].assets)) events[0].assets = [];
        events[0].assets.push({ type: a.type, path: a.path,
          snapshot: 'assets/' + bornRev + '/' + base });
      } catch (e) { console.error('[DocHistory] COW baseline failed:', e.message); }
    }
  }

  // ── Snapshot the current doc.md ────────────────────────────────────────────
  let snapshot = null;
  if (fs.existsSync(mdPath)) {
    snapshot = `doc.${nextRev}.md`;
    try { fs.copyFileSync(mdPath, path.join(histDir, snapshot)); }
    catch (e) { console.error('[DocHistory] snapshot failed:', e.message); snapshot = null; }
  }

  // ── Snapshot sibling assets (DOC-J8-01) ───────────────────────────────────
  // Current on-disk state of each asset = "after" state of this edit.
  const snapshotedAssets = [];
  for (const a of assetList) {
    if (!a.path) continue;
    const assetAbs = path.join(docDir, a.path);
    if (!fs.existsSync(assetAbs)) continue;
    const base   = path.basename(a.path);
    const revDir = path.join(histDir, 'assets', String(nextRev));
    fs.mkdirSync(revDir, { recursive: true });
    try {
      fs.copyFileSync(assetAbs, path.join(revDir, base));
      snapshotedAssets.push({ type: a.type, path: a.path, snapshot: 'assets/' + nextRev + '/' + base });
    } catch (e) { console.error('[DocHistory] asset snapshot failed:', e.message); }
  }

  const ev = { rev: nextRev, ts, kind, by: by || 'Hana', summary: summary || '' };
  if (kind === 'born')          ev.origin  = origin || 'imported';
  if (change)                   ev.change  = change;
  if (snapshotedAssets.length)  ev.assets  = snapshotedAssets;
  ev.snapshot = snapshot;
  events.push(ev);
  writeDocHistory(workspaceRoot, id, events);   // includes any COW mutations to events[0]

  // Sync registry cache (single source for the list: origin/bornAt/revisions).
  const reg = readRegistry(workspaceRoot);
  const doc = reg.documents.find(d => d.id === id);
  if (doc) {
    if (kind === 'born') {
      doc.origin    = origin || 'imported';
      doc.bornAt    = ts;
      doc.revisions = 0;
    } else {
      doc.revisions = events.filter(e => e.kind !== 'born').length;
    }
    doc.updatedAt = ts;
    writeRegistry(workspaceRoot, reg);
  }
  return ev;
}

// ── Asset snapshot resolution (DOC-J8-03) ────────────────────────────────────
// For a given assetRelPath (relative to docDir, e.g. 'assets/foo.bpmn'), return the absolute
// path to the most-recent snapshot at rev ≤ upToRev.  Returns null if none found or file missing.
// Derivation rule: path 相同、rev ≤ upToRev 的最後一筆 assets[] 快照。
function resolveAssetSnapshot(workspaceRoot, id, assetRelPath, upToRev) {
  const events  = readDocHistory(workspaceRoot, id);
  const histDir = getHistoryDir(workspaceRoot, id);
  const base    = path.basename(assetRelPath);
  let lastSnap  = null;
  for (const ev of events) {
    if (ev.rev > upToRev) break;
    if (!Array.isArray(ev.assets)) continue;
    for (const a of ev.assets) {
      if (path.basename(a.path || '') === base && a.snapshot) {
        lastSnap = path.join(histDir, a.snapshot.replace(/\//g, path.sep));
      }
    }
  }
  if (!lastSnap) return null;
  return fs.existsSync(lastSnap) ? lastSnap : null;
}

// Resolve a doc id from an absolute path inside .documents/<id>/… (null if not under one).
function docIdFromPath(workspaceRoot, absPath) {
  const docsRoot = getDocumentsDir(workspaceRoot);
  const rel = path.relative(docsRoot, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const first = rel.split(/[\\/]/)[0];
  return first && first !== INDEX_FILE ? first : null;
}

// Backfill existing documents (pre-J5) onto the history mechanism: write a rev-0
// born:imported event with doc.0.md = current doc.md, set origin/bornAt/revisions.
// Idempotent — skips docs that already have a log. Returns { backfilled, skipped }.
function backfillDocHistory(workspaceRoot) {
  const reg = readRegistry(workspaceRoot);
  let backfilled = 0, skipped = 0;
  for (const doc of reg.documents) {
    // Skip only when a history log actually exists — origin alone isn't proof (a registry entry
    // could carry origin without its log/born snapshot). existsSync is the cheap hot-path guard.
    const logPath = path.join(getHistoryDir(workspaceRoot, doc.id), HISTORY_LOG);
    if (doc.origin && fs.existsSync(logPath)) { skipped++; continue; }
    if (readDocHistory(workspaceRoot, doc.id).length > 0) { skipped++; continue; }
    const mdPath = path.join(getDocumentDir(workspaceRoot, doc.id), 'doc.md');
    if (!fs.existsSync(mdPath)) { skipped++; continue; }
    const histDir = getHistoryDir(workspaceRoot, doc.id);
    fs.mkdirSync(histDir, { recursive: true });
    fs.copyFileSync(mdPath, path.join(histDir, 'doc.0.md'));
    const ts = doc.convertedAt || doc.updatedAt || new Date().toISOString();
    writeDocHistory(workspaceRoot, doc.id, [{
      rev: 0, ts, kind: 'born', origin: 'imported', by: '老闆',
      summary: `匯入自 ${doc.sourcePath || '未知來源'}`, snapshot: 'doc.0.md',
    }]);
    doc.origin    = 'imported';
    doc.bornAt    = ts;
    doc.revisions = 0;
    backfilled++;
  }
  if (backfilled > 0) writeRegistry(workspaceRoot, reg);
  return { backfilled, skipped };
}

// ── Front-matter parse/write (JS) ─────────────────────────────────────────────
// Simple YAML-subset: scalar values + arrays written as [a, b, c].
// front-matter is the source of truth; registry is a cache rebuilt from it.

function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
    meta[m[1]] = val;
  }
  return { meta, body: content.slice(match[0].length) };
}

function stringifyFrontMatter(meta) {
  const lines = [];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`);
  }
  return '---\n' + lines.join('\n') + '\n---\n';
}

// Merge `meta` into the file's existing front-matter (new keys win), preserve body.
function writeFrontMatter(mdPath, meta) {
  let body = '';
  let existing = {};
  if (fs.existsSync(mdPath)) {
    const parsed = parseFrontMatter(fs.readFileSync(mdPath, 'utf8'));
    existing = parsed.meta;
    body = parsed.body;
  }
  const merged = { ...existing, ...meta };
  fs.writeFileSync(mdPath, stringifyFrontMatter(merged) + body, 'utf8');
}

module.exports = {
  getDocumentsDir,
  getDocumentDir,
  getRegistryPath,
  generateDocId,
  ensureDocumentDir,
  readRegistry,
  writeRegistry,
  upsertDocument,
  removeDocument,
  softDeleteDocument,
  restoreDocument,
  purgeDocument,
  listRecycle,
  emptyRecycle,
  setDocDirty,
  getHistoryDir,
  readDocHistory,
  appendDocHistory,
  resolveAssetSnapshot,
  docIdFromPath,
  backfillDocHistory,
  parseFrontMatter,
  stringifyFrontMatter,
  writeFrontMatter,
};

// ── CLI: doc-new helpers (DOC-J3) ─────────────────────────────────────────────
// Used by the `doc-new` skill (a CLI agent) to allocate + register a generated document
// without hand-writing the registry/history schema (that's what J5's appendDocHistory is for).
// Two steps, because appendDocHistory snapshots the CURRENT doc.md — the agent must write the
// finished content BETWEEN them:
//   1) new-doc        → allocate a uuid, create .documents/<uuid>/{assets,exports}/, print {id,mdPath}
//   2) <agent writes .documents/<uuid>/doc.md (+ assets) >
//   3) register-born  → write front-matter (type + provenance) + upsert registry + born:generated event
// cwd defaults to the active workspace root (the job runs there); override with --workspace.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd  = argv[0];
  const opt  = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !String(next).startsWith('--')) { opt[k] = next; i++; }
      else opt[k] = 'true';
    }
  }
  const ws = opt.workspace || process.cwd();

  if (cmd === 'new-doc') {
    const id = generateDocId();
    ensureDocumentDir(ws, id);
    console.log(JSON.stringify({
      ok: true, id,
      dir:    path.posix.join('.documents', id),
      mdPath: path.posix.join('.documents', id, 'doc.md'),
    }));
  } else if (cmd === 'register-born') {
    const id = opt.id;
    if (!id) { console.error('register-born: --id <uuid> required'); process.exit(1); }
    const mdAbs = path.join(getDocumentDir(ws, id), 'doc.md');
    if (!fs.existsSync(mdAbs)) {
      console.error('register-born: doc.md not found at ' + mdAbs + ' — write the document content first');
      process.exit(1);
    }
    const type = opt.type || 'doc';
    // Front-matter = type + provenance (NO title — registry/viewer derive the name from sourcePath).
    const fm = { type };
    if (opt.template) fm.template = opt.template;   // 從範本：家族名
    if (opt.source)   fm.source   = opt.source;     // 從複製：來源 docId / 路徑
    writeFrontMatter(mdAbs, fm);
    const name = opt.name || id;
    // sourcePath uses a 生成/<name> pseudo-path: viewer shows <name> (basename, ext stripped) as the
    // display name and "生成/<name>" as the location hint — mirroring how imported docs read.
    upsertDocument(ws, {
      id,
      sourcePath: opt.sourcePath || ('生成/' + name),
      mdPath: path.posix.join('.documents', id, 'doc.md'),
      type,
      exports: [],
    });
    const summary = opt.summary
      || (opt.template ? ('由範本「' + opt.template + '」生成')
      :  (opt.source   ? ('複製自 ' + opt.source + ' 生成')
      :  '由 Hana 生成'));
    appendDocHistory(ws, id, { kind: 'born', origin: opt.origin || 'generated', by: 'Hana', summary });
    console.log(JSON.stringify({ ok: true, id, mdPath: path.posix.join('.documents', id, 'doc.md') }));
  } else {
    console.error(
      'usage:\n' +
      '  node document-registry.js new-doc [--workspace <root>]\n' +
      '  node document-registry.js register-born --id <uuid> --name "<name>"\n' +
      '       [--origin generated] [--template "<family>"] [--source "<docId>"] [--summary "<text>"] [--workspace <root>]'
    );
    process.exit(1);
  }
}
