// One-time helper: turns your YouTube OAuth client (CLIENT_ID + CLIENT_SECRET)
// into a long-lived YOUTUBE_REFRESH_TOKEN and writes it straight into .env — the
// last missing piece for real uploads. A temporary loopback web server catches
// Google's OAuth redirect, so there is nothing to copy/paste by hand.
//
//   1) Create an OAuth client (Application type: "Desktop app") in Google Cloud
//      Console → APIs & Services → Credentials, and put its id/secret in .env as
//      YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.
//   2) Run:  npm run yt-token
//   3) Approve the consent screen in the browser that opens.
//
// No new dependencies — Node built-ins only. Reuses saveEnv() from src/config.js.

import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { saveEnv } from '../src/config.js';

// The scope that lets the agent upload/schedule videos. Want the analytics agent
// to read real data over OAuth too? Add more scopes here and re-run, e.g.:
//   'https://www.googleapis.com/auth/yt-analytics.readonly'
//   'https://www.googleapis.com/auth/youtube.readonly'
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

// A Desktop-app client accepts any loopback port automatically. If you made a
// "Web application" client instead, add this exact URL to its Authorized redirect
// URIs: http://127.0.0.1:4571  (override the port with OAUTH_PORT=... if needed).
const PORT = Number(process.env.OAUTH_PORT || 4571);
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  fail(
    'Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in .env.\n\n' +
    'Get them from Google Cloud Console → APIs & Services → Credentials →\n' +
    'Create Credentials → OAuth client ID → Application type: "Desktop app".\n' +
    'Paste both into .env, then run `npm run yt-token` again.',
  );
}

const state = crypto.randomBytes(16).toString('hex');

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  // Best-effort: the URL is also printed for manual opening if this fails.
  execFile(cmd, args, () => {});
}

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function respond(res, title, body) {
  if (res.writableEnded) return;
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font:16px system-ui;max-width:34rem;margin:4rem auto;text-align:center">` +
    `<h2>${title}</h2><p>${body}</p></body>`,
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    res.writeHead(204).end(); // ignore stray requests (favicon, etc.)
    return;
  }
  try {
    if (url.searchParams.get('error')) throw new Error(`consent denied: ${url.searchParams.get('error')}`);
    if (url.searchParams.get('state') !== state) throw new Error('state mismatch (possible CSRF) — please re-run');

    const tokens = await exchangeCode(url.searchParams.get('code'));
    if (!tokens.refresh_token) {
      respond(res, 'Almost there', 'Google did not return a refresh token — you have granted this app before. Revoke it at myaccount.google.com/permissions and re-run.');
      throw new Error(
        'No refresh_token returned. This happens when the app was already granted.\n' +
        'Revoke access at https://myaccount.google.com/permissions and run `npm run yt-token` again.',
      );
    }
    saveEnv({ YOUTUBE_REFRESH_TOKEN: tokens.refresh_token });
    respond(res, '✓ Connected', 'Refresh token saved to .env. Close this tab and return to the terminal.');
    console.log('\n✓ YOUTUBE_REFRESH_TOKEN saved to .env');
    console.log('  Restart the app (npm start) — the YouTube pill will be live.\n');
    server.close();
    process.exit(0);
  } catch (err) {
    respond(res, 'Something went wrong', String(err.message || err));
    fail(err.message || err);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') fail(`Port ${PORT} is in use. Free it, or run: OAUTH_PORT=<other-port> npm run yt-token`);
  fail(String(err.message || err));
});

server.listen(PORT, '127.0.0.1', () => {
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent',      // force it to be returned every time
    state,
  });
  console.log('\nOpening Google consent in your browser…');
  console.log("If it doesn't open, paste this URL manually:\n");
  console.log(authUrl + '\n');
  openBrowser(authUrl);
});

// Never hang forever — give up after 5 minutes.
setTimeout(() => fail('Timed out waiting for consent (5 min). Re-run when ready.'), 5 * 60 * 1000).unref();
