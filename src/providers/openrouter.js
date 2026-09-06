// OpenRouter — one key, many models (OpenAI-compatible surface).
export async function generateText({ system, prompt, temperature = 0.8, maxTokens = 2048, json = false }) {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'google/gemini-flash-1.5';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'HTTP-Referer': 'http://localhost:3456',
      'X-Title': 'YouTube Automation Agent',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
