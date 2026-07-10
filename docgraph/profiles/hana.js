'use strict';

/**
 * Profile: hana (default governance profile)
 *
 * The ONE project-specific piece. Encodes how a project declares and
 * cross-references its governance IDs. A different project would ship a different
 * profile; the docgraph engine itself stays generic.
 *
 * Derived from the real corpus (governance/ specs/ legislation/ .worktable/ .agent/):
 *   R-0001 | R-MDM-0032 | R-MFG-0001        requirements (optional DOMAIN segment)
 *   F-0032 == F-0032-ReadinessEngine        features (trailing name is a label -> canonical F-####)
 *   LP-0010                                  senate legislation proposals
 *   ADR-20260415-002                         architecture decision records
 *   BR-AUTH-002 | BR-RDE-RULE-01             business rules (always end in a number)
 *   SPEC-ROUTING.md <-> TEST-ROUTING.md      paired spec/test (constitutional 鐵律)
 */

// Template placeholders that look like IDs but are not real nodes.
const PLACEHOLDER = /x{3,}|n{3,}|^BR-ID$/i;

// Each pattern is matched globally over file text. `canonical` (optional) collapses
// label variants onto a single node id.
const ID_PATTERNS = [
  { type: 'R',    re: /\bR-(?:[A-Z]{2,5}-)?\d{4}\b/g },
  { type: 'F',    re: /\bF-\d{4}(?:-[A-Za-z][A-Za-z0-9]*)?\b/g, canonical: id => id.match(/^F-\d{4}/)[0] },
  { type: 'LP',   re: /\bLP-\d{4}\b/g },
  { type: 'ADR',  re: /\bADR-\d{8}-\d{3}\b/g },
  { type: 'CASE', re: /\bCASE-\d{4,8}(?:-\d{1,3})?\b/g },
  { type: 'BR',   re: /\bBR-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-?\d+\b/g },
];

module.exports = {
  name: 'hana',

  // Directories (relative to project root) that hold governed documents.
  docDomains: ['governance', 'specs', 'legislation', '.worktable', '.agent'],

  // Skip these directory names anywhere in the tree.
  skipDirs: ['node_modules', '.git', '.next', 'dist', 'build', 'out', 'publish',
             'app_data', '.codegraph', '.docgraph', '.claude', 'chat_history'],

  idPatterns: ID_PATTERNS,

  isPlaceholder(token) {
    return PLACEHOLDER.test(token);
  },

  // Canonicalize a raw matched token onto its node id (e.g. F-0032-X -> F-0032).
  canonical(type, token) {
    const p = ID_PATTERNS.find(x => x.type === type);
    return p && p.canonical ? p.canonical(token) : token;
  },

  // What node, if any, does a file's NAME define? Returns {type,id} or null.
  fileDefines(basename) {
    const stem = basename.replace(/\.(md|markdown)$/i, '');
    if (/^SPEC-/.test(stem)) return { type: 'SPEC', id: stem };
    if (/^TEST-/.test(stem)) return { type: 'TEST', id: stem };
    for (const p of ID_PATTERNS) {
      const m = stem.match(new RegExp('^' + p.re.source.replace(/\\b/g, '') + '$'));
      if (m) return { type: p.type, id: this.canonical(p.type, stem) };
    }
    return null;
  },

  // What node OWNS a file by virtue of its directory path? e.g. a meeting note under
  // _features/F-0032-ReadinessEngine/meetings/ is owned by F-0032. Most specific wins.
  dirOwner(relPath) {
    const segments = relPath.split('/').slice(0, -1); // exclude the filename
    let owner = null;
    for (const seg of segments) {
      for (const p of ID_PATTERNS) {
        const m = seg.match(new RegExp('^' + p.re.source.replace(/\\b/g, '') + '$'));
        if (m && !this.isPlaceholder(seg)) {
          owner = { type: p.type, id: this.canonical(p.type, seg) };
        }
      }
    }
    return owner;
  },

  // Paired-document rule for the gaps audit: every SPEC-X must have a TEST-X.
  pairing: { left: 'SPEC', right: 'TEST', strip: /^SPEC-|^TEST-/ },

  // Node types that, when referenced but never defined AT ALL, count as dangling.
  mustBeDefined: ['R', 'F', 'SPEC', 'TEST', 'LP', 'ADR'],

  // Registry files: a single doc that AUTHORITATIVELY defines many IDs as list/log
  // entries rather than as dedicated files. IDs of the declared type that appear here
  // are "registry-defined" (a real definition, just not a standalone file) — so they
  // must NOT be reported as dangling. Matched by basename.
  registries: [
    { basename: 'ADR_LOG.md',              defines: ['ADR'] },
    { basename: 'Requirement_List.md',     defines: ['R'] },
    { basename: 'implementation-rules.md', defines: ['BR'] },
  ],

  registryDefines(relPath) {
    const base = relPath.split('/').pop();
    const hit = this.registries.find(r => r.basename === base);
    return hit ? hit.defines : null;
  },
};
