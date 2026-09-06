// Tiny JSON-file store. Not a database — deliberately simple so you can open
// data/state.json and read exactly what every agent produced.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const STATE_PATH = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  settings: {
    channel: { name: '', id: '', niche: '', voice: '' },
    // The guide's headline advice: keep the gates on. These default to true.
    approvalGates: { factualReview: true, mediaRights: true, humanSignoff: true },
    // "Publish less than the system technically can."
    publishCadence: { perWeek: 2 },
    schedule: { bestHourUTC: 17, days: ['Tue', 'Thu'] },
    syntheticDisclosureDefault: true,
  },
  topics: [],       // produced by the Content Strategy agent
  videos: [],       // each flows through the pipeline
  runs: [],          // orchestrator run log
  analytics: {
    lastReport: null,
    // Recommendations the Analytics agent feeds back to Content Strategy — the loop.
    feedback: [],
  },
  createdAt: new Date().toISOString(),
};

let state = null;

export function load() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STATE_PATH)) {
    try {
      state = { ...structuredClone(DEFAULT_STATE), ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
    } catch {
      state = structuredClone(DEFAULT_STATE);
    }
  } else {
    state = structuredClone(DEFAULT_STATE);
    save();
  }
  return state;
}

let saveTimer = null;
export function save() {
  if (!state) return;
  // Debounce rapid writes during a pipeline run.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }, 50);
}

/** Force a synchronous flush (used on process exit and after critical writes). */
export function flush() {
  if (!state) return;
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function get() {
  return load();
}

export function update(mutator) {
  const s = load();
  mutator(s);
  save();
  return s;
}

// ---- Convenience accessors ---------------------------------------------------

export function getVideo(id) {
  return load().videos.find((v) => v.id === id) || null;
}

export function upsertVideo(video) {
  const s = load();
  const idx = s.videos.findIndex((v) => v.id === video.id);
  if (idx === -1) s.videos.unshift(video);
  else s.videos[idx] = video;
  save();
  return video;
}

export function addRun(run) {
  const s = load();
  s.runs.unshift(run);
  s.runs = s.runs.slice(0, 200);
  save();
  return run;
}
