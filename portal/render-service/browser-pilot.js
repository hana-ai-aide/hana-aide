// render-service/browser-pilot.js — interactive browser driver for the agent (Hana)
//
// Unlike screenshot.js (one-shot, hard-wired to `.slide` deck export), this is a LONG-LIVED
// daemon that lets the agent drive a real browser in a perceive→act loop:
//   start daemon once  →  POST a batch of actions  →  daemon auto-screenshots  →
//   agent reads the PNG + the returned element list  →  decides next action  →  repeat.
//
// The Playwright page persists ACROSS requests (that's the whole point — the agent clicks one
// step at a time and looks between steps), so it shares the same chromium singleton as the
// pptx/record pipeline via ./index getBrowser().
//
// HEADFUL vs HEADLESS: by default the pilot runs HEADLESS (no visible window) — good for background
// /scheduled jobs. Pass { headful:true } to /open (or env PILOT_HEADFUL=1) to launch a REAL visible
// window the commander can watch live. The pilot owns its OWN browser instance (NOT the shared
// headless singleton in ./index used by pptx/record), so toggling headful here never disturbs those
// background pipelines. Switching mode relaunches the pilot browser; the page is reopened fresh.
//
// Control API (POST JSON, tiny built-in http server — no express dep):
//   POST /open   { width?, height?, workspace?, headful?, userAgent?, locale? }   open a fresh context/page
//                (workspace → X-Workspace header; userAgent/locale let you look like a real browser —
//                 some sites that sniff HeadlessChrome serve a broken no-JS page to the default UA)
//   POST /act    { steps:[...], shot?:{...} }       run actions, then screenshot
//   POST /shot   { fullPage?, selector?, clip?, name? }   just screenshot the current page
//   POST /close  {}                                 close the context (browser singleton stays warm)
//   GET  /health                                    { ok:true }
//
// Step forms (each element of steps[]):
//   { goto: "<url>", waitUntil?: "networkidle"|"load"|"domcontentloaded" }
//   { click: "<selector>" }            { dblclick: "<selector>" }
//   { fill: ["<selector>", "<text>"] } { type: ["<selector>", "<text>"] }
//   { press: "<key>" }  or  { press: ["<selector>", "<key>"] }
//   { hover: "<selector>" }
//   { scroll: "<selector>" }  or  { scroll: [x, y] }
//   { waitFor: "<selector>" }  { wait: <ms> }
//   { setViewport: [w, h] }
//   { evaluate: "<js expression>" }
//
// Screenshot opts (shot object):  { fullPage?:bool, selector?:"<sel>", clip?:{x,y,width,height}, name?:"<basename>" }
//
// Every /act and /shot response returns: { ok, url, title, shot:"<abs png path>", elements:[...] }
// where elements is a capped list of the visible interactive controls (buttons/links/inputs),
// each tagged in-page with data-pilot-id so the agent can target it precisely:  [data-pilot-id="12"].

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PILOT_PORT ? parseInt(process.env.PILOT_PORT, 10) : 3390;

let _context = null;
let _page = null;
let _shotSeq = 0;
// Last workspace set by /open — used by subsequent /act and /shot so screenshots land in the right place.
let _workspace = null;

// Resolve screenshot directory at shot time (not at startup) so the dir follows the workspace.
// Priority: (1) PILOT_SHOT_DIR env → (2) <workspace>/.harness/runtime/pilot/ → (3) harness home fallback.
function getShotDir() {
  if (process.env.PILOT_SHOT_DIR) return path.resolve(process.env.PILOT_SHOT_DIR);
  const base = _workspace || process.env.HARNESS_HOME || process.cwd();
  return path.join(base, '.harness', 'runtime', 'pilot');
}

// Pilot owns its OWN browser (separate from the shared headless singleton) so it can run headful
// without disturbing the pptx/record pipeline. _headful tracks the current mode; changing it
// relaunches the browser.
let _browser = null;
let _headful = process.env.PILOT_HEADFUL === '1' || process.env.PILOT_HEADFUL === 'true';

function wantHeadful(headful) {
  return (headful === undefined || headful === null) ? _headful : !!headful;
}

async function getPilotBrowser(headful) {
  const want = wantHeadful(headful);
  if (_browser && _browser.isConnected() && _headful === want) return _browser;
  if (_browser) { try { await _browser.close(); } catch (_) {} _browser = null; _context = null; _page = null; }
  const playwright = require('playwright');
  _browser = await playwright.chromium.launch({ headless: !want });
  _headful = want;
  console.log(`[browser-pilot] browser launched (${want ? 'HEADFUL — visible window' : 'headless'})`);
  return _browser;
}

async function ensurePage(opts = {}) {
  if (_page && !_page.isClosed()) return _page;
  return openPage(opts);
}

async function openPage({ width = 1440, height = 900, workspace = null, headful, userAgent = null, locale = null } = {}) {
  if (_context) { try { await _context.close(); } catch (_) {} _context = null; _page = null; }
  const browser = await getPilotBrowser(headful);
  const ctxOpts = { viewport: { width, height }, deviceScaleFactor: 1 };
  // A real-browser UA/locale — some sites that sniff HeadlessChrome otherwise serve a
  // degraded no-script page whose login button never submits.
  if (userAgent) ctxOpts.userAgent = userAgent;
  if (locale) ctxOpts.locale = locale;
  if (workspace) {
    // HTTP headers must be ASCII; workspace paths can be non-ASCII (e.g. 範例專案) — %-encode, exactly
    // how the frontend feeds resolveWorkspace() in server.js.
    ctxOpts.extraHTTPHeaders = { 'X-Workspace': encodeURIComponent(workspace) };
  }
  _context = await browser.newContext(ctxOpts);
  _page = await _context.newPage();
  return _page;
}

async function runStep(page, step) {
  const key = Object.keys(step)[0];
  const val = step[key];
  switch (key) {
    case 'goto': {
      const waitUntil = step.waitUntil || 'networkidle';
      const resp = await page.goto(val, { waitUntil, timeout: 30000 });
      if (resp && !resp.ok()) throw new Error(`goto 失敗（HTTP ${resp.status()}）：${val}`);
      return;
    }
    case 'click':       return void await page.click(val, { timeout: 10000 });
    case 'dblclick':    return void await page.dblclick(val, { timeout: 10000 });
    case 'fill':        return void await page.fill(val[0], val[1], { timeout: 10000 });
    case 'type':        return void await page.type(val[0], val[1], { timeout: 10000, delay: 20 });
    case 'press':
      if (Array.isArray(val)) return void await page.press(val[0], val[1], { timeout: 10000 });
      return void await page.keyboard.press(val);
    case 'hover':       return void await page.hover(val, { timeout: 10000 });
    case 'scroll':
      if (Array.isArray(val)) return void await page.evaluate(([x, y]) => window.scrollTo(x, y), val);
      return void await page.locator(val).scrollIntoViewIfNeeded({ timeout: 10000 });
    case 'waitFor':     return void await page.waitForSelector(val, { timeout: 15000 });
    case 'wait':        return void await page.waitForTimeout(val);
    case 'setViewport': return void await page.setViewportSize({ width: val[0], height: val[1] });
    case 'upload':      return void await page.locator(val[0]).setInputFiles(val[1], { timeout: 10000 });
    case 'clickAndUpload': {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.click(val[0], { timeout: 10000 }),
      ]);
      return void await chooser.setFiles(val[1]);
    }
    case 'evaluate':    return void await page.evaluate(val);
    case 'clickAt':     return void await page.mouse.click(val[0], val[1]);
    case 'clickAtAndUpload': {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.mouse.click(val[0][0], val[0][1]),
      ]);
      return void await chooser.setFiles(val[1]);
    }
    default: throw new Error(`未知步驟：${key}`);
  }
}

// Enumerate visible interactive controls and tag each with data-pilot-id so the agent can target
// it precisely. Returns a capped, compact list — text is the agent's anchor; data-pilot-id the handle.
async function enumElements(page, cap = 50) {
  return page.evaluate((cap) => {
    const sel = 'a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[onclick],summary,label';
    const out = [];
    let i = 0;
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && r.bottom > 0 && r.top < (window.innerHeight + 2000);
      if (!visible) continue;
      el.setAttribute('data-pilot-id', String(i));
      let text = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.value || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      out.push({
        pid: i,
        tag: el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : ''),
        text,
        onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
      });
      i++;
      if (i >= cap) break;
    }
    return out;
  }, cap);
}

async function snapshot(page, shot = {}) {
  const { fullPage = false, selector = null, clip = null, name = null } = shot;
  const shotDir = getShotDir();
  fs.mkdirSync(shotDir, { recursive: true });
  const base = (name ? name.replace(/[^\w.-]/g, '_') : `shot_${String(++_shotSeq).padStart(3, '0')}_${Date.now()}`);
  const file = path.join(shotDir, base.endsWith('.png') ? base : `${base}.png`);
  const opts = { type: 'png', path: file };
  if (selector) {
    await page.locator(selector).screenshot({ path: file, type: 'png' });
  } else {
    if (fullPage) opts.fullPage = true;
    if (clip) opts.clip = clip;
    await page.screenshot(opts);
  }
  let title = '', curUrl = '';
  try { title = await page.title(); } catch (_) {}
  try { curUrl = page.url(); } catch (_) {}
  const elements = await enumElements(page).catch(() => []);
  return { shot: file, url: curUrl, title, elements };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, port: PORT, shotDir: getShotDir(), headful: _headful });
    if (req.method !== 'POST') return send(404, { ok: false, error: 'use POST' });
    const body = await readBody(req);

    if (req.url === '/open') {
      _workspace = body.workspace ?? null;
      await openPage(body);
      return send(200, { ok: true, shotDir: getShotDir(), headful: _headful });
    }
    if (req.url === '/act') {
      const page = await ensurePage(body);
      for (const step of (body.steps || [])) await runStep(page, step);
      const snap = await snapshot(page, body.shot || {});
      return send(200, { ok: true, ...snap });
    }
    if (req.url === '/eval') {
      const page = await ensurePage();
      const result = await page.evaluate(body.expr);
      return send(200, { ok: true, result });
    }
    if (req.url === '/shot') {
      const page = await ensurePage();
      const snap = await snapshot(page, body || {});
      return send(200, { ok: true, ...snap });
    }
    if (req.url === '/close') {
      if (_context) { try { await _context.close(); } catch (_) {} }
      _context = null; _page = null;
      return send(200, { ok: true });
    }
    return send(404, { ok: false, error: `unknown route ${req.url}` });
  } catch (e) {
    return send(500, { ok: false, error: e.message, stack: (e.stack || '').split('\n').slice(0, 4).join('\n') });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[browser-pilot] listening on http://127.0.0.1:${PORT}  shots → <workspace>/.harness/runtime/pilot/ (resolved at shot time)`);
});

process.on('SIGINT', () => { try { if (_browser) _browser.close(); } catch (_) {} process.exit(0); });
process.on('exit', () => { try { if (_browser) _browser.close(); } catch (_) {} });
