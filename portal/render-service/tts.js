// render-service/tts.js — PRES-REC-01: offline TTS (Windows SAPI) → WAV per slide
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Convert one text string to a WAV file using Windows SAPI (offline, Yating voice).
// rate: SAPI scale -10..10; 2 ≈ browser 1.2× speed.
async function textToWav(text, outputPath, { voice = null, rate = 2 } = {}) {
  const absOut = path.resolve(outputPath).replace(/\\/g, '\\\\');

  const voiceBlock = voice
    ? `$synth.SelectVoice('${voice.replace(/'/g, "''")}')`
    : `$installed = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
$yating = $installed | Where-Object { $_ -match 'Yating' } | Select-Object -First 1
if ($yating) { $synth.SelectVoice($yating) }`;

  // PowerShell here-string @'...'@ needs no escaping — safe for arbitrary text.
  // Closing '@ MUST start at column 0 (enforced by the join below).
  const scriptContent = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    voiceBlock,
    `$synth.Rate = ${rate}`,
    `$synth.SetOutputToWaveFile('${absOut}')`,
    `$text = @'`,
    text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
    `'@`,
    '$synth.Speak($text)',
    '$synth.SetOutputToDefaultAudioDevice()',
    '$synth.Dispose()',
  ].join('\n');

  const tmpScript = path.join(os.tmpdir(), `hana_tts_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(tmpScript, scriptContent, 'utf8');
  try {
    execSync(`pwsh -NoProfile -File "${tmpScript}"`, { timeout: 120000, stdio: 'pipe' });
  } catch (e) {
    const detail = e.stderr ? e.stderr.toString().trim() : e.message;
    throw new Error(`TTS 生成失敗：${detail}`);
  } finally {
    try { fs.unlinkSync(tmpScript); } catch (_) {}
  }
}

// Generate WAV files for all transcripts (one per slide).
// Slides with empty transcript get wavPath: null.
// Returns [{ index, wavPath|null, transcript }]
async function transcriptsToWavs(transcripts, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (let i = 0; i < transcripts.length; i++) {
    const text = (transcripts[i] || '').trim();
    const wavPath = path.join(outDir, `slide_${String(i).padStart(3, '0')}.wav`);
    if (text) {
      await textToWav(text, wavPath, opts);
      results.push({ index: i, wavPath, transcript: text });
    } else {
      results.push({ index: i, wavPath: null, transcript: '' });
    }
  }
  return results;
}

module.exports = { textToWav, transcriptsToWavs };
