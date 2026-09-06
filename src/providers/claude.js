// Anthropic Claude (Messages API).
const BASE = 'https://api.anthropic.com/v1';

export async function generateText({ system, prompt, temperature = 0.8, maxTokens = 2048 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: system || undefined,
    messages: [{ role: 'user', content: prompt }],
  };
  const res = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.map((b) => b.text || '').join('') || '';
}
