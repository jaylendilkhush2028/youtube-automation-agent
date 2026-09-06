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
  const raw = await generateText({ ...opts, system, json: true });
  return extractJSON(raw);
}

export function extractJSON(text) {
  if (!text) throw new Error('empty response');
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('could not parse JSON from model response');
  }
}
