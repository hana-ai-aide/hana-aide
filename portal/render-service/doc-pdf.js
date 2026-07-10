// render-service/doc-pdf.js — print portal preview engines to PDF via Playwright, so the PDF is
// pixel-faithful to the in-portal preview. We do NOT re-implement rendering here — Playwright
// loads the real portal index.html in a dedicated print bootstrap and waits for it to signal
// window.__docPrintReady, then page.pdf() captures the DOM the user actually sees.
const { getBrowser } = require('./index');

// DV-05/06 (SPEC-document-registry §12): pptx/workbook → PDF via the SAME Playwright print
// mechanism — no LibreOffice. printUrl is `/?print=pptx|workbook&path=<source>&workspace=<ws>`;
// the bootstrap renders the real preview engine (_renderPptxInto / a print-all-sheets variant of
// _renderSheetInto) into #doc-print-root, injects an `@page { size: … }` rule sized to match
// (pptx: measured from the rendered slide box so it matches the deck's actual aspect ratio,
// usually 16:9; workbook: static A4 portrait), and flips the same window.__docPrintReady flag.
// preferCSSPageSize is required here — passing an explicit page.pdf({width,height}) instead
// empirically comes out portrait-swapped when a global `@page { size: A4 }` rule is also present
// on the page (a real Chromium quirk, confirmed while building this), so CSS must stay the single
// source of truth for page geometry.
async function officeToPdf(printUrl, { waitMs = 400 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const resp = await page.goto(printUrl, { waitUntil: 'networkidle', timeout: 45000 });
    if (resp && !resp.ok()) throw new Error(`頁面載入失敗（HTTP ${resp.status()}）：${printUrl}`);

    await page.waitForFunction(() => window.__docPrintReady === true, { timeout: 45000 });
    const err = await page.evaluate(() => window.__docPrintError || null);
    if (err) throw new Error('渲染失敗：' + err);

    await page.waitForTimeout(waitMs);

    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
  } finally {
    await context.close();
  }
}

module.exports = { officeToPdf };
