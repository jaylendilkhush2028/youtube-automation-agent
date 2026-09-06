// Text-to-speech for the voiceover. Three tiers, auto-selected (see
// resolveVoiceProvider in config.js), override with VOICE_PROVIDER:
//   - elevenlabs : most natural, needs ELEVENLABS_API_KEY (paid)
//   - say        : FREE, local, no key — built-in macOS voices via `say`
//   - mock       : no audio, saves the narration script as text
// Real audio bytes are written to data/media/<videoId>/voiceover.<ext>.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, resolveVoiceProvider } from '../config.js';
import { logger } from '../logger.js';

const run = promisify(execFile);

export function hasTTS() { return resolveVoiceProvider() !== 'mock'; }

const WORDS_PER_MINUTE = 150;

export function estimateDurationSec(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

export async function synthesize(videoId, text) {
  const dir = path.join(DATA_DIR, 'media', videoId);
  fs.mkdirSync(dir, { recursive: true });
  const durationSec = estimateDurationSec(text);
  const provider = resolveVoiceProvider();

  if (provider === 'elevenlabs') {
    const out = await elevenLabs(dir, text, durationSec);
    if (out) return out;
    // fall through to a free/local voice if the paid call failed
    if (process.platform === 'darwin') { const s = await systemSay(dir, text, durationSec); if (s) return s; }
  } else if (provider === 'say') {
    const out = await systemSay(dir, text, durationSec);
    if (out) return out;
  }

  // mock: no audio, but keep the pipeline moving with a saved script + estimate
  fs.writeFileSync(path.join(dir, 'voiceover.txt'), text);
  logger.warn('tts', `[mock] voiceover script saved (${durationSec}s @ ${WORDS_PER_MINUTE}wpm)`);
  return { path: null, durationSec, mock: true, provider: 'mock' };
}

/** FREE local voiceover using macOS `say`, transcoded to compact AAC (.m4a). */
async function systemSay(dir, text, durationSec) {
  const aiff = path.join(dir, 'voiceover.aiff');
  const m4a = path.join(dir, 'voiceover.m4a');
  const inputFile = path.join(dir, '.voiceover-input.txt');
  // Pass the script via a file so quotes/newlines/length never break the shell.
  fs.writeFileSync(inputFile, text);
  const voice = process.env.SAY_VOICE; // e.g. "Samantha", "Daniel"; default = system voice
  try {
    await run('say', [...(voice ? ['-v', voice] : []), '-o', aiff, '-f', inputFile]);
    let finalPath = aiff;
    // Shrink AIFF → AAC/m4a (browser-friendly, ~10x smaller). Keep AIFF if afconvert is missing.
    try {
      await run('afconvert', [aiff, m4a, '-f', 'm4af', '-d', 'aac']);
      fs.rmSync(aiff, { force: true });
      finalPath = m4a;
    } catch { /* keep the .aiff */ }
    fs.rmSync(inputFile, { force: true });
    const kb = (fs.statSync(finalPath).size / 1024).toFixed(0);
    logger.ok('tts', `voiceover synthesized with macOS say (${kb}kb, ~${durationSec}s)`);
    return { path: finalPath, durationSec, mock: false, provider: 'say' };
  } catch (err) {
    fs.rmSync(inputFile, { force: true });
    logger.warn('tts', `system voice failed (${err.message}); falling back to mock`);
    return null;
  }
}

/** Paid, most-natural voiceover via ElevenLabs. Returns null on failure so callers can fall back. */
async function elevenLabs(dir, text, durationSec) {
  const outPath = path.join(dir, 'voiceover.mp3');
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  if (!res.ok) { logger.warn('tts', `elevenlabs ${res.status}, falling back`); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  logger.ok('tts', `voiceover synthesized with ElevenLabs (${(buf.length / 1024).toFixed(0)}kb, ~${durationSec}s)`);
  return { path: outPath, durationSec, mock: false, provider: 'elevenlabs' };
}
