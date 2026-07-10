'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// Open (or create) the per-project docgraph database at <root>/.docgraph/docgraph.db.
// Mirrors codegraph's "global code, per-project db" model.
function open(projectRoot) {
  const dir = path.join(projectRoot, '.docgraph');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'docgraph.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id      TEXT PRIMARY KEY,
      type    TEXT NOT NULL,
      title   TEXT,
      file    TEXT,
      defined INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS edges (
      src      TEXT NOT NULL,
      dst      TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'mentions',
      file     TEXT,
      UNIQUE(src, dst, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
    CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);
}

function reset(db) {
  db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM meta;');
}

module.exports = { open, initSchema, reset };
