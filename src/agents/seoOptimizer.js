// Agent 4 — SEO Optimizer.
// Researches keywords and writes the title, description, and tags so the video is
// findable. Low supervision — check the output, not the process.

import { llmAvailable, generateJSON } from '../providers/index.js';
import { slugify } from '../util.js';

export const meta = {
  id: 'seo-optimizer',
  name: 'SEO Optimizer',
  order: 4,
  supervision: 'auto',
  channelLevel: false,
  blurb: 'Keyword research + title, description, and tags for discoverability.',
};

export async function run(ctx) {
  const { video, state, log } = ctx;
  const topic = video.topic;
  log('agent', 'researching keywords and writing metadata…');

  let seo;
  if (llmAvailable()) {
    seo = await llmSEO({ topic, channel: state.settings.channel });
  } else {
    seo = mockSEO({ topic });
  }

  // Guard rails: titles <= 100 chars, <= 500 tag chars total (YouTube limits).
  seo.title = (seo.title || topic.title).slice(0, 100);
  seo.tags = dedupe(seo.tags || []).slice(0, 30);
  seo.description = ensureDisclosureNote(seo.description || '', state);
  log('ok', `title + ${seo.tags.length} tags + description ready.`);
  return { seo };
}

function ensureDisclosureNote(desc, state) {
  // A gentle reminder in the description that synthetic media is disclosed at upload.
  const note = '\n\n—\nThis video was produced with AI assistance; any realistic synthetic media is disclosed on upload.';
  if (state.settings.syntheticDisclosureDefault && !/synthetic|ai assistance/i.test(desc)) return desc + note;
  return desc;
}

function dedupe(arr) { return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))]; }

async function llmSEO({ topic, channel }) {
  const system = `You are a YouTube SEO specialist. Write metadata that is accurate to the video and not clickbait. Niche: ${channel.niche || 'general'}.`;
  const prompt = `Topic: ${topic.title}\nFormat: ${topic.format}\nAngle: ${topic.angle}\n\nReturn JSON: { "title": string (<=100 chars, keyword-front-loaded), "description": string (2-3 short paragraphs + 3 chapter timestamps placeholder), "tags": string[] (15-25), "keywords": string[] (primary search terms) }`;
  const data = await generateJSON({ system, prompt, temperature: 0.6, maxTokens: 1200 });
  return { title: data.title, description: data.description, tags: data.tags || [], keywords: data.keywords || [] };
}

function mockSEO({ topic }) {
  const base = topic.title;
  const kw = base.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 3);
  const tags = dedupe([
    ...kw, `${kw[0]} tutorial`, `${kw[0]} 2026`, `how to ${kw[0]}`, `${kw[0]} explained`,
    topic.format, `best ${kw[0]}`, `${kw[0]} tips`, `${kw[0]} guide`, `${kw[0]} for beginners`,
  ]);
  return {
    title: base.length <= 100 ? base : base.slice(0, 97) + '…',
    description: `${base}.\n\nIn this ${topic.format}: ${topic.angle}\n\n00:00 Intro\n00:35 The main idea\n03:10 The part most people miss\n\nWatch to the end for the takeaway.`,
    tags,
    keywords: kw.slice(0, 5),
    slug: slugify(base),
  };
}
