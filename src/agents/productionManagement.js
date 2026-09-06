// Agent 5 — Production Management.
// The assembly step: text-to-speech for the voiceover, an image/video asset shot
// list, captions, and a stitched-together production manifest.
//
// The FINAL video is the second thing the guide says needs you every time. This
// agent produces everything an editor needs and a build manifest; it deliberately
// stops short of publishing a "done" master, because watching the finished cut once
// at speed is your job. If ffmpeg is installed it can assemble a rough slideshow cut
// from the thumbnail + voiceover so you have something to review.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR } from '../config.js';
import * as tts from '../integrations/tts.js';

const pexec = promisify(execFile);

export const meta = {
  id: 'production-management',
  name: 'Production Management',
  order: 5,
  supervision: 'human',
  channelLevel: false,
  blurb: 'TTS voiceover, shot list, captions, and a build manifest for the final cut.',
};

export async function run(ctx) {
  const { video, log } = ctx;
  const script = video.script;
  if (!script) throw new Error('production requires a script');
  log('agent', 'assembling production: voiceover + shot list + manifest…');

  const narration = [script.hook, ...(script.sections || []).map((s) => s.body), script.cta].join('\n\n');
  const voice = await tts.synthesize(video.id, narration);

  // Build a scene-by-scene shot list from the script sections.
  const scenes = [{ t: 0, kind: 'hook', text: script.hook, broll: script.bRoll?.[0] || 'title card' }];
  let t = tts.estimateDurationSec(script.hook);
  for (const [i, s] of (script.sections || []).entries()) {
    scenes.push({ t, kind: 'section', heading: s.heading, text: s.body, broll: script.bRoll?.[i % (script.bRoll?.length || 1)] || 'b-roll' });
    t += tts.estimateDurationSec(s.body);
  }
  scenes.push({ t, kind: 'cta', text: script.cta, broll: 'end screen' });

  const dir = path.join(DATA_DIR, 'media', video.id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    durationSec: voice.durationSec,
    scenes,
    voiceover: voice,
    captionsFile: writeCaptions(dir, scenes, voice.durationSec),
    resolution: '1920x1080',
    status: 'assembled_needs_review',
  };

  // Optional rough cut if ffmpeg + a thumbnail are available.
  const rough = await tryRoughCut(video, dir, voice, log).catch((e) => { log('warn', `rough cut skipped: ${e.message}`); return null; });
  if (rough) manifest.roughCutFile = rough;

  fs.writeFileSync(path.join(dir, 'production.json'), JSON.stringify(manifest, null, 2));
  log('warn', `production assembled (~${manifest.durationSec}s, ${scenes.length} scenes). Watch the cut once before approving.`);
  return { production: manifest, stageNote: 'Assembled. The final video needs a human viewing before it can pass the approval gate.' };
}

function writeCaptions(dir, scenes, total) {
  // Minimal .srt so captions exist for review.
  const file = path.join(dir, 'captions.srt');
  const lines = [];
  scenes.forEach((s, i) => {
    const start = s.t;
    const end = scenes[i + 1] ? scenes[i + 1].t : total;
    lines.push(String(i + 1), `${fmt(start)} --> ${fmt(end)}`, (s.text || '').slice(0, 120), '');
  });
  fs.writeFileSync(file, lines.join('\n'));
  return 'captions.srt';
}

function fmt(sec) {
  const h = String(Math.floor(sec / 3600)).padStart(2, '0');
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${h}:${m}:${s},000`;
}

async function tryRoughCut(video, dir, voice, log) {
  if (!voice.path) return null; // no real audio (mock TTS) → nothing to mux
  const thumb = video.thumbnails?.[0]?.file ? path.join(dir, video.thumbnails[0].file) : null;
  if (!thumb || !fs.existsSync(thumb)) return null;
  try { await pexec('ffmpeg', ['-version']); } catch { return null; }
  // Convert SVG thumb → png via ffmpeg is unreliable; skip if not png. Keep it honest.
  if (!thumb.endsWith('.png')) return null;
  const out = path.join(dir, 'roughcut.mp4');
  await pexec('ffmpeg', ['-y', '-loop', '1', '-i', thumb, '-i', voice.path, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out]);
  log('ok', 'rough slideshow cut assembled with ffmpeg.');
  return 'roughcut.mp4';
}
