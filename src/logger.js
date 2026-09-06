// A logger that both prints to the console and keeps a ring buffer of recent
// events so the dashboard can show a live activity feed.

const BUFFER = [];
const MAX = 500;
const subscribers = new Set();

const COLORS = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', agent: '\x1b[35m' };
const RESET = '\x1b[0m';

export function log(level, source, message, meta) {
  const event = { ts: new Date().toISOString(), level, source, message, meta };
  BUFFER.push(event);
  if (BUFFER.length > MAX) BUFFER.shift();
  const color = COLORS[level] || '';
  const tag = source ? `[${source}]` : '';
  // eslint-disable-next-line no-console
  console.log(`${color}${tag}${RESET} ${message}`);
  for (const fn of subscribers) {
    try { fn(event); } catch { /* ignore subscriber errors */ }
  }
  return event;
}

export const logger = {
  info: (source, msg, meta) => log('info', source, msg, meta),
  ok: (source, msg, meta) => log('ok', source, msg, meta),
  warn: (source, msg, meta) => log('warn', source, msg, meta),
  error: (source, msg, meta) => log('error', source, msg, meta),
  agent: (source, msg, meta) => log('agent', source, msg, meta),
};

export function recentEvents(limit = 100) {
  return BUFFER.slice(-limit);
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
