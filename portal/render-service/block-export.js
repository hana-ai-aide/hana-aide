// block-export.js — Block deck JSON → native editable pptx via PptxGenJS
// Phase 3: PRES-BLOCK-02
// custom layout: text placeholder + HTML in speaker notes (future: screenshot fallback)

const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

// Design tokens — match presentation-core.css
const C = {
  BG:         '020617',
  TITLE:      'FFFFFF',
  ACCENT:     '22D3EE',
  BLUE:       '60A5FA',
  TEXT:       'E5EDF8',
  MUTED:      '9FB0C6',
  LINE:       '1E3A5F',
  TH_BG:      '0D1F3C',
  TD_BG:      '050F1E',
  TD_BG_ALT:  '030A15',
  QUOTE_DEC:  '0D3D4D',  // faded accent for decorative quote mark
};

// Slide dimensions: LAYOUT_WIDE = 13.33" × 7.5"（PptxGenJS 內建 16:9 寬版）。
// 注意：LAYOUT_16x9 其實是 10×5.625，用它會跟下面 13.33×7.5 的座標對不上 → 整個跑版。
const W = 13.33;
const H = 7.5;
const M = 0.5;          // margin
const CW = W - M * 2;  // content width = 12.33"

// ── Per-slide helpers ──────────────────────────────────────────────────────

function addKicker(slide, text, y) {
  if (!text) return;
  slide.addText(text.toUpperCase(), {
    x: M, y: y, w: CW, h: 0.42,
    fontSize: 14, fontFace: 'Consolas',
    color: C.ACCENT, charSpacing: 2.5,
  });
}

function addTitleBar(slide, text, y, size) {
  // Left accent rectangle
  slide.addShape('rect', {
    x: M, y: y, w: 0.07, h: 0.85,
    fill: { color: C.ACCENT },
    line: { color: C.ACCENT, pt: 0 },
  });
  slide.addText(text, {
    x: M + 0.18, y: y, w: CW - 0.18, h: 0.85,
    fontSize: size || 28, bold: true, color: C.TITLE,
    fontFace: 'Calibri', valign: 'middle',
  });
}

function applyBg(slide) {
  slide.background = { color: C.BG };
}

// ── Layout renderers ───────────────────────────────────────────────────────

function rTitle(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  const hasKicker = !!block.kicker;
  if (hasKicker) addKicker(slide, block.kicker, 2.0);

  const ty = hasKicker ? 2.55 : 2.3;
  slide.addText(block.title || '', {
    x: M, y: ty, w: CW, h: 1.5,
    fontSize: 54, bold: true, color: C.TITLE,
    fontFace: 'Calibri', align: 'center', valign: 'middle', autoFit: true,
  });
  if (block.subtitle) {
    slide.addText(block.subtitle, {
      x: M, y: ty + 1.6, w: CW, h: 0.85,
      fontSize: 26, color: C.MUTED,
      fontFace: 'Calibri', align: 'center', valign: 'middle',
    });
  }
  if (block.transcript) slide.addNotes(block.transcript);
}

function rBullets(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  const hasKicker = !!block.kicker;
  let ty = 0.35;
  if (hasKicker) { addKicker(slide, block.kicker, 0.3); ty = 0.72; }
  addTitleBar(slide, block.title || '', ty, 28);

  const contentY = ty + 1.05;
  const bullets = (block.bullets || []);
  if (bullets.length === 0) { if (block.transcript) slide.addNotes(block.transcript); return; }

  const textItems = bullets.map(b => ({
    text: b.text || '',
    options: {
      bullet: b.level > 1 ? { indent: 35 } : true,
      fontSize: b.level > 1 ? 20 : 24,
      color: b.level > 1 ? C.MUTED : C.TEXT,
      paraSpaceAfter: b.level > 1 ? 6 : 10,
      fontFace: 'Calibri',
      breakLine: true,
    },
  }));

  slide.addText(textItems, {
    x: M + 0.2, y: contentY, w: CW - 0.2, h: H - contentY - M,
    valign: 'top',
  });
  if (block.transcript) slide.addNotes(block.transcript);
}

function rTable(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  const hasKicker = !!block.kicker;
  let ty = 0.35;
  if (hasKicker) { addKicker(slide, block.kicker, 0.3); ty = 0.72; }
  addTitleBar(slide, block.title || '', ty, 28);

  const td = block.table || {};
  const headers = td.headers || [];
  const rows = td.rows || [];
  if (!headers.length) { if (block.transcript) slide.addNotes(block.transcript); return; }

  const tableY = ty + 1.05;
  const tableH = H - tableY - M;
  const rowCount = 1 + rows.length;
  const rowH = Math.max(0.45, Math.min(0.75, tableH / rowCount));
  const colW = headers.map(() => CW / headers.length);

  const headerRow = headers.map(h => ({
    text: h,
    options: {
      bold: true, color: C.TITLE,
      fill: { color: C.TH_BG },
      fontFace: 'Consolas', fontSize: 17,
      align: 'left', valign: 'middle',
    },
  }));

  const dataRows = rows.map((row, ri) =>
    row.map((cell, ci) => ({
      text: String(cell),
      options: {
        color: ci === 0 ? C.TITLE : C.TEXT,
        bold: ci === 0,
        fill: { color: ri % 2 === 0 ? C.TD_BG : C.TD_BG_ALT },
        fontSize: 17, fontFace: 'Calibri',
        align: 'left', valign: 'middle',
      },
    }))
  );

  slide.addTable([headerRow, ...dataRows], {
    x: M, y: tableY, w: CW,
    rowH: rowH,
    border: { type: 'solid', pt: 0.5, color: C.LINE },
    colW: colW,
  });
  if (block.transcript) slide.addNotes(block.transcript);
}

function rImage(pptx, block, harnesshome) {
  const slide = pptx.addSlide();
  applyBg(slide);

  const hasKicker = !!block.kicker;
  let ty = 0.35;
  if (hasKicker) { addKicker(slide, block.kicker, 0.3); ty = 0.72; }
  const hasTitle = !!block.title;
  if (hasTitle) addTitleBar(slide, block.title, ty, 26);

  const imgY = hasTitle ? (ty + 1.05) : M;
  const capH = block.caption ? 0.5 : 0;
  const imgH = H - imgY - M - capH;

  if (block.imagePath) {
    const absPath = path.isAbsolute(block.imagePath)
      ? block.imagePath
      : path.join(harnesshome, block.imagePath);
    if (fs.existsSync(absPath)) {
      slide.addImage({
        path: absPath,
        x: M, y: imgY, w: CW, h: imgH,
        sizing: { type: 'contain', w: CW, h: imgH },
      });
    } else {
      slide.addText(`[圖片未找到: ${block.imagePath}]`, {
        x: M, y: imgY, w: CW, h: imgH,
        color: C.MUTED, align: 'center', valign: 'middle', fontSize: 22,
      });
    }
  }

  if (block.caption) {
    slide.addText(block.caption, {
      x: M, y: H - M - capH + 0.05, w: CW, h: capH - 0.05,
      color: C.MUTED, fontSize: 18, align: 'center',
    });
  }
  if (block.transcript) slide.addNotes(block.transcript);
}

function rSplit(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  const hasKicker = !!block.kicker;
  let ty = 0.35;
  if (hasKicker) { addKicker(slide, block.kicker, 0.3); ty = 0.72; }
  if (block.title) addTitleBar(slide, block.title, ty, 26);

  const contentY = block.title ? (ty + 1.05) : M;
  const colW = (CW - 0.3) / 2;
  const colH = H - contentY - M;

  function addCol(col, x) {
    if (!col) return;
    slide.addShape('rect', {
      x, y: contentY, w: colW, h: colH,
      fill: { color: '050F1E' },
      line: { color: C.LINE, pt: 0.5 },
    });
    let innerY = contentY + 0.25;
    if (col.heading) {
      slide.addText(col.heading, {
        x: x + 0.2, y: innerY, w: colW - 0.4, h: 0.65,
        fontSize: 22, bold: true, color: C.TITLE, fontFace: 'Calibri',
      });
      innerY += 0.75;
    }
    const items = col.items || [];
    if (items.length > 0) {
      const textItems = items.map(item => ({
        text: String(item),
        options: {
          bullet: true, fontSize: 18, color: C.TEXT,
          paraSpaceAfter: 8, fontFace: 'Calibri', breakLine: true,
        },
      }));
      slide.addText(textItems, {
        x: x + 0.2, y: innerY, w: colW - 0.4, h: H - innerY - M - 0.3,
        valign: 'top',
      });
    }
  }

  addCol(block.left, M);
  addCol(block.right, M + colW + 0.3);
  if (block.transcript) slide.addNotes(block.transcript);
}

function rQuote(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  if (block.kicker) addKicker(slide, block.kicker, 0.5);

  // Decorative opening quotation mark (faded)
  slide.addText('“', {
    x: M, y: 1.0, w: 1.8, h: 1.6,
    fontSize: 120, color: C.QUOTE_DEC, fontFace: 'Georgia', bold: true,
  });

  slide.addText(block.quote || '', {
    x: M + 0.5, y: 2.0, w: CW - 1, h: 3.2,
    fontSize: 36, italic: true, color: C.TITLE,
    fontFace: 'Calibri', align: 'center', valign: 'middle', autoFit: true,
  });

  if (block.attribution) {
    slide.addText('— ' + block.attribution, {
      x: M, y: 5.4, w: CW, h: 0.6,
      fontSize: 20, color: C.MUTED, fontFace: 'Calibri', align: 'center',
    });
  }
  if (block.transcript) slide.addNotes(block.transcript);
}

function rCustom(pptx, block) {
  const slide = pptx.addSlide();
  applyBg(slide);

  slide.addText('Custom Slide', {
    x: M, y: 2.5, w: CW, h: 1.0,
    fontSize: 36, bold: true, color: C.MUTED,
    fontFace: 'Calibri', align: 'center',
  });
  slide.addText('此頁為自訂 HTML 版型，請在瀏覽器中查看完整效果', {
    x: M, y: 3.7, w: CW, h: 0.6,
    fontSize: 20, color: C.MUTED, fontFace: 'Calibri', align: 'center',
  });

  const notes = [
    block.transcript || '',
    block.html ? '\n\n[HTML 原始內容]\n' + block.html : '',
  ].join('').trim();
  if (notes) slide.addNotes(notes);
}

// ── Main export ────────────────────────────────────────────────────────────

async function buildEditablePptx(deckData, deckName, outputDir, harnesshome) {
  fs.mkdirSync(outputDir, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  for (const block of (deckData.slides || [])) {
    switch (block.layout) {
      case 'title':   rTitle(pptx, block); break;
      case 'bullets': rBullets(pptx, block); break;
      case 'table':   rTable(pptx, block); break;
      case 'image':   rImage(pptx, block, harnesshome); break;
      case 'split':   rSplit(pptx, block); break;
      case 'quote':   rQuote(pptx, block); break;
      case 'custom':  rCustom(pptx, block); break;
      default:
        console.warn('[block-export] 未知版型:', block.layout, '— 略過');
    }
  }

  const outputPath = path.join(outputDir, deckName + '-editable.pptx');
  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { buildEditablePptx };
