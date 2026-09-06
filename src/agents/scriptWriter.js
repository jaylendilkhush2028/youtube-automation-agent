// Agent 2 — Script Writer.
// Turns an approved topic into a full script: hook, story, CTA — with a different
// template per format (tutorial / explainer / list / review).
//
// This is one of the two agents the guide says needs you EVERY time. The script it
// produces is a DRAFT and is flagged humanReviewRequired. The highest-leverage ten
// minutes in the pipeline is you rewriting the hook and adding something only you know.

import { llmAvailable, generateJSON } from '../providers/index.js';
import { rand } from '../util.js';

export const meta = {
  id: 'script-writer',
  name: 'Script Writer',
  order: 2,
  supervision: 'human',
  channelLevel: false,
  blurb: 'Drafts a full script (hook, story, CTA) per format. You rewrite it — every time.',
};

const STRUCTURES = {
  tutorial: ['Hook: the outcome they will have by the end', 'Why the usual way fails', 'Step-by-step walkthrough', 'The gotcha nobody warns you about', 'Recap + CTA'],
  explainer: ['Hook: the surprising claim', 'The context you need', 'The core idea, simply', 'Why the obvious answer is wrong', 'So what + CTA'],
  list: ['Hook: promise of the payoff item', 'Item-by-item with a reason each earns its place', 'The one most people skip', 'Ranking / verdict', 'CTA'],
  review: ['Hook: the verdict up front', 'What it claims vs what happened', 'Where it shines', 'Where it breaks', 'Who it is for + CTA'],
};

export async function run(ctx) {
  const { video, state, log } = ctx;
  const topic = video.topic;
  const channel = state.settings.channel;
  log('agent', `drafting ${topic.format} script for "${topic.title}"…`);

  let script;
  if (llmAvailable()) {
    script = await llmScript({ topic, channel });
  } else {
    script = mockScript({ topic, channel });
  }

  script.humanReviewRequired = true;
  script.humanReviewDone = false;
  script.wordCount = countWords(script);
  script.estReadMinutes = Math.max(1, Math.round(script.wordCount / 150));

  log('warn', `script drafted (${script.wordCount} words). Needs your rewrite: sharpen the hook + add one thing only you know.`);
  return {
    script,
    stageNote: 'Draft only. Open the script, rewrite the hook, and add a first-hand detail before approving.',
  };
}

function countWords(script) {
  const text = [script.hook, ...(script.sections || []).map((s) => s.body), script.cta].join(' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function llmScript({ topic, channel }) {
  const system = `You write YouTube scripts for a channel about "${channel.niche || 'this niche'}"${channel.voice ? `, voice: ${channel.voice}` : ''}. Structure for a ${topic.format}. Write a strong hook in the first 5 seconds. Leave an explicit [ADD YOUR OWN EXAMPLE HERE] placeholder where the creator's first-hand experience should go.`;
  const prompt = `Topic: ${topic.title}\nAngle to honor: ${topic.angle}\n\nReturn JSON: { "hook": string, "sections": [{"heading": string, "body": string}], "cta": string, "bRoll": [string] }`;
  const data = await generateJSON({ system, prompt, temperature: 0.85, maxTokens: 2200 });
  return {
    hook: data.hook || '',
    sections: data.sections || [],
    cta: data.cta || 'If this helped, subscribe.',
    bRoll: data.bRoll || [],
  };
}

function mockScript({ topic }) {
  const struct = STRUCTURES[topic.format] || STRUCTURES.explainer;
  return {
    hook: `In the next few minutes I'll show you ${topic.title.toLowerCase()} — and the part that changed how I think about it. [ADD YOUR OWN EXAMPLE HERE — the specific moment this mattered for you.]`,
    sections: struct.map((heading, i) => ({
      heading,
      body: i === struct.length - 1
        ? `Quick recap of what we covered, then the ask.`
        : `Draft body for "${heading}". This is placeholder structure — the real value is your first-hand take. ${i === 2 ? '[ADD YOUR OWN EXAMPLE HERE — a number from your own work, a client story, or the reason the obvious answer is wrong.]' : ''}`,
    })),
    cta: `If this saved you time, subscribe — I publish about ${topic.format}s like this. What should I cover next?`,
    bRoll: ['screen recording of the process', 'close-up of the key step', 'on-camera reaction to the gotcha'],
    _estWords: rand(650, 1100),
  };
}
