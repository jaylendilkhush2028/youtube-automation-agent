// Agent 3 — Thumbnail Designer.
// Generates thumbnail concepts and sets up A/B variations to test click-through.
// It renders real 1280x720 SVG mockups (so you can actually look at them in the
// dashboard) and, when an image model is configured, can hand off a prompt for a
// photographic render. Runs with light supervision — just check the output.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { id, pick, wrapWords, xmlEscape } from '../util.js';

export const meta = {
  id: 'thumbnail-designer',
  name: 'Thumbnail Designer',
  order: 3,
  supervision: 'auto',
  channelLevel: false,
  blurb: 'Renders A/B thumbnail variants to test click-through rate.',
};

const PALETTES = [
  { bg: '#0f172a', accent: '#ef4444', text: '#ffffff', tag: '#f59e0b' },
  { bg: '#111827', accent: '#22d3ee', text: '#ffffff', tag: '#a3e635' },
  { bg: '#1e1b4b', accent: '#f472b6', text: '#ffffff', tag: '#fbbf24' },
  { bg: '#052e16', accent: '#4ade80', text: '#ffffff', tag: '#fde047' },
];

export async function run(ctx) {
  const { video, log } = ctx;
  const topic = video.topic;
  log('agent', 'designing 2 thumbnail variants for A/B test…');

  const dir = path.join(DATA_DIR, 'media', video.id);
  fs.mkdirSync(dir, { recursive: true });

  const shortText = shorten(topic.title);
  const [pa, pb] = pick(PALETTES, 2);
  const variants = [
    { variant: 'A', label: shortText, badge: badgeFor(topic.format), palette: pa, layout: 'left-text' },
    { variant: 'B', label: altText(topic), badge: 'NEW', palette: pb, layout: 'centered' },
  ].map((v) => {
    const file = path.join(dir, `thumb_${v.variant}.svg`);
    fs.writeFileSync(file, renderSVG(v));
    return {
      id: id('thumb'),
      variant: v.variant,
      concept: v.label,
      badge: v.badge,
      palette: v.palette,
      layout: v.layout,
      file: `thumb_${v.variant}.svg`,
      imagePrompt: `Bold YouTube thumbnail, ${topic.format}, subject "${topic.title}", high contrast, expressive face, 3-4 word overlay "${v.label}", palette ${v.palette.accent}.`,
      ctrTestStatus: 'ready',
    };
  });

  log('ok', `2 thumbnails rendered → A/B ready. Check they match the content.`);
  return { thumbnails: variants, thumbnailABTest: { status: 'ready', metric: 'ctr', winner: null } };
}

function shorten(title) {
  return title.replace(/[:—-].*$/, '').split(/\s+/).slice(0, 5).join(' ');
}
function altText(topic) {
  const map = { tutorial: 'STEP BY STEP', explainer: 'THE REAL REASON', list: 'RANKED', review: 'HONEST TAKE' };
  return map[topic.format] || 'WATCH THIS';
}
function badgeFor(format) {
  return { tutorial: 'HOW-TO', explainer: 'EXPLAINED', list: 'TOP 5', review: 'REVIEW' }[format] || 'NEW';
}

function renderSVG({ label, badge, palette, layout }) {
  const lines = wrapWords(label.toUpperCase(), 12, 3);
  const centered = layout === 'centered';
  const anchor = centered ? 'middle' : 'start';
  const x = centered ? 640 : 70;
  // Auto-fit: shrink the font so the widest line always stays inside the safe
  // width. Arial Black is heavy (~1em per glyph with the outline stroke), so we
  // size conservatively to stay inside 1280px in any renderer.
  const maxChars = Math.max(...lines.map((l) => l.length), 1);
  const safeWidth = centered ? 1040 : 1080;
  const fontSize = Math.max(44, Math.min(94, Math.floor(safeWidth / (maxChars * 0.98))));
  const lineH = Math.round(fontSize * 1.12);
  const startY = 360 - (lines.length - 1) * (lineH / 2) + fontSize / 3;
  const tspans = lines.map((ln, i) =>
    `<text x="${x}" y="${startY + i * lineH}" font-family="Arial Black, Arial, sans-serif" font-size="${fontSize}" font-weight="900" fill="${palette.text}" text-anchor="${anchor}" stroke="#000" stroke-width="6" paint-order="stroke">${xmlEscape(ln)}</text>`
  ).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${palette.bg}"/><stop offset="1" stop-color="#000000"/>
  </linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="${centered ? 640 : 1050}" cy="360" r="300" fill="${palette.accent}" opacity="0.18"/>
  <rect x="0" y="0" width="18" height="720" fill="${palette.accent}"/>
  <rect x="${centered ? 520 : 70}" y="90" width="240" height="64" rx="10" fill="${palette.tag}"/>
  <text x="${centered ? 640 : 190}" y="134" font-family="Arial Black, Arial, sans-serif" font-size="38" font-weight="900" fill="#000" text-anchor="middle">${xmlEscape(badge)}</text>
  ${tspans}
  <text x="1210" y="680" font-family="Arial, sans-serif" font-size="30" fill="${palette.text}" opacity="0.5" text-anchor="end">variant ${layout === 'centered' ? 'B' : 'A'}</text>
</svg>`;
}
