'use strict';

const fs = require('fs');
const path = require('path');
const { open, initSchema, reset } = require('./db');

// Definition strength (stored in nodes.defined): higher wins on conflict.
const DEF_NONE = 0;     // referenced only -> dangling candidate
const DEF_REGISTRY = 1; // listed in an authoritative registry/log
const DEF_FILE = 2;     // has its own dedicated file

// Walk a directory collecting .md files, honouring the profile's skip list.
function walkMarkdown(dir, profile, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (profile.skipDirs.includes(ent.name)) continue;
      walkMarkdown(path.join(dir, ent.name), profile, out);
    } else if (/\.(md|markdown)$/i.test(ent.name)) {
      out.push(path.join(dir, ent.name));
    }
  }
}

// First markdown H1 (or first non-empty line) as a human title.
function extractTitle(content, fallback) {
  const lines = content.split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].replace(/[#*`]/g, '').trim();
  }
  return fallback;
}

// All distinct, canonical, non-placeholder IDs mentioned in `content`.
function extractMentions(content, profile) {
  const found = new Map(); // canonicalId -> type
  for (const p of profile.idPatterns) {
    const re = new RegExp(p.re.source, 'g');
    let m;
    while ((m = re.exec(content)) !== null) {
      const token = m[0];
      if (profile.isPlaceholder(token)) continue;
      const id = profile.canonical(p.type, token);
      if (!found.has(id)) found.set(id, p.type);
    }
  }
  return found;
}

function index(projectRoot, profile) {
  const db = open(projectRoot);
  initSchema(db);
  reset(db);

  const upsertNode = db.prepare(`
    INSERT INTO nodes (id, type, title, file, defined) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type    = COALESCE(excluded.type, nodes.type),
      title   = COALESCE(NULLIF(excluded.title, ''), nodes.title),
      file    = COALESCE(excluded.file, nodes.file),
      defined = MAX(nodes.defined, excluded.defined)
  `);
  const ensureRef = db.prepare(`
    INSERT INTO nodes (id, type, defined) VALUES (?, ?, 0)
    ON CONFLICT(id) DO NOTHING
  `);
  const addEdge = db.prepare(`
    INSERT INTO edges (src, dst, relation, file) VALUES (?, ?, 'mentions', ?)
    ON CONFLICT(src, dst, relation) DO NOTHING
  `);
  const addEdgeRel = db.prepare(`
    INSERT INTO edges (src, dst, relation, file) VALUES (?, ?, ?, NULL)
    ON CONFLICT(src, dst, relation) DO NOTHING
  `);

  const files = [];
  for (const domain of profile.docDomains) {
    walkMarkdown(path.join(projectRoot, domain), profile, files);
  }

  let nodeFiles = 0, edgeCount = 0;
  db.exec('BEGIN'); // node:sqlite has no .transaction() helper; batch manually for speed

  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    const base = path.basename(abs);
    let content;
    try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { continue; }

    // Determine the primary node this file represents.
    let primary = profile.fileDefines(base) || profile.dirOwner(rel);
    if (primary) {
      const title = extractTitle(content, primary.id);
      upsertNode.run(primary.id, primary.type, title, rel, DEF_FILE);
      nodeFiles++;
    } else {
      // A governed doc that isn't itself an ID (standard, dashboard, registry...).
      primary = { type: 'DOC', id: 'DOC:' + rel };
      upsertNode.run(primary.id, 'DOC', extractTitle(content, base), rel, DEF_FILE);
    }

    // Is this file an authoritative registry for certain ID types?
    const registryTypes = profile.registryDefines(rel);

    // Edges: primary -> every other ID it mentions.
    const mentions = extractMentions(content, profile);
    for (const [id, type] of mentions) {
      if (id === primary.id) continue;
      if (registryTypes && registryTypes.includes(type)) {
        // Registry entry = a real (non-file) definition; promote out of dangling.
        upsertNode.run(id, type, '', rel, DEF_REGISTRY);
      } else {
        ensureRef.run(id, type);
      }
      addEdge.run(primary.id, id, rel);
      edgeCount++;
    }
  }

  // Deterministic SPEC<->TEST pairing edges (by naming convention, not text).
  // TEST-X depends on SPEC-X, so impact(SPEC-X) reaches its TEST via this incoming edge.
  const { left, right, strip } = profile.pairing;
  const specDefined = new Set(
    db.prepare('SELECT id FROM nodes WHERE type = ? AND defined = ?').all(left, DEF_FILE).map(r => r.id)
  );
  for (const t of db.prepare('SELECT id FROM nodes WHERE type = ? AND defined = ?').all(right, DEF_FILE)) {
    const specId = left + '-' + t.id.replace(strip, '');
    if (specDefined.has(specId)) { addEdgeRel.run(t.id, specId, 'tests'); edgeCount++; }
  }

  db.exec('COMMIT');

  const stmtMeta = db.prepare(`INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`);
  stmtMeta.run('profile', profile.name);
  stmtMeta.run('indexedAt', new Date().toISOString());
  stmtMeta.run('fileCount', String(files.length));

  const totalNodes = db.prepare('SELECT COUNT(*) c FROM nodes').get().c;
  const definedNodes = db.prepare('SELECT COUNT(*) c FROM nodes WHERE defined >= 1').get().c;
  db.close();

  return { files: files.length, primaryDocs: nodeFiles, totalNodes, definedNodes, edges: edgeCount };
}

// Collect the current source markdown files + their newest mtime, for staleness checks.
function scanSources(projectRoot, profile) {
  const files = [];
  for (const domain of profile.docDomains) {
    walkMarkdown(path.join(projectRoot, domain), profile, files);
  }
  let maxMtimeMs = 0;
  for (const abs of files) {
    try { const m = fs.statSync(abs).mtimeMs; if (m > maxMtimeMs) maxMtimeMs = m; } catch (e) { /* ignore */ }
  }
  return { count: files.length, maxMtimeMs };
}

// Has the corpus changed since the last index? Catches edits, additions and removals,
// so the graph can never silently serve a stale spec list. Cheap (~20 files, sub-ms).
function isStale(projectRoot, profile) {
  const dbPath = path.join(projectRoot, '.docgraph', 'docgraph.db');
  if (!fs.existsSync(dbPath)) return { stale: true, reason: 'no index yet' };
  const { count, maxMtimeMs } = scanSources(projectRoot, profile);
  const { open } = require('./db');
  const db = open(projectRoot);
  let indexedAt = null, fileCount = null;
  try {
    for (const r of db.prepare('SELECT k, v FROM meta').all()) {
      if (r.k === 'indexedAt') indexedAt = r.v;
      if (r.k === 'fileCount') fileCount = Number(r.v);
    }
  } catch (e) { /* fall through to "stale" */ } finally { db.close(); }
  if (indexedAt == null) return { stale: true, reason: 'never indexed' };
  if (fileCount !== count) return { stale: true, reason: `file count ${fileCount}→${count}` };
  if (maxMtimeMs > Date.parse(indexedAt)) return { stale: true, reason: 'edited since last index' };
  return { stale: false };
}

module.exports = { index, isStale, scanSources };
