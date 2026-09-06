// Agent 7 — Analytics.
// Tracks how each video actually performed and feeds that back to Content Strategy,
// so next month's topics are chosen from your own channel's results. This is the
// agent that turns a factory into a system. It writes recommendations into
// state.analytics.feedback, which Content Strategy reads on its next run.

import * as youtube from '../integrations/youtube.js';
import { llmAvailable, generateJSON } from '../providers/index.js';
import { rand } from '../util.js';

export const meta = {
  id: 'analytics',
  name: 'Analytics',
  order: 7,
  supervision: 'auto',
  channelLevel: true,
  blurb: 'Measures performance and feeds lessons back into strategy — the loop.',
};

export async function run(ctx) {
  const { state, log } = ctx;
  const published = state.videos.filter((v) => v.publish?.videoId);
  log('agent', `analyzing ${published.length} published video(s)…`);

  // Attach/refresh performance numbers per video.
  const realIds = published.filter((v) => !v.publish.mock).map((v) => v.publish.videoId);
  const realStats = realIds.length ? await youtube.videoStats(realIds) : {};
  for (const v of published) {
    const real = realStats[v.publish.videoId];
    v.analytics = real ? fromRealStats(real, v) : v.analytics || mockPerf(v);
  }

  const perFormat = summarizeByFormat(published);
  const report = {
    generatedAt: new Date().toISOString(),
    videosTracked: published.length,
    totals: totals(published),
    byFormat: perFormat,
    topPerformers: [...published].sort((a, b) => (b.analytics?.views || 0) - (a.analytics?.views || 0)).slice(0, 3)
      .map((v) => ({ title: v.seo?.title || v.topic.title, views: v.analytics.views, ctr: v.analytics.ctr })),
  };

  let feedback;
  if (llmAvailable() && published.length) {
    feedback = await llmFeedback(report).catch(() => heuristicFeedback(perFormat));
  } else {
    feedback = heuristicFeedback(perFormat);
  }

  state.analytics.lastReport = report;
  state.analytics.feedback = [...feedback, ...state.analytics.feedback].slice(0, 20);
  log('ok', `report ready. ${feedback.length} recommendation(s) sent back to Content Strategy.`);
  return { analyticsReport: report, feedback };
}

function fromRealStats(stats, v) {
  const views = Number(stats.viewCount || 0);
  return {
    views,
    likes: Number(stats.likeCount || 0),
    comments: Number(stats.commentCount || 0),
    ctr: v.analytics?.ctr ?? null, // CTR needs the Analytics API (OAuth); left null unless known
    avgViewPct: v.analytics?.avgViewPct ?? null,
    source: 'youtube-data-api',
  };
}

function mockPerf(v) {
  const base = { tutorial: 1.15, explainer: 1.0, list: 1.3, review: 0.9 }[v.topic.format] || 1;
  const views = Math.round(rand(400, 9000) * base);
  return {
    views,
    likes: Math.round(views * (rand(30, 70) / 1000)),
    comments: Math.round(views * (rand(3, 12) / 1000)),
    ctr: +(rand(30, 92) / 10).toFixed(1), // %
    avgViewPct: rand(28, 62),
    source: 'mock',
  };
}

function summarizeByFormat(videos) {
  const groups = {};
  for (const v of videos) {
    const f = v.topic.format;
    (groups[f] ||= []).push(v.analytics || {});
  }
  const out = {};
  for (const [f, arr] of Object.entries(groups)) {
    out[f] = {
      count: arr.length,
      avgViews: Math.round(avg(arr.map((a) => a.views || 0))),
      avgCtr: +avg(arr.map((a) => a.ctr || 0)).toFixed(1),
      avgRetention: Math.round(avg(arr.map((a) => a.avgViewPct || 0))),
    };
  }
  return out;
}

function totals(videos) {
  return {
    views: videos.reduce((s, v) => s + (v.analytics?.views || 0), 0),
    likes: videos.reduce((s, v) => s + (v.analytics?.likes || 0), 0),
    comments: videos.reduce((s, v) => s + (v.analytics?.comments || 0), 0),
  };
}

function heuristicFeedback(perFormat) {
  const entries = Object.entries(perFormat);
  if (!entries.length) return ['Not enough data yet — publish a few videos before trusting the loop.'];
  const best = entries.sort((a, b) => (b[1].avgViews || 0) - (a[1].avgViews || 0))[0];
  const worst = entries[entries.length - 1];
  const out = [`"${best[0]}" videos are your best format right now (avg ${best[1].avgViews} views) — propose more ${best[0]}s.`];
  if (worst[0] !== best[0]) out.push(`"${worst[0]}" is underperforming (avg ${worst[1].avgViews}); only make one if you have a strong personal angle.`);
  const lowRetention = entries.find(([, s]) => s.avgRetention && s.avgRetention < 40);
  if (lowRetention) out.push(`Retention on ${lowRetention[0]}s is low (${lowRetention[1].avgRetention}%) — tighten the hook and cut the intro.`);
  return out;
}

async function llmFeedback(report) {
  const system = 'You are a YouTube growth analyst. Give 2-4 concrete, specific recommendations to feed back into next month\'s topic selection. Base them only on the numbers provided.';
  const prompt = `Performance report:\n${JSON.stringify(report.byFormat, null, 2)}\nTop performers:\n${JSON.stringify(report.topPerformers, null, 2)}\n\nReturn JSON: { "recommendations": string[] }`;
  const data = await generateJSON({ system, prompt, temperature: 0.4, maxTokens: 700 });
  return (data.recommendations || []).slice(0, 4);
}

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
