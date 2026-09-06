// The orchestrator runs the 7-agent chain and enforces the human-in-the-loop
// approval gate. It never auto-approves and never publishes an unapproved video —
// the gate is a hard stop in code, matching the guide's core advice.

import * as store from './store.js';
import { logger } from './logger.js';
import { id } from './util.js';
import { AGENTS, byId, VIDEO_PIPELINE } from './agents/index.js';

const STAGES = ['scripting', 'thumbnails', 'seo', 'production', 'review', 'publishing', 'analytics', 'done'];
const STAGE_TO_AGENT = { scripting: 'script-writer', thumbnails: 'thumbnail-designer', seo: 'seo-optimizer', production: 'production-management' };

const busy = new Set(); // guards against double-advancing a video

function ctxFor(video, extra = {}) {
  const state = store.get();
  return {
    state,
    settings: state.settings,
    video,
    ...extra,
    log(level, message, meta) {
      const source = extra.agentName || (video ? `video:${video.id.slice(0, 8)}` : 'orchestrator');
      logger[level] ? logger[level](source, message, meta) : logger.info(source, message, meta);
      if (video) {
        (video.log ||= []).push({ ts: new Date().toISOString(), level, message });
        video.log = video.log.slice(-100);
      }
    },
  };
}

// ---- Channel-level agents ----------------------------------------------------

export async function runStrategy(count = 6) {
  const runId = startRun('content-strategy');
  try {
    const state = store.get();
    const ctx = ctxFor(null, { agentName: 'content-strategy', count });
    const { topics } = await contentStrategyAgent().run(ctx);
    store.save();
    finishRun(runId, 'ok', `${topics.length} topics proposed`);
    return topics;
  } catch (err) {
    finishRun(runId, 'error', err.message);
    throw err;
  }
}

export async function runAnalytics() {
  const runId = startRun('analytics');
  try {
    const ctx = ctxFor(null, { agentName: 'analytics' });
    const out = await byId['analytics'].run(ctx);
    store.save();
    finishRun(runId, 'ok', `${out.feedback.length} recommendations fed back`);
    return out;
  } catch (err) {
    finishRun(runId, 'error', err.message);
    throw err;
  }
}

// ---- Per-video pipeline ------------------------------------------------------

export function createVideoFromTopic(topicId) {
  const state = store.get();
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) throw new Error('topic not found');
  if (topic.status === 'in_production') {
    const existing = state.videos.find((v) => v.topic?.id === topicId);
    if (existing) return existing;
  }
  topic.status = 'in_production';
  const video = {
    id: id('video'),
    createdAt: new Date().toISOString(),
    stage: 'scripting',
    status: 'queued',
    topic: { ...topic },
    approval: emptyApproval(state),
    log: [],
    stageHistory: [],
  };
  store.upsertVideo(video);
  logger.info('orchestrator', `created video ${video.id} from topic "${topic.title}"`);
  return video;
}

/** Run exactly one pipeline stage for a video, returning the updated video. */
export async function advanceVideo(videoId) {
  if (busy.has(videoId)) throw new Error('video is already being processed');
  const video = store.getVideo(videoId);
  if (!video) throw new Error('video not found');
  if (!STAGE_TO_AGENT[video.stage]) {
    throw new Error(`stage "${video.stage}" is not an auto-advanceable stage`);
  }
  busy.add(videoId);
  try {
    const agent = byId[STAGE_TO_AGENT[video.stage]];
    const ctx = ctxFor(video, { agentName: agent.meta.id });
    const patch = await agent.run(ctx);
    applyPatch(video, patch);
    video.stageHistory.push({ stage: video.stage, at: new Date().toISOString(), agent: agent.meta.id });
    video.stage = STAGES[STAGES.indexOf(video.stage) + 1];
    video.status = video.stage === 'review' ? 'awaiting_approval' : `stage:${video.stage}`;
    store.upsertVideo(video);
    return video;
  } finally {
    busy.delete(videoId);
  }
}

/** Run all automatic stages up to the approval gate, then stop. */
export async function runVideoToGate(videoId) {
  const runId = startRun('video-pipeline', videoId);
  try {
    let video = store.getVideo(videoId);
    while (video && ['scripting', 'thumbnails', 'seo', 'production'].includes(video.stage)) {
      video = await advanceVideo(videoId);
    }
    finishRun(runId, 'ok', `reached ${video.stage}`);
    logger.warn('orchestrator', `video ${videoId} is at the approval gate — your review required before publishing.`);
    return video;
  } catch (err) {
    finishRun(runId, 'error', err.message);
    throw err;
  }
}

/**
 * Approve a video and publish it. Validates that every enabled gate is confirmed.
 * This is the only path that leads to the publishing agent.
 */
export async function approveVideo(videoId, decision) {
  const state = store.get();
  const video = store.getVideo(videoId);
  if (!video) throw new Error('video not found');
  if (video.stage !== 'review') throw new Error(`video is not awaiting approval (stage: ${video.stage})`);

  const gates = state.settings.approvalGates;
  const missing = [];
  if (gates.factualReview && !decision.factualReview) missing.push('factual review');
  if (gates.mediaRights && !decision.mediaRights) missing.push('media-rights confirmation');
  if (gates.humanSignoff && !decision.humanSignoff) missing.push('human sign-off');
  if (missing.length) {
    throw new Error(`cannot approve — these gates are not confirmed: ${missing.join(', ')}`);
  }

  video.approval = {
    decision: 'approved',
    factualReview: !!decision.factualReview,
    mediaRights: !!decision.mediaRights,
    humanSignoff: !!decision.humanSignoff,
    syntheticDisclosure: decision.syntheticDisclosure ?? state.settings.syntheticDisclosureDefault,
    notes: decision.notes || '',
    decidedBy: decision.by || 'you',
    decidedAt: new Date().toISOString(),
  };
  store.upsertVideo(video);

  const runId = startRun('publishing', videoId);
  try {
    video.stage = 'publishing';
    const pubCtx = ctxFor(video, { agentName: 'publishing-scheduling' });
    applyPatch(video, await byId['publishing-scheduling'].run(pubCtx));
    video.stageHistory.push({ stage: 'publishing', at: new Date().toISOString(), agent: 'publishing-scheduling' });

    video.stage = 'done';
    video.status = video.publish?.scheduledFor ? 'scheduled' : 'published';
    store.upsertVideo(video);

    // Close the loop: refresh analytics + feedback now that a new video exists.
    await runAnalytics().catch((e) => logger.warn('orchestrator', `analytics refresh failed: ${e.message}`));

    finishRun(runId, 'ok', `scheduled for ${video.publish?.scheduledFor}`);
    return video;
  } catch (err) {
    finishRun(runId, 'error', err.message);
    // Roll the stage back to review so it can be retried after fixing the issue.
    video.stage = 'review';
    video.status = 'awaiting_approval';
    store.upsertVideo(video);
    throw err;
  }
}

export function rejectVideo(videoId, notes = '') {
  const video = store.getVideo(videoId);
  if (!video) throw new Error('video not found');
  video.approval = { ...video.approval, decision: 'rejected', notes, decidedAt: new Date().toISOString() };
  video.stage = 'rejected';
  video.status = 'rejected';
  if (video.topic) {
    const t = store.get().topics.find((t) => t.id === video.topic.id);
    if (t) t.status = 'rejected';
  }
  store.upsertVideo(video);
  logger.warn('orchestrator', `video ${videoId} rejected. Good — a topic you can't add to is a video that won't monetize.`);
  return video;
}

/**
 * One-click demo: run strategy, take the top proposed topic, and run it to the
 * approval gate. Stops there. Nothing publishes without you.
 */
export async function runOneClickToGate() {
  await runStrategy(6);
  const state = store.get();
  const topic = state.topics.find((t) => t.status === 'proposed');
  if (!topic) throw new Error('no proposed topics available');
  const video = createVideoFromTopic(topic.id);
  return runVideoToGate(video.id);
}

// ---- helpers -----------------------------------------------------------------

function contentStrategyAgent() { return byId['content-strategy']; }

function applyPatch(video, patch) {
  if (!patch) return;
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'stageNote') video.stageNote = v;
    else video[k] = v;
  }
}

function emptyApproval(state) {
  return {
    decision: 'pending',
    factualReview: false,
    mediaRights: false,
    humanSignoff: false,
    syntheticDisclosure: state.settings.syntheticDisclosureDefault,
    notes: '',
  };
}

function startRun(kind, videoId) {
  const run = { id: id('run'), kind, videoId: videoId || null, status: 'running', startedAt: new Date().toISOString(), finishedAt: null, summary: '' };
  store.addRun(run);
  return run.id;
}

function finishRun(runId, status, summary) {
  const run = store.get().runs.find((r) => r.id === runId);
  if (run) { run.status = status; run.finishedAt = new Date().toISOString(); run.summary = summary; store.save(); }
}

export { STAGES, AGENTS };
