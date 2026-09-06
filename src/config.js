// Central configuration. Secrets live in .env; everything else lives in the JSON
// store (see store.js). We deliberately avoid the dotenv dependency and parse .env
// ourselves so the only runtime dependency is express.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const ENV_PATH = path.join(ROOT, '.env');
export const DATA_DIR = path.join(ROOT, 'data');

/** Minimal .env parser: KEY=value, ignores blanks and # comments, strips quotes. */
export function loadEnv(envPath = ENV_PATH) {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}

/** Write/merge keys into .env, preserving comments and existing order where possible. */
export function saveEnv(updates, envPath = ENV_PATH) {
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const seen = new Set();
  const lines = existing.map((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return raw;
    const eq = line.indexOf('=');
    if (eq === -1) return raw;
    const key = line.slice(0, eq).trim();
    if (key in updates) {
      seen.add(key);
      return `${key}=${formatEnvVal(updates[key])}`;
    }
    return raw;
  });
  for (const [key, val] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${formatEnvVal(val)}`);
  }
  fs.writeFileSync(envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
  loadEnv(envPath);
}

function formatEnvVal(val) {
  const s = String(val ?? '');
  return /\s|#|"|'/.test(s) ? JSON.stringify(s) : s;
}

/**
 * Resolve which AI text provider to use, based on available keys and the
 * configured preference. Falls back to the offline "mock" provider so the whole
 * pipeline runs with zero keys — exactly what you want while learning it.
 */
export function resolveProvider(preferred) {
  const order = preferred && preferred !== 'auto'
    ? [preferred]
    : ['gemini', 'openai', 'claude', 'openrouter'];
  for (const name of order) {
    if (hasKeyFor(name)) return name;
  }
  return 'mock';
}

export function hasKeyFor(name) {
  switch (name) {
    case 'gemini': return !!process.env.GEMINI_API_KEY;
    case 'openai': return !!process.env.OPENAI_API_KEY;
    case 'claude': return !!process.env.ANTHROPIC_API_KEY;
    case 'openrouter': return !!process.env.OPENROUTER_API_KEY;
    case 'mock': return true;
    default: return false;
  }
}

/** A snapshot of which integrations are wired up, for the dashboard status panel. */
export function integrationStatus() {
  return {
    textProvider: resolveProvider(process.env.AI_PROVIDER),
    providers: {
      gemini: hasKeyFor('gemini'),
      openai: hasKeyFor('openai'),
      claude: hasKeyFor('claude'),
      openrouter: hasKeyFor('openrouter'),
    },
    youtube: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN),
    youtubeReadOnly: !!process.env.YOUTUBE_API_KEY,
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
  };
}

loadEnv();

export const PORT = Number(process.env.PORT || 3456);
