#!/usr/bin/env node
'use strict';
// flow-decisions.js — 流程圖判斷持久化 manifest（SPEC-doc-editing §13.13）。
// 工作區一份 <wsRoot>/.documents/flow-decisions.json，keyed by「來源檔身分 sourcePath」→ imageN → 決策。
// 綁 sourcePath（不是 UUID）→ 指揮官「從列表刪除 → 重匯（新 UUID）」也保住決策；imageN 對同一份
// source.docx 抽取順序穩定，故 sourcePath+imageN 是穩定鍵。
//
// doc-flowchart skill 用它做持久化（AI 不用手 parse JSON）：
//   node flow-decisions.js bootstrap <wsRoot> <docId>
//       第一次跑：從現有 doc.md 唯讀推導（真身 bpmn→flow、_pending/純圖→undecided），只補未決的，
//       不動 doc.md/bpmn/source。印出全部決策 + 哪些 undecided（＝這次才要看圖的）。
//   node flow-decisions.js get <wsRoot> <docId>
//       印出該檔目前決策 { imageN: {kind,subflows,reason,by,at} }。
//   node flow-decisions.js set <wsRoot> <docId> <imageN> <kind> [--subflows a,b] [--reason "..."] [--by X]
//       kind ∈ flow|notflow|undecided。判完/人工修正後寫回。
//
// 純資料層：只讀寫 flow-decisions.json + 唯讀掃 doc.md/assets（bootstrap 用），不改任何內容檔。

const fs = require('fs');
const path = require('path');

function manifestPath(wsRoot) { return path.join(wsRoot, '.documents', 'flow-decisions.json'); }

function load(wsRoot) {
  try { return JSON.parse(fs.readFileSync(manifestPath(wsRoot), 'utf8')); }
  catch (e) { return { version: 1, docs: {} }; }
}
function save(wsRoot, m) {
  const p = manifestPath(wsRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(m, null, 2), 'utf8');
}

// docId → { sourcePath(正規化為斜線，穩定鍵), dir }
function resolveDoc(wsRoot, docId) {
  const idx = JSON.parse(fs.readFileSync(path.join(wsRoot, '.documents', 'index.json'), 'utf8'));
  const arr = Array.isArray(idx) ? idx : (idx.documents || Object.values(idx).find(Array.isArray) || []);
  const d = arr.find(x => x && x.id === docId);
  if (!d) throw new Error('doc not found in index.json: ' + docId);
  const sourcePath = String(d.sourcePath || d.id).replace(/\\/g, '/');
  return { sourcePath, dir: path.join(wsRoot, '.documents', docId) };
}

function nowISO() { return new Date().toISOString(); }

// 真身 bpmn（有 task/sequenceFlow）vs pending 骨架
function bpmnIsReal(p) {
  try { return /bpmn:task|bpmn:sequenceFlow|<task|<sequenceFlow/i.test(fs.readFileSync(p, 'utf8')); }
  catch (e) { return false; }
}

// 從 doc.md 唯讀推導決策（不覆蓋既有）。真身 bpmn→flow；_pending/純圖→undecided。
function bootstrap(wsRoot, docId) {
  const { sourcePath, dir } = resolveDoc(wsRoot, docId);
  const m = load(wsRoot);
  const cur = m.docs[sourcePath] || (m.docs[sourcePath] = {});
  let md = '';
  try { md = fs.readFileSync(path.join(dir, 'doc.md'), 'utf8'); } catch (e) {}

  const preExisting = new Set(Object.keys(cur));            // 先前既有決策（不覆蓋）
  const seen = new Set();
  // ```bpmn fence（含矩陣子流程 imageN_<階段>.bpmn）
  const fenceRe = /```bpmn[ \t]*([^\n]*)\r?\n([\s\S]*?)```/g;
  let fm;
  while ((fm = fenceRe.exec(md))) {
    const ref = ((fm[2].split(/\r?\n/).map(function (s) { return s.trim(); }).find(Boolean)) || fm[1] || '').trim();
    const mn = ref.match(/image(\d+)(?:_([^./]*))?\.bpmn/i);
    if (!mn) continue;
    const key = 'image' + mn[1];
    seen.add(key);
    if (preExisting.has(key)) continue;                     // 既有決策不覆蓋
    const sfx = mn[2] || '';
    const isPending = /^pending$/i.test(sfx) || /_pending\.bpmn$/i.test(ref);
    if (!isPending && bpmnIsReal(path.join(dir, ref))) {
      // 同一 imageN 的多個子流程要累加（別被第二個 fence 擋掉）
      if (!cur[key] || cur[key].kind !== 'flow') cur[key] = { kind: 'flow', subflows: [], by: 'bootstrap', at: nowISO() };
      if (sfx && !/^pending$/i.test(sfx)) {
        cur[key].subflows = cur[key].subflows || [];
        if (cur[key].subflows.indexOf(sfx) < 0) cur[key].subflows.push(sfx);
      }
    } else if (!cur[key]) {                                 // pending → undecided（勿把本回已定的 flow 降級）
      cur[key] = { kind: 'undecided', by: 'bootstrap', at: nowISO() };
    }
  }
  // 純圖 ![](assets/imageN.png)（可能是漏標的流程圖 → undecided，要看）
  const imgRe = /!\[[^\]]*\]\(assets\/image(\d+)\.[a-z0-9]+\)/gi;
  let im;
  while ((im = imgRe.exec(md))) {
    const key = 'image' + im[1];
    if (seen.has(key) || preExisting.has(key) || cur[key]) continue;
    cur[key] = { kind: 'undecided', by: 'bootstrap', at: nowISO() };
  }
  save(wsRoot, m);
  const undecided = Object.keys(cur).filter(function (k) { return cur[k].kind === 'undecided'; });
  return { sourcePath: sourcePath, decisions: cur, undecided: undecided };
}

function getDecisions(wsRoot, docId) {
  const { sourcePath } = resolveDoc(wsRoot, docId);
  const m = load(wsRoot);
  return { sourcePath: sourcePath, decisions: m.docs[sourcePath] || {} };
}

function setDecision(wsRoot, docId, imageN, kind, opts) {
  if (['flow', 'notflow', 'undecided'].indexOf(kind) < 0) throw new Error('kind must be flow|notflow|undecided');
  const { sourcePath } = resolveDoc(wsRoot, docId);
  const m = load(wsRoot);
  const cur = m.docs[sourcePath] || (m.docs[sourcePath] = {});
  const key = /^image\d+$/i.test(imageN) ? imageN.toLowerCase() : ('image' + imageN);
  const rec = { kind: kind, by: opts.by || 'doc-flowchart', at: nowISO() };
  if (opts.subflows) rec.subflows = opts.subflows.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (opts.reason) rec.reason = opts.reason;
  cur[key] = rec;
  save(wsRoot, m);
  return { sourcePath: sourcePath, image: key, decision: rec };
}

function parseOpts(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--subflows') o.subflows = args[++i];
    else if (args[i] === '--reason') o.reason = args[++i];
    else if (args[i] === '--by') o.by = args[++i];
  }
  return o;
}

function main() {
  const [cmd, wsRoot, docId, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'bootstrap') {
      console.log(JSON.stringify(bootstrap(wsRoot, docId), null, 2));
    } else if (cmd === 'get') {
      console.log(JSON.stringify(getDecisions(wsRoot, docId), null, 2));
    } else if (cmd === 'set') {
      const imageN = rest[0], kind = rest[1];
      console.log(JSON.stringify(setDecision(wsRoot, docId, imageN, kind, parseOpts(rest.slice(2))), null, 2));
    } else {
      console.error('usage: flow-decisions.js <bootstrap|get|set> <wsRoot> <docId> [...]');
      process.exit(1);
    }
  } catch (e) {
    console.error('ERROR: ' + (e && e.message || e));
    process.exit(1);
  }
}
main();
