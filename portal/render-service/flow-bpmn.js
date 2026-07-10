'use strict';
// flow-bpmn.js — convert between the canonical "flow graph" (flow.json) and BPMN XML.
//
// DESIGN (per 指揮官 2026-06): the flow graph is the SOURCE OF TRUTH; the .bpmn is a generated
// projection for rendering/editing. Both encode the SAME semantics (nodes + lanes + from/to), so the
// conversion is a lossless round-trip for the semantic part. Layout (DI) is NOT stored here — the
// portal auto-lays-out at render time. Reading a flow is cheap (small JSON) vs parsing bpmn XML.
//
//   flowToBpmn(flow) → bpmn XML (no DI)        ← Hana edits flow.json, regenerates the .bpmn
//   bpmnToFlow(xml)  → flow object             ← user hand-edits .bpmn in the portal, save re-derives
//
// flow.json shape:
//   { "title": "參數採集流程",
//     "lanes": ["管理層(MES)", "設備層(AOI)", ...],            // role swimlanes, in order
//     "nodes": [ {"id":"n1","name":"開始","type":"start","lane":"設備層(AOI)"}, ... ],
//     "edges": [ {"from":"n1","to":"n2"}, {"from":"g1","to":"e1","label":"OK"}, ... ] }
//   node.type ∈ start | end | task | gateway   (default task)

const ASCII_ID = /^[A-Za-z_][\w.-]*$/;            // bpmn ids must be ASCII NCName (CJK gets dropped)
const TYPE_TO_TAG = { start: 'startEvent', end: 'endEvent', gateway: 'exclusiveGateway', task: 'task' };
const TAG_TO_TYPE = {
  startEvent: 'start', endEvent: 'end', task: 'task', userTask: 'task', serviceTask: 'task',
  manualTask: 'task', scriptTask: 'task', sendTask: 'task', receiveTask: 'task', businessRuleTask: 'task',
  exclusiveGateway: 'gateway', inclusiveGateway: 'gateway', parallelGateway: 'gateway', eventBasedGateway: 'gateway',
};

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decXml(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
}
// pull every name="value" out of a start-tag, regardless of order / namespace prefix
function tagAttrs(tag) {
  const o = {}; const re = /([\w:]+)\s*=\s*"([^"]*)"/g; let m;
  while ((m = re.exec(tag))) o[m[1].replace(/^\w+:/, '')] = decXml(m[2]);
  return o;
}

// ── flow.json → BPMN (semantics only; portal generates the layout) ──────────────────────────────
function flowToBpmn(flow) {
  flow = flow || {};
  const title = flow.title || '流程';
  // lanes may be strings ["管理層(MES)"] OR objects [{id,name}] — Hana sometimes writes objects and has
  // nodes reference the lane by `id`. Normalize so node.lane matches by id OR name; otherwise an object
  // lane gets stringified to "[object Object]" as the lane name.
  const laneList = (Array.isArray(flow.lanes) ? flow.lanes : []).map((l) => {
    if (l && typeof l === 'object') {
      const name = String(l.name != null ? l.name : (l.id != null ? l.id : ''));
      const keys = [l.id, l.name].filter((k) => k != null).map(String);
      return { name, keys: keys.length ? keys : [name] };
    }
    return { name: String(l), keys: [String(l)] };
  });
  const laneIndexByKey = {};
  laneList.forEach((ln, i) => ln.keys.forEach((k) => { if (laneIndexByKey[k] == null) laneIndexByKey[k] = i; }));
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow.edges) ? flow.edges : [];

  // map each flow node id → an ASCII bpmn id (keep it if already valid so round-trips are stable)
  const bid = {}; let c = 0; const used = new Set();
  nodes.forEach((n) => { if (n && n.id && ASCII_ID.test(n.id) && !used.has(n.id)) { bid[n.id] = n.id; used.add(n.id); } });
  nodes.forEach((n) => { if (n && n.id && bid[n.id] == null) { let id; do { id = 'Node_' + (++c); } while (used.has(id)); bid[n.id] = id; used.add(id); } });

  const laneMembers = laneList.map(() => []);
  nodes.forEach((n) => { if (!n) return; const li = laneIndexByKey[n.lane]; if (li != null) laneMembers[li].push(bid[n.id]); });

  let x = '<?xml version="1.0" encoding="UTF-8"?>\n';
  // Orientation is a RENDER preference, not part of the (DI-less) semantics — carry it as a comment
  // marker the portal reads to choose vertical vs horizontal auto-layout. Survives until the first
  // editor save (after which baked DI owns the orientation). Default: vertical (直列).
  if ((flow.orientation || 'vertical') === 'vertical') x += '<!-- harness:orientation=vertical -->\n';
  x += '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"' +
       ' xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"' +
       ' xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"' +
       ' xmlns:di="http://www.omg.org/spec/DD/20100524/DI"' +
       ' id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">\n';
  x += '  <bpmn:collaboration id="Collaboration_1">\n';
  x += '    <bpmn:participant id="Participant_1" name="' + escXml(title) + '" processRef="Process_1" />\n';
  x += '  </bpmn:collaboration>\n';
  x += '  <bpmn:process id="Process_1" isExecutable="false">\n';
  if (laneList.length) {
    x += '    <bpmn:laneSet id="LaneSet_1">\n';
    laneList.forEach((ln, i) => {
      x += '      <bpmn:lane id="Lane_' + (i + 1) + '" name="' + escXml(ln.name) + '">\n';
      laneMembers[i].forEach((id) => { x += '        <bpmn:flowNodeRef>' + id + '</bpmn:flowNodeRef>\n'; });
      x += '      </bpmn:lane>\n';
    });
    x += '    </bpmn:laneSet>\n';
  }
  nodes.forEach((n) => {
    if (!n || !n.id) return;
    const tag = TYPE_TO_TAG[n.type] || 'task';
    x += '    <bpmn:' + tag + ' id="' + bid[n.id] + '" name="' + escXml(n.name) + '" />\n';
  });
  edges.forEach((e, i) => {
    if (!e || bid[e.from] == null || bid[e.to] == null) return;
    const nm = e.label ? ' name="' + escXml(e.label) + '"' : '';
    x += '    <bpmn:sequenceFlow id="Flow_' + (i + 1) + '"' + nm +
         ' sourceRef="' + bid[e.from] + '" targetRef="' + bid[e.to] + '" />\n';
  });
  // notes → text annotations (a sticky note) + association (dashed line) to the step they explain
  const notes = Array.isArray(flow.notes) ? flow.notes : [];
  notes.forEach((nt, i) => {
    if (!nt || !nt.text || bid[nt.attachTo] == null) return;
    const aid = 'Note_' + (i + 1);
    x += '    <bpmn:textAnnotation id="' + aid + '"><bpmn:text>' + escXml(nt.text) + '</bpmn:text></bpmn:textAnnotation>\n';
    x += '    <bpmn:association id="Assoc_' + (i + 1) + '" sourceRef="' + bid[nt.attachTo] + '" targetRef="' + aid + '" />\n';
  });
  x += '  </bpmn:process>\n</bpmn:definitions>\n';
  return x;
}

// ── BPMN → flow.json (extract semantics; ignore DI/layout) ───────────────────────────────────────
function bpmnToFlow(xml) {
  const sem = String(xml || '').replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/g, '');

  // title = participant name (fallback: process id)
  const part = sem.match(/<(?:\w+:)?participant\b[^>]*>/);
  const title = part ? (tagAttrs(part[0]).name || '流程') : '流程';

  // lane membership via a position-ordered scan (correctly handles nested childLaneSet — unnamed
  // child lanes are skipped, so a node lands in its nearest NAMED ancestor lane)
  const events = [];
  let m;
  const laneOpen = /<(?:\w+:)?lane\b([^>]*)>/g;
  while ((m = laneOpen.exec(sem))) { if (/\/>\s*$/.test(m[0])) continue; const a = tagAttrs(m[0]); events.push({ pos: m.index, k: 'open', name: a.name || '' }); }
  const laneClose = /<\/(?:\w+:)?lane>/g;
  while ((m = laneClose.exec(sem))) events.push({ pos: m.index, k: 'close' });
  const ref = /<(?:\w+:)?flowNodeRef>\s*([^<\s]+)\s*<\/(?:\w+:)?flowNodeRef>/g;
  while ((m = ref.exec(sem))) events.push({ pos: m.index, k: 'ref', node: m[1] });
  events.sort((a, b) => a.pos - b.pos);
  const laneOfNode = {}; const stack = []; const laneOrder = [];
  for (const e of events) {
    if (e.k === 'open') { stack.push(e.name); if (e.name && !laneOrder.includes(e.name)) laneOrder.push(e.name); }
    else if (e.k === 'close') stack.pop();
    else for (let k = stack.length - 1; k >= 0; k--) { if (stack[k]) { laneOfNode[e.node] = stack[k]; break; } }
  }

  // nodes
  const nodes = [];
  const nodeRe = /<(?:\w+:)?(startEvent|endEvent|task|userTask|serviceTask|manualTask|scriptTask|sendTask|receiveTask|businessRuleTask|exclusiveGateway|inclusiveGateway|parallelGateway|eventBasedGateway)\b([^>]*?)\/?>/g;
  while ((m = nodeRe.exec(sem))) {
    const a = tagAttrs(m[0]); if (!a.id) continue;
    const n = { id: a.id, name: a.name || '', type: TAG_TO_TYPE[m[1]] || 'task' };
    if (laneOfNode[a.id]) n.lane = laneOfNode[a.id];
    nodes.push(n);
  }

  // edges
  const edges = [];
  const flowRe = /<(?:\w+:)?sequenceFlow\b([^>]*?)\/?>/g;
  while ((m = flowRe.exec(sem))) {
    const a = tagAttrs(m[0]); if (!a.sourceRef || !a.targetRef) continue;
    const e = { from: a.sourceRef, to: a.targetRef };
    if (a.name) e.label = a.name;
    edges.push(e);
  }

  // text annotations + associations → notes [{ text, attachTo }]
  const annos = {};
  const annoRe = /<(?:\w+:)?textAnnotation\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?textAnnotation>/g;
  while ((m = annoRe.exec(sem))) {
    const tm = m[2].match(/<(?:\w+:)?text>([\s\S]*?)<\/(?:\w+:)?text>/);
    annos[m[1]] = tm ? decXml(tm[1].trim()) : '';
  }
  const notes = [];
  const assocRe = /<(?:\w+:)?association\b([^>]*?)\/?>/g;
  while ((m = assocRe.exec(sem))) {
    const a = tagAttrs(m[0]);
    const annoId = annos[a.targetRef] != null ? a.targetRef : (annos[a.sourceRef] != null ? a.sourceRef : null);
    if (!annoId) continue;
    const nodeId = annoId === a.targetRef ? a.sourceRef : a.targetRef;
    if (nodeId) notes.push({ text: annos[annoId], attachTo: nodeId });
  }

  const flow = { title, nodes, edges };
  if (laneOrder.length) flow.lanes = laneOrder;
  if (notes.length) flow.notes = notes;
  // preserve orientation so a regenerated bpmn keeps the chosen direction (DI says isHorizontal,
  // or the comment marker if the file was never opened in the editor)
  flow.orientation = (/isHorizontal="false"/.test(xml) || /harness:orientation=vertical/i.test(xml)) ? 'vertical' : 'horizontal';
  return flow;
}

module.exports = { flowToBpmn, bpmnToFlow };

// ── CLI: node flow-bpmn.js to-bpmn <flow.json> [out.bpmn] | to-flow <in.bpmn> [out.flow.json] ─────
if (require.main === module) {
  const fs = require('fs');
  const [, , cmd, inPath, outPath] = process.argv;
  if (!cmd || !inPath) { console.error('usage: node flow-bpmn.js to-bpmn <flow.json> [out.bpmn] | to-flow <in.bpmn> [out.flow.json]'); process.exit(1); }
  const src = fs.readFileSync(inPath, 'utf8');
  if (cmd === 'to-bpmn') {
    const out = flowToBpmn(JSON.parse(src));
    const dst = outPath || inPath.replace(/\.flow\.json$/i, '').replace(/\.json$/i, '') + '.bpmn';
    fs.writeFileSync(dst, out); console.log('BPMN_FILE: ' + dst);
  } else if (cmd === 'to-flow') {
    const out = bpmnToFlow(src);
    const dst = outPath || inPath.replace(/\.bpmn$/i, '') + '.flow.json';
    fs.writeFileSync(dst, JSON.stringify(out, null, 2)); console.log('FLOW_FILE: ' + dst);
  } else { console.error('unknown command: ' + cmd); process.exit(1); }
}
