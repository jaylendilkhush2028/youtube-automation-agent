// Agent 6 — Publishing & Scheduling.
// Uploads, schedules for the right time, and manages settings, playlists, and end
// screens. This agent is HARD-GATED: it refuses to publish unless the video is
// approved and every enabled approval gate has passed. That guard is the guide's
// "single best decision the authors made" — it lives here in code, not just policy.

import * as youtube from '../integrations/youtube.js';

export const meta = {
  id: 'publishing-scheduling',
  name: 'Publishing & Scheduling',
  order: 6,
  supervision: 'auto',
  channelLevel: false,
  blurb: 'Schedules the right slot and uploads — only after every gate passes.',
};

export async function run(ctx) {
  const { video, state, log } = ctx;
  assertPublishable(video, state); // throws if not cleared — the core safety guard

  const slot = nextSlot(state);
  const seo = video.seo || {};
  log('agent', `scheduling "${seo.title || video.topic.title}" for ${slot.toISOString()}…`);

  const result = await youtube.uploadVideo({
    filePath: video.production?.roughCutFile
      ? `data/media/${video.id}/${video.production.roughCutFile}`
      : null,
    title: seo.title || video.topic.title,
    description: seo.description || '',
    tags: seo.tags || [],
    publishAt: slot.toISOString(),
    syntheticDisclosure: video.approval?.syntheticDisclosure ?? state.settings.syntheticDisclosureDefault,
  });

  const publish = {
    ...result,
    scheduledFor: slot.toISOString(),
    playlist: playlistFor(video.topic.format),
    endScreens: ['subscribe', 'best-for-viewer'],
    cards: ['related-video'],
    disclosedSynthetic: video.approval?.syntheticDisclosure ?? state.settings.syntheticDisclosureDefault,
  };
  log('ok', `${result.mock ? '[mock] ' : ''}scheduled → ${result.url} for ${slot.toISOString()}`);
  return { publish };
}

function assertPublishable(video, state) {
  if (video.approval?.decision !== 'approved') {
    throw new Error('publishing blocked: video is not approved (approval gate not passed)');
  }
  const gates = state.settings.approvalGates;
  const a = video.approval;
  if (gates.factualReview && !a.factualReview) throw new Error('publishing blocked: factual review gate not confirmed');
  if (gates.mediaRights && !a.mediaRights) throw new Error('publishing blocked: media-rights gate not confirmed');
  if (gates.humanSignoff && !a.humanSignoff) throw new Error('publishing blocked: human sign-off gate not confirmed');
}

function playlistFor(format) {
  return { tutorial: 'Tutorials', explainer: 'Explainers', list: 'Lists & Rankings', review: 'Reviews' }[format] || 'Uploads';
}

/** Find the next scheduled slot honoring cadence + preferred days/hour. */
function nextSlot(state) {
  const { schedule } = state.settings;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wantDays = (schedule.days || ['Tue', 'Thu']).map((d) => dayMap[d]).filter((n) => n !== undefined);
  const hour = schedule.bestHourUTC ?? 17;

  // Count already-scheduled future videos to avoid stacking them on one slot.
  const scheduled = state.videos
    .filter((v) => v.publish?.scheduledFor && new Date(v.publish.scheduledFor) > new Date())
    .map((v) => new Date(v.publish.scheduledFor).getTime());

  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  for (let i = 0; i < 60; i++) {
    const cand = new Date(d.getTime() + i * 864e5);
    if (!wantDays.length || wantDays.includes(cand.getUTCDay())) {
      if (cand > new Date() && !scheduled.some((t) => Math.abs(t - cand.getTime()) < 3600e3)) {
        return cand;
      }
    }
  }
  return new Date(Date.now() + 2 * 864e5);
}
