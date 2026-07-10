// render-service/record.js — PRES-REC-02: screenshot + TTS WAV → ffmpeg MP4
// Strategy: Playwright screenshots each slide → Windows SAPI WAV per slide
//           → ffmpeg: image+audio per clip → concat all clips → final MP4
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { slidesToPngs } = require('./screenshot');
const { transcriptsToWavs } = require('./tts');           // offline SAPI fallback
const { transcriptsToAudio } = require('./tts-edge');     // online neural (matches browser voice-config)

function ffmpegAvailable() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
  catch (_) { return false; }
}

// Real media duration (seconds) via ffprobe; used to cut each clip tight + time VTT cues.
function probeDuration(file) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${file}"`, { stdio: 'pipe' }).toString().trim();
    const d = parseFloat(out);
    return (isFinite(d) && d > 0) ? d : 3;
  } catch (_) { return 3; }
}

function fmtVttTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

// Split one slide's transcript into short caption segments at clause/sentence punctuation
// (CJK 。，、；：！？…  + ASCII . , ; : ! ?  + 破折號 ——／—). Hyphen "-" is NOT a breaker, so
// English words like "co-work" / "EP1-v2" stay intact. Punctuation stays on the left segment.
// Language-agnostic, so it works the same for translated (e.g. English) transcripts later.
function splitCaption(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const segs = [];
  const re = /(——|[。．！？!?…，、；;：:,]|—(?!—)|\.(?=\s|$))/g;
  let last = 0, m;
  while ((m = re.exec(t)) !== null) {
    const seg = t.slice(last, m.index) + m[0];
    if (seg.trim()) segs.push(seg.trim());
    last = re.lastIndex;
  }
  const tail = t.slice(last).trim();
  if (tail) segs.push(tail);
  return segs.length ? segs : [t];
}

// WebVTT captions: each slide's transcript is split into short segments, each shown sequentially,
// time-sliced within the slide's clip duration in proportion to its character length.
function writeVtt(vttPath, transcripts, durations) {
  let t = 0, out = 'WEBVTT\n\n';
  for (let i = 0; i < transcripts.length; i++) {
    const slideDur = durations[i] || 3;
    const slideStart = t;
    t += slideDur;
    const segs = splitCaption(transcripts[i]);
    if (!segs.length) continue;
    const totalLen = segs.reduce((a, s) => a + s.length, 0) || 1;
    let acc = 0;
    for (const seg of segs) {
      const segStart = slideStart + slideDur * (acc / totalLen);
      acc += seg.length;
      const segEnd = slideStart + slideDur * (acc / totalLen);
      out += `${fmtVttTime(segStart)} --> ${fmtVttTime(segEnd)}\n${seg}\n\n`;
    }
  }
  fs.writeFileSync(vttPath, out, 'utf8');
}

// Record a presentation deck to an MP4 file.
// deckUrl: full URL served by portal, e.g. http://localhost:PORT/raw?path=presentations/X.html
// outputPath: destination .mp4 path
// opts.width/height: capture resolution (default 1920×1080)
// opts.ttsRate: SAPI rate -10..10 (default 2 ≈ 1.2× browser speed)
// opts.ttsVoice: SAPI voice name (null = auto-pick Yating)
// opts.slideWaitMs: ms to wait after slide activation before screenshot (default 300)
// opts.silentSlideSecs: duration for slides with no transcript (default 3)
async function recordDeck(deckUrl, outputPath, opts = {}) {
  const {
    width = 1920, height = 1080,
    ttsRate = 2, ttsVoice = null,
    edgeVoice = 'zh-CN-XiaoyiNeural', edgeRate = '+0%',
    slideWaitMs = 300, silentSlideSecs = 3,
  } = opts;

  if (!ffmpegAvailable()) {
    throw new Error('ffmpeg 未安裝或不在 PATH，請先安裝 ffmpeg 並重啟 portal');
  }

  const tmpDir = path.join(os.tmpdir(), `hana_rec_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // 1. Screenshot every slide (Playwright headless)
    const slides = await slidesToPngs(deckUrl, { width, height, waitMs: slideWaitMs });
    if (!slides.length) throw new Error('找不到 .slide 元素，請確認 deck 使用 presentation-core 架構');

    // 2. Generate per-slide audio — edge-tts online neural voice (matches the browser's voice-config);
    //    fall back to the offline SAPI engine if edge-tts is unavailable.
    const transcripts = slides.map(s => s.transcript || '');
    let audio;
    try {
      audio = await transcriptsToAudio(transcripts, tmpDir, { voice: edgeVoice, rate: edgeRate });
    } catch (e) {
      console.error('[record] edge-tts failed, falling back to offline SAPI:', e.message);
      audio = await transcriptsToWavs(transcripts, tmpDir, { rate: ttsRate, voice: ttsVoice });
    }

    // 3. Build per-slide MP4 clips. Clip length = the audio's REAL duration (ffprobe) + a tiny tail,
    //    so there's no long silent gap after the narration. Collect durations for the VTT cues.
    const clipPaths = [];
    const durations = [];
    for (let i = 0; i < slides.length; i++) {
      const pngPath = path.join(tmpDir, `slide_${String(i).padStart(3, '0')}.png`);
      fs.writeFileSync(pngPath, slides[i].pngBuffer);
      const clipPath = path.join(tmpDir, `clip_${String(i).padStart(3, '0')}.mp4`);
      const wav = audio[i] && audio[i].wavPath;

      if (wav && fs.existsSync(wav)) {
        const dur = probeDuration(wav) + 0.4; // small tail so the last word isn't clipped
        durations.push(dur);
        execSync(
          `ffmpeg -y -loop 1 -framerate 2 -i "${pngPath}" -i "${wav}" ` +
          `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p ` +
          `-c:a aac -b:a 128k -t ${dur.toFixed(3)} "${clipPath}"`,
          { timeout: 180000, stdio: 'pipe' }
        );
      } else {
        durations.push(silentSlideSecs);
        execSync(
          `ffmpeg -y -loop 1 -framerate 2 -i "${pngPath}" -t ${silentSlideSecs} ` +
          `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -an "${clipPath}"`,
          { timeout: 60000, stdio: 'pipe' }
        );
      }
      clipPaths.push(clipPath);
    }

    // 4. Concat all clips into final MP4
    const concatList = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(concatList,
      clipPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
      'utf8');

    const absOut = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${absOut}"`,
      { timeout: 600000, stdio: 'pipe' }
    );

    // 5. WebVTT captions timed to each slide's clip duration (online-player support)
    const vttPath = absOut.replace(/\.mp4$/i, '.vtt');
    writeVtt(vttPath, transcripts, durations);

    return { outputPath: absOut, vttPath, slideCount: slides.length };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { recordDeck, ffmpegAvailable };
