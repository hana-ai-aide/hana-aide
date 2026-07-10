// render-service/index.js — Playwright browser singleton
// Lazy-start on first use; shared across pptx export + Phase 2 recording.
let _browser = null;
let _playwright = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (!_playwright) {
    _playwright = require('playwright');
  }
  _browser = await _playwright.chromium.launch({ headless: true });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}

process.on('exit', () => { try { if (_browser) _browser.close(); } catch (_) {} });

module.exports = { getBrowser, closeBrowser };
