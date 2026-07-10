'use strict';

const { open } = require('./db');

function node(db, id) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
}

// Direct outgoing: what X is built on / what it mentions.
function trace(db, id) {
  return db.prepare(`
    SELECT n.* FROM edges e JOIN nodes n ON n.id = e.dst
    WHERE e.src = ? ORDER BY n.type, n.id
  `).all(id);
}

// Direct incoming: who references X.
function refs(db, id) {
  return db.prepare(`
    SELECT n.* FROM edges e JOIN nodes n ON n.id = e.src
    WHERE e.dst = ? ORDER BY n.type, n.id
  `).all(id);
}

// Transitive incoming (reverse reachability): everything affected if X changes.
// Hubs with high out-degree / low in-degree (e.g. a requirement registry) do NOT
// blow this up, because we only ever walk edges backwards toward X's dependents.
function impact(db, id) {
  return db.prepare(`
    WITH RECURSIVE upstream(id, depth) AS (
      SELECT ?, 0
      UNION
      SELECT e.src, u.depth + 1
        FROM edges e JOIN upstream u ON e.dst = u.id
        WHERE u.depth < 12
    )
    SELECT n.*, MIN(u.depth) AS depth
      FROM upstream u JOIN nodes n ON n.id = u.id
      WHERE u.id != ?
      GROUP BY n.id
      ORDER BY depth, n.type, n.id
  `).all(id, id);
}

// Enumerate defined nodes (optionally of one type, e.g. 'SPEC') with their file paths.
// This is the "spec 清單" lookup: what specs exist and where their source lives.
function list(db, type) {
  if (type) return db.prepare('SELECT * FROM nodes WHERE type = ? AND defined >= 1 ORDER BY id').all(type);
  return db.prepare('SELECT * FROM nodes WHERE defined >= 1 ORDER BY type, id').all();
}

function stats(db) {
  const byType = db.prepare(`
    SELECT type,
           SUM(CASE WHEN defined=2 THEN 1 ELSE 0 END) AS file,
           SUM(CASE WHEN defined=1 THEN 1 ELSE 0 END) AS registry,
           SUM(CASE WHEN defined=0 THEN 1 ELSE 0 END) AS ref_only,
           COUNT(*) AS total
    FROM nodes GROUP BY type ORDER BY total DESC
  `).all();
  const edges = db.prepare('SELECT COUNT(*) c FROM edges').get().c;
  const meta = {};
  for (const r of db.prepare('SELECT k, v FROM meta').all()) meta[r.k] = r.v;
  return { byType, edges, meta };
}

// Audit findings — the "100% of declared, surface the rest" governance check.
function gaps(db, profile) {
  // 1. Dangling references: mentioned but never defined by any file.
  const placeholders = profile.mustBeDefined.map(() => '?').join(',');
  const dangling = db.prepare(`
    SELECT id, type FROM nodes
    WHERE defined = 0 AND type IN (${placeholders})
    ORDER BY type, id
  `).all(...profile.mustBeDefined);

  // 2. Pairing violations: SPEC-X without TEST-X (and vice versa).
  const { left, right, strip } = profile.pairing;
  const lefts = db.prepare('SELECT id FROM nodes WHERE type = ? AND defined = 1').all(left).map(r => r.id);
  const rights = new Set(db.prepare('SELECT id FROM nodes WHERE type = ? AND defined = 1').all(right).map(r => r.id));
  const leftsSet = new Set(lefts);
  const missingRight = [];
  for (const id of lefts) {
    const stem = id.replace(strip, '');
    if (!rights.has(right + '-' + stem)) missingRight.push(id);
  }
  const missingLeft = [];
  for (const id of rights) {
    const stem = id.replace(strip, '');
    if (!leftsSet.has(left + '-' + stem)) missingLeft.push(id);
  }

  return { dangling, missingRight, missingLeft };
}

module.exports = {
  withDb(projectRoot, fn) {
    const db = open(projectRoot);
    try { return fn(db); } finally { db.close(); }
  },
  node, list, trace, refs, impact, stats, gaps,
};
