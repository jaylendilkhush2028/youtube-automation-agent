// Google Gemini (has a free tier — the guide's recommended starting point).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// `gemini-flash-lite-latest` is an alias that tracks the current stable
// Flash-Lite model. Two reasons for this default: (1) an alias won't break when
// Google retires a specific version (already happened: 1.5 → 2.5 → 3.x), and
// (2) Flash-Lite has a far larger free-tier daily quota than the newest full
// Flash, which allows only ~20 requests/day free — you'd run out in a couple of
// pipeline runs. Prefer higher quality and have billing? Set
// GEMINI_MODEL=gemini-flash-latest (or any specific model) to override.
const DEFAULT_MODEL = 'gemini-flash-lite-latest';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generateText({ system, prompt, temperature = 0.8, maxTokens = 2048 }) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };

  // The free tier intermittently returns 429/500/503 under load ("high demand").
  // Retry those with exponential backoff so a brief spike doesn't fail the whole
  // pipeline run. Non-transient errors (bad key, bad model) fail fast.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err; // network blip — treat as transient
      if (attempt < 3) { await sleep(800 * 2 ** attempt); continue; }
      throw lastErr;
    }
    if (res.ok) {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    }
    lastErr = new Error(`gemini ${res.status}: ${await res.text()}`);
    if (![429, 500, 502, 503].includes(res.status)) break; // permanent error → stop retrying
    if (attempt < 3) await sleep(800 * 2 ** attempt); // 0.8s, 1.6s, 3.2s
  }
  throw lastErr;
}
