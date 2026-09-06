// Unified AI text interface. Agents call generateText / generateJSON without
// caring which provider is behind it. When no key is configured, activeProvider()
// returns 'mock' and llmAvailable() is false — agents then use their own offline
// generators, so the entire pipeline runs end-to-end with zero API keys.

import { resolveProvider } from '../config.js';
import { logger } from '../logger.js';
import * as gemini from './gemini.js';
import * as openai from './openai.js';
import * as claude from './claude.js';
import * as openrouter from './openrouter.js';

const IMPLS = { gemini, openai, claude, openrouter };

export function activeProvider() {
  return resolveProvider(process.env.AI_PROVIDER);
}

export function llmAvailable() {
  return activeProvider() !== 'mock';
}

/**
 * Generate plain text from the active provider.
 * @returns {Promise<string>}
 */
export async function generateText(opts) {
  const name = activeProvider();
  if (name === 'mock') return '';
  const impl = IMPLS[name];
  try {
    return await impl.generateText(opts);
  } catch (err) {
    logger.error(name, `text generation failed: ${err.message}`);
    throw err;
  }
}

/**
 * Generate JSON. We instruct the model to return only JSON, then robustly
 * extract the first JSON object/array from the response.
 */
export async function generateJSON(opts) {
  const system = `${opts.system || ''}\n\nRespond with valid JSON only. No markdown fences, no commentary.`.trim();
  // JSON responses (especially scripts) are long, and newer "thinking" models
  // spend output tokens reasoning before the answer — too small a budget leaves
  // the JSON truncated mid-array. Give it generous headroom regardless of the
  // caller's hint so thinking + the actual JSON both fit.
  const maxTokens = Math.max(opts.maxTokens || 0, 8192);
  const raw = await generateText({ ...opts, system, maxTokens, json: true });
  return extractJSON(raw);
}

export function extractJSON(text) {
  if (!text) throw new Error('empty response');
  let s = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const first = s.search(/[[{]/);
  if (first > 0) s = s.slice(first); // drop any prose before the JSON begins

  // Try progressively harder: the string as-is, trimmed to its outer bracket
  // pair, and a repair for responses cut off by the token limit — each also
  // with trailing commas removed (a common model slip).
  const variants = [s];
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (end > 0) variants.push(s.slice(0, end + 1));
  const repaired = repairTruncatedJSON(s);
  if (repaired) variants.push(repaired);

  for (const v of variants) {
    for (const attempt of [v, v.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(attempt); } catch { /* try the next variant */ }
    }
  }
  throw new Error(`could not parse JSON from model response (starts: ${s.slice(0, 100)}…)`);
}

// Best-effort recovery when the model's JSON was cut off (hit the token limit):
// close any dangling string, drop a trailing partial token, and balance the
// still-open brackets. Returns null if the input already looks complete.
function repairTruncatedJSON(s) {
  const scan = (str) => {
    const stack = []; let inStr = false, esc = false;
    for (const ch of str) {
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    return { stack, inStr };
  };
  const initial = scan(s);
  if (!initial.inStr && initial.stack.length === 0) return null; // already complete

  let out = s;
  if (initial.inStr) out += '"';                       // close a dangling string
  out = out.replace(/[,\s]+$/, '');                    // drop trailing comma/space
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, '');       // drop a key with no value
  out = out.replace(/[,\s]+$/, '');
  const { stack, inStr } = scan(out);                  // recompute on the trimmed text
  if (inStr) out += '"';
  return out + stack.reverse().join('');
}
