// render-service/export.js — assemble pptx from slide PNGs via PptxGenJS
const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

async function buildPptx(slides, deckName, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9'; // 13.33" × 7.5"

  for (const { pngBuffer, transcript } of slides) {
    const slide = pptx.addSlide();

    // Full-bleed screenshot image (保真 — no editable elements)
    slide.addImage({
      data: 'data:image/png;base64,' + pngBuffer.toString('base64'),
      x: 0, y: 0, w: '100%', h: '100%',
    });

    // Speaker notes ← data-transcript
    if (transcript && transcript.trim()) {
      slide.addNotes(transcript);
    }
  }

  const outputPath = path.join(outputDir, deckName + '.pptx');
  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { buildPptx };
