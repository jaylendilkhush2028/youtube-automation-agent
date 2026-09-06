import crypto from 'node:crypto';

export function id(prefix = 'v') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

export function pick(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
}

export function rand(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Escape text for safe inclusion in SVG. */
export function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** Wrap text into <= n lines of roughly `width` chars, for thumbnail rendering. */
export function wrapWords(text, width = 16, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width && line) { lines.push(line.trim()); line = w; }
    else line = (line + ' ' + w).trim();
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line.trim());
  return lines;
}
