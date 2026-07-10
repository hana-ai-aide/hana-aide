// render-service/video-preprocess.js — MM-M3-01: turn a chat video attachment into things Hana can
// judge with her native tools. A CLI `Read` can't watch an mp4, so we pre-process on the server:
//   ① extract the audio track → WAV (fed to the existing STT worker for a transcript)
//   ② extract a few evenly-spaced keyframes → JPGs (fed to `Read`, which IS natively multimodal)
// Requires ffmpeg/ffprobe in PATH. Callers MUST check ffmpegAvailable() first and degrade honestly
// (tell the user ffmpeg is missing) — we never fabricate a transcript.
//
// 天條: every derived file is written into `outDir`, which the caller sets to the attachment's own
// `attachments/<sessionId>/` folder — inside the current workspace, and swept away when the chat is
// deleted (DELETE /api/chat/history/:id rmSync's the whole folder). We never write elsewhere.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Both ffmpeg AND ffprobe must exist — we use ffprobe for duration-based keyframe spacing.
function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

// Real media duration in seconds (ffprobe); 0 on failure (caller falls back to a fixed frame count).
function probeDuration(file) {
  try {
    const out = execFileSync('ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const d = parseFloat(out);
    return (isFinite(d) && d > 0) ? d : 0;
  } catch (_) { return 0; }
}

// Extract the audio track to a 16kHz mono WAV (what faster-whisper wants). Returns the WAV path.
// Throws if ffmpeg fails OR the video has no audio stream (no WAV produced) — caller degrades honestly.
function extractAudio(videoPath, outWavPath) {
  execFileSync('ffmpeg',
    ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outWavPath],
    { stdio: 'ignore', timeout: 180000 });
  if (!fs.existsSync(outWavPath) || fs.statSync(outWavPath).size < 128) {
    throw new Error('no audio track');
  }
  return outWavPath;
}

// Extract up to `maxFrames` evenly-spaced keyframes as JPGs. Returns the absolute paths actually written
// (best-effort: a frame that fails to grab is skipped, not fatal). `prefix` namespaces the files so
// several videos in one session don't clobber each other.
function extractKeyframes(videoPath, outDir, prefix, maxFrames) {
  const n = Math.max(1, Math.min(maxFrames || 6, 12));
  fs.mkdirSync(outDir, { recursive: true });
  const dur = probeDuration(videoPath);
  const frames = [];
  // Even spacing across the middle of the clip (avoid t=0 black frame and the very last frame).
  // With unknown duration, just grab a single frame near the start.
  const stamps = [];
  if (dur > 0) {
    for (let i = 0; i < n; i++) stamps.push(dur * (i + 1) / (n + 1));
  } else {
    stamps.push(1);
  }
  stamps.forEach((t, i) => {
    const outPath = path.join(outDir, `${prefix}_frame${i + 1}.jpg`);
    try {
      // -ss BEFORE -i = fast (keyframe) seek; -frames:v 1 = one frame; -q:v 2 = high-quality JPG.
      execFileSync('ffmpeg',
        ['-y', '-ss', String(t.toFixed(2)), '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath],
        { stdio: 'ignore', timeout: 60000 });
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) frames.push(outPath);
    } catch (_) { /* skip this frame, keep the rest */ }
  });
  return frames;
}

module.exports = { ffmpegAvailable, probeDuration, extractAudio, extractKeyframes };
