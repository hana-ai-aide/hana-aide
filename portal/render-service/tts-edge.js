// render-service/tts-edge.js — online neural TTS via Microsoft Edge (python edge_tts).
// Matches the browser's voice (voice-config.json, e.g. "Xiaoyi Online (Natural)") by mapping it to
// the edge-tts short name (zh-CN-XiaoyiNeural). Synthesises one mp3 per transcript.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

// "Microsoft Xiaoyi Online (Natural) - Chinese (Mainland)" → "zh-CN-XiaoyiNeural"
function browserVoiceToEdge(name) {
  if (!name) return 'zh-CN-XiaoyiNeural';
  if (/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(name)) return name; // already an edge short name
  const localeMap = {
    'Chinese (Mainland)': 'zh-CN', 'Chinese (Simplified)': 'zh-CN', 'Chinese (Taiwan)': 'zh-TW',
    'Chinese (Hong Kong)': 'zh-HK', 'English (United States)': 'en-US', 'English (United Kingdom)': 'en-GB',
    'Japanese (Japan)': 'ja-JP',
  };
  const m = name.match(/Microsoft\s+(\w+)\s+Online.*?-\s*(.+)$/i);
  if (m) {
    const given = m[1];
    const locale = localeMap[m[2].trim()] || 'zh-CN';
    return `${locale}-${given}Neural`;
  }
  return 'zh-CN-XiaoyiNeural';
}

// Read the global voice-config → { voice: <edge short name>, rate: "+N%" } for recording.
function loadVoiceConfig(harnessHome) {
  let voiceName = '', speed = 1.0;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(harnessHome, 'global-knowledge', 'voice-config.json'), 'utf8'));
    const edgeCfg = (cfg.browsers && cfg.browsers.edge) || {};
    voiceName = edgeCfg.voice || cfg.voice || '';
    speed = edgeCfg.speed || cfg.speed || 1.0;
  } catch (e) { /* defaults below */ }
  const pct = Math.round((speed - 1) * 100);
  return { voice: browserVoiceToEdge(voiceName), rate: (pct >= 0 ? '+' : '') + pct + '%' };
}

// Synthesise one text → mp3 via python edge_tts. Text read from a temp file (no shell escaping).
function textToMp3(text, outPath, { voice = 'zh-CN-XiaoyiNeural', rate = '+0%' } = {}) {
  const tmpTxt = path.join(os.tmpdir(), `hana_edge_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpTxt, text, 'utf8');
  try {
    execFileSync('python', ['-m', 'edge_tts', '-f', tmpTxt, '-v', voice, '--rate', rate, '--write-media', outPath],
      { timeout: 120000, stdio: 'pipe' });
  } finally {
    try { fs.unlinkSync(tmpTxt); } catch (_) {}
  }
}

// Generate audio per transcript. Same return shape as tts.js (wavPath = the mp3 path; null if empty).
async function transcriptsToAudio(transcripts, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (let i = 0; i < transcripts.length; i++) {
    const text = (transcripts[i] || '').trim();
    const outPath = path.join(outDir, `slide_${String(i).padStart(3, '0')}.mp3`);
    if (text) {
      textToMp3(text, outPath, opts);
      results.push({ index: i, wavPath: outPath, transcript: text });
    } else {
      results.push({ index: i, wavPath: null, transcript: '' });
    }
  }
  return results;
}

module.exports = { transcriptsToAudio, loadVoiceConfig, browserVoiceToEdge };
