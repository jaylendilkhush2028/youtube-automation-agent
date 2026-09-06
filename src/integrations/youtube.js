// YouTube Data API v3 integration.
//   - Trend / competitor research uses a simple API key (YOUTUBE_API_KEY).
//   - Uploading & analytics use OAuth (client id/secret + refresh token).
// When credentials are absent, every function returns realistic mock data so the
// pipeline is fully demonstrable offline. Nothing here ever publishes without an
// explicit approved+confirmed call from the orchestrator.

import { logger } from '../logger.js';

const DATA_API = 'https://www.googleapis.com/youtube/v3';

export function hasReadKey() { return !!process.env.YOUTUBE_API_KEY; }
export function hasUploadAuth() {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

/** Search recent, popular videos for a niche — the raw material for trend spotting. */
export async function searchTrending(niche, max = 10) {
  if (!hasReadKey()) return mockTrending(niche, max);
  const params = new URLSearchParams({
    part: 'snippet', q: niche, type: 'video', order: 'viewCount',
    publishedAfter: new Date(Date.now() - 30 * 864e5).toISOString(),
    maxResults: String(max), key: process.env.YOUTUBE_API_KEY,
  });
  const res = await fetch(`${DATA_API}/search?${params}`);
  if (!res.ok) { logger.warn('youtube', `search failed ${res.status}, using mock`); return mockTrending(niche, max); }
  const data = await res.json();
  return (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    publishedAt: it.snippet.publishedAt,
  }));
}

/** Fetch statistics for a set of videos (views/likes/comments). */
export async function videoStats(videoIds) {
  if (!hasReadKey() || !videoIds.length) return {};
  const params = new URLSearchParams({ part: 'statistics', id: videoIds.join(','), key: process.env.YOUTUBE_API_KEY });
  const res = await fetch(`${DATA_API}/videos?${params}`);
  if (!res.ok) return {};
  const data = await res.json();
  const out = {};
  for (const it of data.items || []) out[it.id] = it.statistics;
  return out;
}

/** Exchange the stored refresh token for a short-lived access token. */
async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`token refresh ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Upload (or schedule) a video. Requires OAuth. This is the ONLY function that
 * mutates the real channel, and the orchestrator only calls it after every
 * approval gate has passed. `privacyStatus: 'private'` + publishAt schedules it.
 */
export async function uploadVideo({ filePath, title, description, tags, publishAt, madeForKids = false, syntheticDisclosure = true }) {
  if (!hasUploadAuth()) return mockUpload({ title, publishAt, syntheticDisclosure });

  const fs = await import('node:fs');
  const token = await accessToken();
  const metadata = {
    snippet: { title, description, tags, categoryId: '27' },
    status: {
      privacyStatus: publishAt ? 'private' : 'public',
      publishAt: publishAt || undefined,
      selfDeclaredMadeForKids: madeForKids,
      // YouTube's altered/synthetic-content disclosure lives in the upload flow.
      containsSyntheticMedia: syntheticDisclosure,
    },
  };
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'X-Upload-Content-Type': 'video/*' }, body: JSON.stringify(metadata) },
  );
  if (!init.ok) throw new Error(`upload init ${init.status}: ${await init.text()}`);
  const uploadUrl = init.headers.get('location');
  const bytes = fs.readFileSync(filePath);
  const up = await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/*' }, body: bytes });
  if (!up.ok) throw new Error(`upload ${up.status}: ${await up.text()}`);
  const result = await up.json();
  logger.ok('youtube', `uploaded ${result.id} (${publishAt ? 'scheduled' : 'public'})`);
  return { videoId: result.id, url: `https://youtu.be/${result.id}`, scheduledFor: publishAt || null, mock: false };
}

// ---- Mocks -------------------------------------------------------------------

function mockTrending(niche, max) {
  const base = niche || 'your niche';
  const seeds = [
    `The ${base} mistake everyone makes`, `${base} in 2026: what actually changed`,
    `I tried ${base} for 30 days`, `Why your ${base} isn't working`,
    `${base} explained in 8 minutes`, `The truth about ${base}`,
    `${base}: beginner vs pro`, `5 ${base} tools I actually use`,
    `Stop doing ${base} like this`, `${base} tier list`,
  ];
  return seeds.slice(0, max).map((title, i) => ({
    videoId: `mock_${i}`, title, channel: `Channel ${String.fromCharCode(65 + i)}`,
    publishedAt: new Date(Date.now() - i * 3 * 864e5).toISOString(),
    stats: { viewCount: 50000 + (max - i) * 41000 + i * 137 },
  }));
}

function mockUpload({ title, publishAt, syntheticDisclosure }) {
  const id = 'mock' + Math.random().toString(36).slice(2, 9);
  logger.warn('youtube', `[mock] would upload "${title}" (synthetic disclosure: ${syntheticDisclosure ? 'yes' : 'no'})`);
  return { videoId: id, url: `https://youtu.be/${id}`, scheduledFor: publishAt || null, mock: true };
}
