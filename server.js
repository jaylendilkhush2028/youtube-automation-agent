#!/usr/bin/env node
// The dashboard + API. Opens at http://localhost:3456 — where you monitor runs,
// review what each agent produced, and approve or reject videos.

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORT, DATA_DIR, integrationStatus, saveEnv } from './src/config.js';
import * as store from './src/store.js';
import { logger, recentEvents } from './src/logger.js';
import { agentList } from './src/agents/index.js';
import * as orch from './src/orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  logger.error('api', `${req.method} ${req.path} → ${err.message}`);
  res.status(400).json({ error: err.message });
});

// ---- Dashboard state ---------------------------------------------------------

app.get('/api/state', (req, res) => {
  const s = store.get();
  res.json({
    agents: agentList(),
    settings: s.settings,
    integrations: integrationStatus(),
    stages: orch.STAGES,
    topics: s.topics,
    videos: s.videos.map(summarizeVideo),
    runs: s.runs.slice(0, 30),
    analytics: s.analytics,
    events: recentEvents(60),
    counts: {
      topics: s.topics.filter((t) => t.status === 'proposed').length,
      inPipeline: s.videos.filter((v) => ['scripting', 'thumbnails', 'seo', 'production'].includes(v.stage)).length,
      awaitingApproval: s.videos.filter((v) => v.stage === 'review').length,
      scheduled: s.videos.filter((v) => v.status === 'scheduled' || v.status === 'published').length,
    },
  });
});

app.get('/api/events', (req, res) => res.json({ events: recentEvents(Number(req.query.limit) || 60) }));

app.get('/api/videos/:id', wrap((req, res) => {
  const v = store.getVideo(req.params.id);
  if (!v) return res.status(404).json({ error: 'not found' });
  res.json(v);
}));

// ---- Actions -----------------------------------------------------------------

app.post('/api/strategy/run', wrap(async (req, res) => {
  const topics = await orch.runStrategy(Number(req.body?.count) || 6);
  res.json({ topics });
}));

app.post('/api/topics/:id/create-video', wrap(async (req, res) => {
  const video = orch.createVideoFromTopic(req.params.id);
  res.json({ video: summarizeVideo(video) });
}));

app.post('/api/videos/:id/run', wrap(async (req, res) => {
  const video = await orch.runVideoToGate(req.params.id);
  res.json({ video: summarizeVideo(video) });
}));

app.post('/api/videos/:id/approve', wrap(async (req, res) => {
  const video = await orch.approveVideo(req.params.id, req.body || {});
  res.json({ video: summarizeVideo(video) });
}));

app.post('/api/videos/:id/reject', wrap(async (req, res) => {
  const video = orch.rejectVideo(req.params.id, req.body?.notes || '');
  res.json({ video: summarizeVideo(video) });
}));

app.post('/api/analytics/run', wrap(async (req, res) => {
  const out = await orch.runAnalytics();
  res.json(out);
}));

app.post('/api/pipeline/oneclick', wrap(async (req, res) => {
  const video = await orch.runOneClickToGate();
  res.json({ video: summarizeVideo(video) });
}));

// ---- Settings & keys ---------------------------------------------------------

app.post('/api/settings', wrap((req, res) => {
  const s = store.update((state) => {
    Object.assign(state.settings, deepMergeSettings(state.settings, req.body || {}));
  });
  res.json({ settings: s.settings });
}));

// Accept API keys from the local setup panel. Written to .env; NEVER returned.
app.post('/api/keys', wrap((req, res) => {
  const allowed = ['AI_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_MODEL', 'GEMINI_MODEL', 'ANTHROPIC_MODEL', 'OPENROUTER_MODEL', 'YOUTUBE_API_KEY', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];
  const updates = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.includes(k) && String(v).trim()) updates[k] = String(v).trim();
  }
  if (Object.keys(updates).length) saveEnv(updates);
  logger.ok('config', `updated ${Object.keys(updates).length} setting(s)`);
  res.json({ integrations: integrationStatus() }); // booleans only, no secret values
}));

// ---- Media (thumbnails, captions, etc.) --------------------------------------

app.get('/media/:videoId/:file', (req, res) => {
  const safe = path.basename(req.params.file);
  const file = path.join(DATA_DIR, 'media', path.basename(req.params.videoId), safe);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// ---- Static dashboard --------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---- helpers -----------------------------------------------------------------

function summarizeVideo(v) {
  return {
    id: v.id,
    createdAt: v.createdAt,
    stage: v.stage,
    status: v.status,
    stageNote: v.stageNote || '',
    topic: v.topic,
    hasScript: !!v.script,
    script: v.script ? { hook: v.script.hook, wordCount: v.script.wordCount, humanReviewDone: v.script.humanReviewDone, sections: v.script.sections } : null,
    thumbnails: v.thumbnails || [],
    seo: v.seo || null,
    production: v.production ? { durationSec: v.production.durationSec, scenes: v.production.scenes?.length, status: v.production.status, roughCutFile: v.production.roughCutFile } : null,
    approval: v.approval,
    publish: v.publish || null,
    analytics: v.analytics || null,
    log: (v.log || []).slice(-12),
  };
}

function deepMergeSettings(base, incoming) {
  const out = {};
  for (const k of Object.keys(incoming)) {
    if (incoming[k] && typeof incoming[k] === 'object' && !Array.isArray(incoming[k])) {
      out[k] = { ...(base[k] || {}), ...incoming[k] };
    } else {
      out[k] = incoming[k];
    }
  }
  return out;
}

// ---- boot --------------------------------------------------------------------

store.load();
process.on('SIGINT', () => { store.flush(); process.exit(0); });
process.on('SIGTERM', () => { store.flush(); process.exit(0); });

app.listen(PORT, () => {
  const int = integrationStatus();
  logger.ok('server', `dashboard → http://localhost:${PORT}`);
  logger.info('server', `text provider: ${int.textProvider}${int.textProvider === 'mock' ? ' (offline demo — add a key in Setup to go live)' : ''}`);
  logger.info('server', `youtube upload: ${int.youtube ? 'connected' : 'mock'} · voice: ${int.voice}`);
});
