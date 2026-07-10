// render-service/screenshot.js — headless slide screenshots via Playwright
// slidesToPngs(deckUrl, opts) → [{ index, pngBuffer, transcript }]
const { getBrowser } = require('./index');

async function slidesToPngs(deckUrl, { width = 1920, height = 1080, waitMs = 300 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  try {
    const resp = await page.goto(deckUrl, { waitUntil: 'networkidle', timeout: 30000 });
    // A 404 here (e.g. wrong workspace in the URL) would otherwise surface as the misleading
    //「找不到 .slide」below — report the real cause instead.
    if (resp && !resp.ok()) throw new Error(`deck 載入失敗（HTTP ${resp.status()}）：${deckUrl}`);

    // Wait for presentation-core to finish initialising
    await page.waitForSelector('[data-core-init="1"]', { timeout: 15000 }).catch(() => {
      // deck may not use presentation-core — proceed anyway
    });

    // Hide core shell UI (progress bar / footer / drawer / overlay) during export
    // Also force-reveal animation elements so they appear in screenshots / pptx.
    await page.addStyleTag({
      content: `
        body.exporting .progress-wrap,
        body.exporting .timer,
        body.exporting footer,
        body.exporting .tech-panel,
        body.exporting .drawer,
        body.exporting .overlay,
        body.exporting #initOverlay,
        body.exporting #hanaAvatarFloat,
        body.exporting #hana-float-widget { display: none !important; }
        body.exporting [data-anim] { opacity: 1 !important; transform: none !important; transition: none !important; }
      `
    });
    await page.evaluate(() => { document.body.classList.add('exporting'); });

    const slideCount = await page.$$eval('.slide', els => els.length);
    if (slideCount === 0) throw new Error('找不到 .slide 元素，請確認 deck 使用 presentation-core 架構');

    const results = [];
    for (let i = 0; i < slideCount; i++) {
      // Activate slide i (remove active from all, add to i-th)
      await page.evaluate((idx) => {
        document.querySelectorAll('.slide').forEach((el, j) => {
          el.classList.toggle('active', j === idx);
          el.classList.toggle('previous-slide', j === idx - 1);
        });
      }, i);

      await page.waitForTimeout(waitMs);

      // Screenshot the viewport element only (clips to 1920×1080)
      const pngBuffer = await page.screenshot({
        clip: { x: 0, y: 0, width, height },
        type: 'png',
      });

      const transcript = await page.evaluate((idx) => {
        const slide = document.querySelectorAll('.slide')[idx];
        return slide ? (slide.dataset.transcript || '') : '';
      }, i);

      results.push({ index: i, pngBuffer, transcript });
    }

    return results;
  } finally {
    await context.close();
  }
}

module.exports = { slidesToPngs };
