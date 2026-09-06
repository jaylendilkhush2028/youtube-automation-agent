// Agent 1 — Content Strategy.
// Pulls trend data, checks competitors, identifies topics worth making, and plans
// the calendar. Reads the Analytics agent's feedback so next month's topics are
// chosen from your own channel's results. This is where the loop closes.

import * as youtube from '../integrations/youtube.js';
import { llmAvailable, generateJSON } from '../providers/index.js';
import { id, pick, rand, titleCase } from '../util.js';

export const meta = {
  id: 'content-strategy',
  name: 'Content Strategy',
  order: 1,
  supervision: 'auto',
  channelLevel: true,
  blurb: 'Pulls trend data, checks competitors, picks topics, plans the calendar.',
};

const FORMATS = ['tutorial', 'explainer', 'list', 'review'];

export async function run(ctx) {
  const { state, log } = ctx;
  const niche = state.settings.channel.niche || 'content creation';
  const count = ctx.count || 6;

  log('agent', `researching trends for "${niche}"…`);
  const trending = await youtube.searchTrending(niche, 10);
  const feedback = state.analytics.feedback.slice(-5);
  if (feedback.length) log('info', `applying ${feedback.length} learning(s) from analytics feedback loop`);

  let topics;
  if (llmAvailable()) {
    topics = await llmTopics({ niche, trending, feedback, count, channel: state.settings.channel });
  } else {
    topics = mockTopics({ niche, trending, feedback, count });
  }

  // Each topic carries a "genuineAngle" prompt — the guide's core discipline:
  // kill anything you have no real angle on.
  const now = Date.now();
  topics = topics.map((t, i) => ({
    id: id('topic'),
    title: t.title,
    format: FORMATS.includes(t.format) ? t.format : pick(FORMATS, 1)[0],
    angle: t.angle || 'What is the specific, non-obvious take only you can add here?',
    rationale: t.rationale || 'Trending in niche; low competitor coverage.',
    trendScore: t.trendScore ?? rand(55, 95),
    competitorGap: t.competitorGap ?? rand(20, 80),
    genuineAnglePrompt: 'Before this becomes a video: add one thing from your own experience that is not in any source. If you cannot, kill it.',
    status: 'proposed', // proposed -> approved -> in_production
    createdAt: new Date(now + i).toISOString(),
  }));

  state.topics = [...topics, ...state.topics].slice(0, 100);
  log('ok', `proposed ${topics.length} topics; awaiting your angle-check before any go into production.`);
  return { topics };
}

async function llmTopics({ niche, trending, feedback, count, channel }) {
  const system = `You are a YouTube content strategist for a channel about "${niche}"${channel.voice ? ` with this voice: ${channel.voice}` : ''}. You pick topics with real audience demand AND a gap a specific human creator can fill. Never propose generic, mass-producible topics.`;
  const prompt = `Recent popular videos in this niche:\n${trending.map((t) => `- ${t.title} (${t.channel})`).join('\n')}\n\n${feedback.length ? `What our own channel's analytics learned recently:\n${feedback.map((f) => `- ${f}`).join('\n')}\n\n` : ''}Propose ${count} video topics. For each return: title, format (tutorial|explainer|list|review), angle (the specific human take needed), rationale, trendScore (0-100), competitorGap (0-100). Return a JSON array.`;
  const data = await generateJSON({ system, prompt, temperature: 0.9, maxTokens: 1600 });
  return Array.isArray(data) ? data : data.topics || [];
}

function mockTopics({ niche, trending, feedback, count }) {
  const n = titleCase(niche);
  const templates = [
    { title: `The ${n} mistake that quietly kills your results`, format: 'explainer', angle: 'Tell the story of when you made this exact mistake and what it cost.' },
    { title: `${n} in 2026: what actually changed`, format: 'explainer', angle: 'Add the change nobody is talking about that you noticed first.' },
    { title: `I tried every ${niche} tool so you don't have to`, format: 'review', angle: 'Include the one you kept using and the numbers to prove it.' },
    { title: `5 ${niche} habits I stole from people better than me`, format: 'list', angle: 'Name the person and the specific moment you learned each one.' },
    { title: `How to actually start with ${niche} (step by step)`, format: 'tutorial', angle: 'Use your own first project as the worked example.' },
    { title: `Why most ${niche} advice is wrong`, format: 'explainer', angle: 'Pick the piece of advice you followed and regret.' },
    { title: `${n} tier list: what is worth your time`, format: 'list', angle: 'Rank from your real usage, not reputation.' },
    { title: `The ${niche} setup I wish I had on day one`, format: 'tutorial', angle: 'Show your actual setup and the mistake in your first one.' },
  ];
  const feedbackBias = feedback.some((f) => /tutorial/i.test(f)) ? 'tutorial' : null;
  return pick(templates, Math.min(count, templates.length)).map((t, i) => ({
    ...t,
    format: feedbackBias && i === 0 ? feedbackBias : t.format,
    rationale: trending[i] ? `Adjacent to a trending video: "${trending[i].title}".` : 'Steady search demand; personal angle available.',
    trendScore: rand(58, 94),
    competitorGap: rand(25, 78),
  }));
}
