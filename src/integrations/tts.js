// Text-to-speech for the voiceover. ElevenLabs when a key is present, otherwise
// a mock that reports the estimated duration so production can still assemble a
// timeline. Real audio bytes are written to data/media/<videoId>/voiceover.mp3.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

export function hasTTS() { return !!process.env.ELEVENLABS_API_KEY; }

const WORDS_PER_MINUTE = 150;

export function estimateDurationSec(text) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

export async function synthesize(videoId, text) {
  const dir = path.join(DATA_DIR, 'media', videoId);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'voiceover.mp3');
  const durationSec = estimateDurationSec(text);

  if (!hasTTS()) {
    fs.writeFileSync(outPath.replace(/\.mp3$/, '.txt'), text);
    logger.warn('tts', `[mock] voiceover script saved (${durationSec}s @ ${WORDS_PER_MINUTE}wpm)`);
    return { path: null, durationSec, mock: true };
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  });
  if (!res.ok) { logger.warn('tts', `elevenlabs ${res.status}, falling back to mock`); return { path: null, durationSec, mock: true }; }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  logger.ok('tts', `voiceover synthesized (${(buf.length / 1024).toFixed(0)}kb, ~${durationSec}s)`);
  return { path: outPath, durationSec, mock: false };
}
