'use strict';

// docgraph — a governance/spec knowledge graph for markdown corpora.
// Sibling to codegraph: same "global tool, per-project .docgraph/ db" model,
// but it indexes IDs/relations in documents instead of symbols in code.
//
//   node --experimental-sqlite cli.js index   --root <path> [--profile hana]
//   node --experimental-sqlite cli.js list [type] --root <path>   # e.g. `list spec`
//   node --experimental-sqlite cli.js stats    --root <path>
//   node --experimental-sqlite cli.js gaps     --root <path>
//
// All read commands auto-reindex if the corpus changed (pass --no-fresh to opt out),
// so a query never serves a stale spec list.
//   node --experimental-sqlite cli.js impact <id> --root <path>
//   node --experimental-sqlite cli.js refs   <id> --root <path>
//   node --experimental-sqlite cli.js trace  <id> --root <path>

const path = require('path');
const { index, isStale } = require('./indexer');
const q = require('./query');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = argv[++i];
    else if (argv[i] === '--profile') out.profile = argv[++i];
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--no-fresh') out.noFresh = true;
    else out._.push(argv[i]);
  }
  return out;
}

// Before any read, silently reindex if the corpus changed — so a query can never
// serve a stale spec list. Note goes to stderr so it never pollutes --json stdout.
// `--no-fresh` opts out (use the snapshot as-is).
function ensureFresh(root, profile, args) {
  if (args.noFresh) return;
  const s = isStale(root, profile);
  if (!s.stale) return;
  const r = index(root, profile);
  if (!args.json) console.error(`[docgraph] index was stale (${s.reason}) — reindexed ${r.files} files`);
}

function loadProfile(name) {
  return require('./profiles/' + (name || 'hana'));
}

function fmtNode(n) {
  const title = n.title && n.title !== n.id ? `  — ${n.title}` : '';
  const where = n.file ? `  (${n.file})` : '';
  const depth = n.depth !== undefined ? `[d${n.depth}] ` : '';
  return `  ${depth}${n.type.padEnd(4)} ${n.id}${title}${where}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const root = path.resolve(args.root || process.cwd());
  const profile = loadProfile(args.profile);

  if (cmd === 'index') {
    const r = index(root, profile);
    if (args.json) return console.log(JSON.stringify(r));
    console.log(`[docgraph] indexed "${profile.name}" @ ${root}`);
    console.log(`  scanned files : ${r.files}`);
    console.log(`  nodes         : ${r.totalNodes} (${r.definedNodes} defined by a file, ${r.totalNodes - r.definedNodes} referenced-only)`);
    console.log(`  edges         : ${r.edges}`);
    console.log(`  db            : ${path.join(root, '.docgraph', 'docgraph.db')}`);
    return;
  }

  if (cmd === 'list') {
    ensureFresh(root, profile, args);
    const type = args._[1] ? args._[1].toUpperCase() : null;
    return q.withDb(root, db => {
      const rows = q.list(db, type);
      if (args.json) return console.log(JSON.stringify(rows, null, 2));
      console.log(`[docgraph] ${type || 'all'} nodes @ ${root}: ${rows.length}\n`);
      rows.forEach(n => console.log(fmtNode(n)));
    });
  }

  if (cmd === 'stats') {
    ensureFresh(root, profile, args);
    return q.withDb(root, db => {
      const s = q.stats(db);
      if (args.json) return console.log(JSON.stringify(s, null, 2));
      console.log(`[docgraph] ${root}  (profile=${s.meta.profile}, indexed ${s.meta.indexedAt})`);
      console.log(`  type      file  registry  ref-only  total`);
      for (const t of s.byType) console.log(`  ${t.type.padEnd(5)}  ${String(t.file).padStart(6)}  ${String(t.registry).padStart(8)}  ${String(t.ref_only).padStart(8)}  ${String(t.total).padStart(5)}`);
      console.log(`  edges: ${s.edges}`);
    });
  }

  if (cmd === 'gaps') {
    ensureFresh(root, profile, args);
    return q.withDb(root, db => {
      const g = q.gaps(db, profile);
      if (args.json) return console.log(JSON.stringify(g, null, 2));
      console.log(`[docgraph] gap audit @ ${root}\n`);
      console.log(`🔴 Dangling references (mentioned, never defined): ${g.dangling.length}`);
      g.dangling.slice(0, 40).forEach(d => console.log(`   ${d.type.padEnd(4)} ${d.id}`));
      if (g.dangling.length > 40) console.log(`   ... +${g.dangling.length - 40} more`);
      console.log(`\n🟠 SPEC without TEST: ${g.missingRight.length}`);
      g.missingRight.forEach(id => console.log(`   ${id}`));
      console.log(`\n🟠 TEST without SPEC: ${g.missingLeft.length}`);
      g.missingLeft.forEach(id => console.log(`   ${id}`));
    });
  }

  if (cmd === 'impact' || cmd === 'refs' || cmd === 'trace') {
    const id = args._[1];
    if (!id) { console.error('Missing <id>'); process.exit(1); }
    ensureFresh(root, profile, args);
    return q.withDb(root, db => {
      const self = q.node(db, id);
      const rows = cmd === 'impact' ? q.impact(db, id) : cmd === 'refs' ? q.refs(db, id) : q.trace(db, id);
      if (args.json) return console.log(JSON.stringify({ node: self, [cmd]: rows }, null, 2));
      if (!self) { console.log(`(node ${id} not found — run 'index' first, or check the id)`); return; }
      const label = { impact: '受影響 (transitive dependents)', refs: '直接引用者 (incoming)', trace: '依賴/提及 (outgoing)' }[cmd];
      console.log(`[docgraph] ${cmd}  ${self.type} ${self.id}${self.title ? '  — ' + self.title : ''}`);
      console.log(`  ${label}: ${rows.length}\n`);
      rows.forEach(n => console.log(fmtNode(n)));
    });
  }

  console.error('Usage: index | list [type] | stats | gaps | impact <id> | refs <id> | trace <id>   [--root <path>] [--profile <name>] [--json] [--no-fresh]');
  process.exit(1);
}

main();
