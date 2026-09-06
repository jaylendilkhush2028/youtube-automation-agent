// Dashboard client. Polls /api/state and renders. Vanilla JS, no build step.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let STATE = null;
let VIEW = 'pipeline';
let BUSY = new Set();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
const fmtDate = (d) => (d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function act(key, fn, okMsg) {
  if (BUSY.has(key)) return;
  BUSY.add(key);
  render();
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
    await refresh();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    BUSY.delete(key);
    render();
  }
}

// ---- data --------------------------------------------------------------------
async function refresh() {
  try {
    STATE = await api('/api/state');
    render();
  } catch (e) { /* server maybe restarting */ }
}

// ---- top-level render --------------------------------------------------------
function render(opts = {}) {
  if (!STATE) return;
  renderStatus();
  renderChain();
  $('#navApprovals').textContent = STATE.counts.awaitingApproval || '';
  $$('#sidenav button').forEach((b) => b.classList.toggle('active', b.dataset.view === VIEW));
  const main = $('#main');
  const html =
    VIEW === 'pipeline' ? viewPipeline()
    : VIEW === 'approvals' ? viewApprovals()
    : VIEW === 'analytics' ? viewAnalytics()
    : VIEW === 'activity' ? viewActivity()
    : VIEW === 'setup' ? viewSetup()
    : '';
  // Background polls re-render on a timer; when they do, keep whatever the user is
  // mid-edit (typed text, checkbox state, focus + caret) so forms never get wiped.
  if (opts.preserve) setMainPreserving(main, html);
  else main.innerHTML = html;
}

// Stable identity for an editable control, from whichever data-* attribute it carries.
const FIELD_ATTRS = ['key', 'set', 'setb', 'setn', 'notes', 'gate'];
function fieldKeyOf(el) {
  if (!el || !el.dataset) return null;
  for (const a of FIELD_ATTRS) if (el.dataset[a] != null) return `${a}:${el.dataset[a]}`;
  return null;
}
function setMainPreserving(main, html) {
  const active = document.activeElement;
  const activeKey = main.contains(active) ? fieldKeyOf(active) : null;
  const selStart = activeKey ? active.selectionStart : null;
  const selEnd = activeKey ? active.selectionEnd : null;

  const snap = new Map();
  $$('input,textarea,select', main).forEach((el) => {
    const k = fieldKeyOf(el);
    if (k) snap.set(k, el.type === 'checkbox' ? el.checked : el.value);
  });

  main.innerHTML = html;

  $$('input,textarea,select', main).forEach((el) => {
    const k = fieldKeyOf(el);
    if (k && snap.has(k)) {
      if (el.type === 'checkbox') el.checked = snap.get(k);
      else el.value = snap.get(k);
    }
  });
  if (activeKey) {
    const el = $$('input,textarea,select', main).find((e) => fieldKeyOf(e) === activeKey);
    if (el) { el.focus(); try { el.setSelectionRange(selStart, selEnd); } catch { /* non-text input */ } }
  }
}

function renderStatus() {
  const i = STATE.integrations;
  const pill = (on, label, cls = '') => `<span class="pill ${on ? 'on' : (cls || 'off')}"><span class="dot"></span>${label}</span>`;
  const voice = i.voice || (i.elevenlabs ? 'elevenlabs' : 'mock');
  const voiceLabel = { elevenlabs: 'Voice: ElevenLabs', say: 'Voice: free (system)', mock: 'Voice: mock' }[voice] || 'Voice: mock';
  $('#statusPills').innerHTML = [
    pill(i.textProvider !== 'mock', `AI: ${i.textProvider}`, i.textProvider === 'mock' ? 'warn' : ''),
    pill(i.youtube, i.youtube ? 'YouTube: live' : 'YouTube: mock', 'warn'),
    pill(voice !== 'mock', voiceLabel, 'warn'),
  ].join('');
}

function renderChain() {
  const active = new Set();
  for (const v of STATE.videos) {
    if (v.stage === 'scripting') active.add('script-writer');
    if (v.stage === 'thumbnails') active.add('thumbnail-designer');
    if (v.stage === 'seo') active.add('seo-optimizer');
    if (v.stage === 'production') active.add('production-management');
    if (v.stage === 'review') active.add('publishing-scheduling');
  }
  $('#agentChain').innerHTML = STATE.agents.map((a) => `
    <div class="agent-node ${active.has(a.id) ? 'active' : ''}">
      <div class="n">Agent ${a.order}</div>
      <div class="name">${esc(a.name)}</div>
      <div class="blurb">${esc(a.blurb)}</div>
      <span class="sup ${a.supervision}">${a.supervision === 'human' ? 'You, every time' : 'Runs itself'}</span>
    </div>`).join('');
}

// ---- Pipeline view -----------------------------------------------------------
function viewPipeline() {
  const c = STATE.counts;
  const proposed = STATE.topics.filter((t) => t.status === 'proposed');
  const active = STATE.videos.filter((v) => v.stage !== 'rejected');

  return `
  <div class="kpis">
    ${kpi(c.topics, 'Topics proposed')}
    ${kpi(c.inPipeline, 'In production')}
    ${kpi(c.awaitingApproval, 'Awaiting your review')}
    ${kpi(c.scheduled, 'Scheduled / live')}
  </div>

  <div class="section">
    <h2>Content Strategy <span class="hint">Run weekly. Read the list. Kill anything you have no genuine angle on.</span></h2>
    <div class="row" style="margin:10px 0 16px">
      <button class="btn primary" data-act="strategy" ${busyAttr('strategy')}>${BUSY.has('strategy') ? 'Researching…' : '↻ Run strategy agent'}</button>
      <button class="btn" data-act="oneclick" ${busyAttr('oneclick')}>${BUSY.has('oneclick') ? 'Running pipeline…' : '⚡ One-click: topic → gate'}</button>
      <span class="spacer"></span>
      <span class="hint">${proposed.length} proposed topic${proposed.length === 1 ? '' : 's'}</span>
    </div>
    ${proposed.length ? proposed.map(topicCard).join('') : `<div class="empty">No proposed topics yet. Run the strategy agent to generate some.</div>`}
  </div>

  <div class="section">
    <h2>Production Board <span class="hint">Click a video to inspect what each agent produced.</span></h2>
    ${active.length ? `<div class="board">${active.map(videoCard).join('')}</div>` : `<div class="empty">No videos in production. Start one from a topic above.</div>`}
  </div>`;
}

function kpi(v, k) { return `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`; }
function busyAttr(key) { return BUSY.has(key) ? 'disabled' : ''; }

function topicCard(t) {
  return `<div class="topic">
    <div class="t-title">${esc(t.title)}</div>
    <div class="t-meta">
      <span class="tag fmt">${t.format}</span>
      <span class="tag">trend ${t.trendScore}</span>
      <span class="tag">gap ${t.competitorGap}</span>
    </div>
    <div class="score-bar"><i style="width:${t.trendScore}%"></i></div>
    <div class="angle">Angle to add: ${esc(t.angle)}</div>
    <div class="row" style="margin-top:10px">
      <button class="btn green small" data-act="create-video" data-id="${t.id}" ${busyAttr('create-' + t.id)}>Start production →</button>
      <span class="hint">${esc(t.genuineAnglePrompt || '')}</span>
    </div>
  </div>`;
}

function videoCard(v) {
  const stages = ['scripting', 'thumbnails', 'seo', 'production', 'review', 'done'];
  const idx = stages.indexOf(v.stage === 'publishing' ? 'done' : v.stage);
  const thumb = v.thumbnails?.[0] ? `/media/${v.id}/${v.thumbnails[0].file}` : '';
  return `<div class="vcard" data-open="${v.id}">
    <div class="thumb" style="${thumb ? `background-image:url('${thumb}')` : ''}">
      <span class="tag fmt fmt-badge">${v.topic.format}</span>
    </div>
    <div class="vbody">
      <div class="vtitle">${esc(v.seo?.title || v.topic.title)}</div>
      <div class="vstage">
        <span class="stage-chip st-${v.stage}">${stageLabel(v)}</span>
      </div>
      <div class="mini-progress">
        ${stages.slice(0, 5).map((s, i) => `<i class="${i < idx ? 'done' : i === idx ? 'cur' : ''}"></i>`).join('')}
      </div>
    </div>
  </div>`;
}

function stageLabel(v) {
  if (v.stage === 'review') return 'Awaiting review';
  if (v.stage === 'done') return v.status === 'scheduled' ? 'Scheduled' : 'Published';
  if (v.stage === 'rejected') return 'Rejected';
  return v.stage;
}

// ---- Approvals view ----------------------------------------------------------
function viewApprovals() {
  const queue = STATE.videos.filter((v) => v.stage === 'review');
  if (!queue.length) {
    return `<div class="section"><h2>Approval Queue</h2>
      <div class="note">The single best decision in this whole pipeline is leaving these gates on. Nothing publishes until you clear all three, every time.</div>
      <div class="empty">Nothing waiting. When a video finishes production it lands here for your sign-off.</div></div>`;
  }
  return `<div class="section"><h2>Approval Queue <span class="hint">Review each video before it can be scheduled.</span></h2>
    <div class="note">Watch the finished cut once at speed. Check the voiceover didn't mangle anything, the thumbnail matches the content, and no claim in the script is invented.</div>
    ${queue.map(approveCard).join('')}
  </div>`;
}

function approveCard(v) {
  const g = STATE.settings.approvalGates;
  return `<div class="approve-card" data-approve="${v.id}">
    <div class="row">
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px">${esc(v.seo?.title || v.topic.title)}</div>
        <div class="hint">${v.topic.format} · ~${v.production?.durationSec || '?'}s · ${v.script?.wordCount || '?'} words</div>
      </div>
      <button class="btn small" data-open="${v.id}">Inspect full video →</button>
    </div>
    <div class="checklist">
      ${gateRow(v.id, 'factualReview', 'Factual review', 'Every claim in the script is true and sourced — nothing invented.', g.factualReview)}
      ${gateRow(v.id, 'mediaRights', 'Media rights confirmed', 'You have the rights to every image, clip, and sound used.', g.mediaRights)}
      ${gateRow(v.id, 'humanSignoff', 'Human sign-off', 'You watched the finished cut and you would put your name on it.', g.humanSignoff)}
      ${gateRow(v.id, 'syntheticDisclosure', 'Disclose synthetic media', 'Label realistic AI-generated content in the upload flow. Costs nothing.', true, true)}
    </div>
    <div class="field"><textarea data-notes="${v.id}" rows="2" placeholder="Notes (optional): what you changed, what you added from your own experience…"></textarea></div>
    <div class="row">
      <button class="btn green" data-act="approve" data-id="${v.id}" ${busyAttr('approve-' + v.id)}>✓ Approve & schedule</button>
      <button class="btn ghost" data-act="reject" data-id="${v.id}">✕ Reject</button>
      <span class="hint">Publishing is blocked in code until the gates above are checked.</span>
    </div>
  </div>`;
}

function gateRow(id, key, title, desc, enabled, preChecked = false) {
  if (!enabled) return '';
  return `<label class="gate">
    <input type="checkbox" data-gate="${id}:${key}" ${preChecked ? 'checked' : ''}/>
    <div><div class="g-title">${title}</div><div class="g-desc">${desc}</div></div>
  </label>`;
}

// ---- Analytics view ----------------------------------------------------------
function viewAnalytics() {
  const a = STATE.analytics;
  const r = a.lastReport;
  return `
  <div class="section">
    <h2>Analytics <span class="hint">Read monthly. Actually act on it — the loop only compounds if you let it change what you make.</span></h2>
    <div class="row" style="margin:8px 0 14px">
      <button class="btn primary" data-act="analytics" ${busyAttr('analytics')}>${BUSY.has('analytics') ? 'Analyzing…' : '↻ Run analytics agent'}</button>
    </div>
    ${r ? `
      <div class="stat-grid">
        ${kpi(fmtNum(r.totals.views), 'Total views')}
        ${kpi(fmtNum(r.totals.likes), 'Likes')}
        ${kpi(fmtNum(r.totals.comments), 'Comments')}
        ${kpi(r.videosTracked, 'Videos tracked')}
      </div>
      <table class="fmt-table">
        <tr><th>Format</th><th>Videos</th><th>Avg views</th><th>Avg CTR</th><th>Avg retention</th></tr>
        ${Object.entries(r.byFormat).map(([f, s]) => `<tr><td>${f}</td><td>${s.count}</td><td>${fmtNum(s.avgViews)}</td><td>${s.avgCtr || '—'}%</td><td>${s.avgRetention || '—'}%</td></tr>`).join('')}
      </table>` : `<div class="empty">No report yet. Publish a video (or run the analytics agent) to generate one.</div>`}
  </div>

  <div class="section">
    <h2>Feedback Loop → Content Strategy <span class="hint">These recommendations steer the next strategy run.</span></h2>
    ${a.feedback?.length ? a.feedback.map((f) => `<div class="feedback-item"><div>${esc(f)}</div></div>`).join('') : `<div class="empty">No feedback yet.</div>`}
  </div>`;
}

// ---- Activity view -----------------------------------------------------------
function viewActivity() {
  const runs = STATE.runs;
  return `
  <div class="section">
    <h2>Recent Runs</h2>
    ${runs.length ? runs.map((r) => `<div class="log-line"><span class="ts">${fmtDate(r.startedAt).split(',')[1] || ''}</span><span class="src">${r.kind}</span><span class="lv-${r.status === 'error' ? 'error' : r.status === 'ok' ? 'ok' : 'info'}">${r.status}${r.summary ? ' · ' + esc(r.summary) : ''}</span></div>`).join('') : `<div class="empty">No runs yet.</div>`}
  </div>
  <div class="section">
    <h2>Live Activity</h2>
    <div id="logFeed">${STATE.events.slice().reverse().map(logLine).join('')}</div>
  </div>`;
}

function logLine(e) {
  const t = new Date(e.ts).toLocaleTimeString([], { hour12: false });
  return `<div class="log-line"><span class="ts">${t}</span><span class="src">${esc(e.source || '')}</span><span class="lv-${e.level}">${esc(e.message)}</span></div>`;
}

// ---- Setup view --------------------------------------------------------------
function viewSetup() {
  const s = STATE.settings;
  const i = STATE.integrations;
  return `
  <div class="section">
    <h2>Channel</h2>
    <div class="grid2">
      <div class="field"><label>Channel name</label><input data-set="channel.name" value="${esc(s.channel.name)}" placeholder="My Channel"/></div>
      <div class="field"><label>Niche</label><input data-set="channel.niche" value="${esc(s.channel.niche)}" placeholder="e.g. home espresso, indie game dev"/></div>
    </div>
    <div class="field"><label>Your voice / point of view</label><input data-set="channel.voice" value="${esc(s.channel.voice)}" placeholder="blunt, practical, first-hand, no fluff"/></div>
    <button class="btn primary" data-act="save-settings">Save channel</button>
  </div>

  <div class="section">
    <h2>AI Provider <span class="hint">Currently: ${i.textProvider}${i.textProvider === 'mock' ? ' — offline demo mode' : ''}</span></h2>
    <div class="note">You can run the entire pipeline with zero keys in demo mode. Add one key to generate real topics, scripts, SEO, and analysis.</div>
    <div class="field"><label>Preferred provider</label>
      <select data-key="AI_PROVIDER">
        ${['auto', 'gemini', 'openai', 'claude', 'openrouter'].map((p) => `<option value="${p}" ${STATE.settings._provider === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <div class="desc">"auto" picks the first provider you have a key for.</div>
    </div>
    <div class="grid2">
      ${keyField('GEMINI_API_KEY', 'Gemini API key', i.providers.gemini, 'Free tier available')}
      ${keyField('OPENAI_API_KEY', 'OpenAI API key', i.providers.openai)}
      ${keyField('ANTHROPIC_API_KEY', 'Claude API key', i.providers.claude)}
      ${keyField('OPENROUTER_API_KEY', 'OpenRouter API key', i.providers.openrouter)}
    </div>
    <button class="btn primary" data-act="save-keys">Save keys</button>
  </div>

  <div class="section">
    <h2>YouTube & Voice</h2>
    <div class="grid2">
      ${keyField('YOUTUBE_API_KEY', 'YouTube Data API key', i.youtubeReadOnly, 'For trend & competitor research (read-only)')}
      ${keyField('ELEVENLABS_API_KEY', 'ElevenLabs key', i.elevenlabs, `Optional — most natural voice. Currently using: ${voiceName(i.voice)}`)}
    </div>
    <div class="note">Voiceover works out of the box with a <b>free built-in voice</b> — no key needed. Add an ElevenLabs key only if you want the most natural narration.</div>
    <div class="note red">Uploading requires OAuth (client id/secret + refresh token). Put your OAuth client id/secret in <code>.env</code>, then run <code>npm run yt-token</code> in the terminal to connect a channel. Don't point it at a monetized channel while learning.</div>
    <button class="btn primary" data-act="save-keys">Save keys</button>
  </div>

  <div class="section">
    <h2>Approval Gates & Cadence</h2>
    <div class="note">Leave the gates on. A fully autonomous channel publishing identical-format videos is the exact pattern that gets denied monetization.</div>
    ${['factualReview', 'mediaRights', 'humanSignoff'].map((k) => `
      <label class="gate"><input type="checkbox" data-setb="approvalGates.${k}" ${s.approvalGates[k] ? 'checked' : ''}/>
      <div><div class="g-title">${gateName(k)}</div></div></label>`).join('')}
    <div class="grid2" style="margin-top:14px">
      <div class="field"><label>Videos per week (publish less than the machine can)</label><input type="number" min="1" max="14" data-setn="publishCadence.perWeek" value="${s.publishCadence.perWeek}"/></div>
      <div class="field"><label>Best hour to publish (UTC)</label><input type="number" min="0" max="23" data-setn="schedule.bestHourUTC" value="${s.schedule.bestHourUTC}"/></div>
    </div>
    <label class="gate"><input type="checkbox" data-setb="syntheticDisclosureDefault" ${s.syntheticDisclosureDefault ? 'checked' : ''}/>
      <div><div class="g-title">Disclose synthetic media by default</div><div class="g-desc">Pre-checks the disclosure box at upload.</div></div></label>
    <div style="margin-top:12px"><button class="btn primary" data-act="save-settings">Save settings</button></div>
  </div>`;
}

function keyField(env, label, present, desc = '') {
  return `<div class="field"><label>${label} ${present ? '<span class="tag" style="color:var(--green)">connected</span>' : ''}</label>
    ${desc ? `<div class="desc">${desc}</div>` : ''}
    <input type="password" data-key="${env}" placeholder="${present ? '•••••••• (leave blank to keep)' : 'paste key…'}"/></div>`;
}

function gateName(k) { return { factualReview: 'Factual review', mediaRights: 'Media-rights confirmation', humanSignoff: 'Human sign-off' }[k]; }
function voiceName(v) { return { elevenlabs: 'ElevenLabs', say: 'free system voice', mock: 'mock (no audio)' }[v] || 'free system voice'; }

// ---- Video detail modal ------------------------------------------------------
let MODAL_TAB = 'script';
async function openVideo(id) {
  try {
    const v = await api(`/api/videos/${id}`);
    showModal(v);
  } catch (e) { toast(e.message, 'error'); }
}

function showModal(v) {
  MODAL_TAB = v.script ? 'script' : 'overview';
  $('#modal').dataset.vid = v.id;
  window._modalVideo = v;
  renderModal();
  $('#modalBackdrop').hidden = false;
}

function renderModal() {
  const v = window._modalVideo;
  if (!v) return;
  const tabs = [
    ['overview', 'Overview'],
    v.script && ['script', 'Script'],
    v.thumbnails?.length && ['thumbs', 'Thumbnails'],
    v.seo && ['seo', 'SEO'],
    v.production && ['production', 'Production'],
    v.publish && ['publish', 'Publish'],
    v.analytics && ['analytics', 'Analytics'],
  ].filter(Boolean);
  $('#modal').innerHTML = `
    <div class="m-head">
      <div>
        <div style="font-size:12px;color:var(--muted)">${v.topic.format} · ${v.id}</div>
        <h2 style="margin-top:4px">${esc(v.seo?.title || v.topic.title)}</h2>
      </div>
      <button class="close-x" data-close>×</button>
    </div>
    <div class="m-body">
      <div class="tab-row">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${MODAL_TAB === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div id="modalTab">${modalTab(v, MODAL_TAB)}</div>
    </div>`;
}

function modalTab(v, tab) {
  if (tab === 'script' && v.script) {
    const body = [v.script.hook, ...(v.script.sections || []).map((s) => `\n## ${s.heading}\n${s.body}`), `\n${v.script.cta}`].join('\n');
    const hl = esc(body).replace(/\[ADD YOUR OWN EXAMPLE HERE[^\]]*\]/g, (m) => `<span class="placeholder-hl">${m}</span>`);
    return `<div class="note">This is a draft. Rewrite the hook and fill the highlighted placeholders with something only you could say — the highest-leverage ten minutes in the pipeline.</div>
      <div class="script-box">${hl}</div>`;
  }
  if (tab === 'thumbs') {
    return `<p class="hint">A/B variants to test click-through. Check they match the content.</p>
      <div class="thumbs">${v.thumbnails.map((t) => `<div><img src="/media/${v.id}/${t.file}" alt="thumbnail ${t.variant}"/><div class="hint" style="margin-top:6px">Variant ${t.variant} · ${esc(t.concept)}</div></div>`).join('')}</div>`;
  }
  if (tab === 'seo' && v.seo) {
    return `<div class="kv"><span class="k">Title</span><span>${esc(v.seo.title)}</span></div>
      <div class="kv"><span class="k">Description</span><span style="white-space:pre-wrap">${esc(v.seo.description)}</span></div>
      <div style="margin:8px 0 4px;color:var(--muted)">Tags</div>
      <div class="tags-list">${(v.seo.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  }
  if (tab === 'production' && v.production) {
    return `<div class="kv">
        <span class="k">Duration</span><span>~${v.production.durationSec}s</span>
        <span class="k">Scenes</span><span>${v.production.scenes?.length || v.production.scenes}</span>
        <span class="k">Voiceover</span><span>${v.production.voiceover?.mock ? 'mock (script saved; add ElevenLabs for audio)' : 'synthesized'}</span>
        <span class="k">Status</span><span>${v.production.status}</span>
      </div>
      <div class="note">The final video needs a human viewing before it clears the gate. Assets and a build manifest are ready in <code>data/media/${v.id}/</code>.</div>`;
  }
  if (tab === 'publish' && v.publish) {
    return `<div class="kv">
      <span class="k">Status</span><span>${v.publish.mock ? 'mock (not really uploaded)' : 'uploaded'}</span>
      <span class="k">Scheduled for</span><span>${fmtDate(v.publish.scheduledFor)}</span>
      <span class="k">URL</span><span><a href="${v.publish.url}" target="_blank" rel="noopener">${v.publish.url}</a></span>
      <span class="k">Playlist</span><span>${esc(v.publish.playlist)}</span>
      <span class="k">Synthetic disclosed</span><span>${v.publish.disclosedSynthetic ? 'yes' : 'no'}</span>
    </div>`;
  }
  if (tab === 'analytics' && v.analytics) {
    return `<div class="stat-grid">
      ${kpi(fmtNum(v.analytics.views), 'Views')}${kpi(fmtNum(v.analytics.likes), 'Likes')}
      ${kpi((v.analytics.ctr ?? '—') + '%', 'CTR')}${kpi((v.analytics.avgViewPct ?? '—') + '%', 'Retention')}
    </div><p class="hint" style="margin-top:10px">Source: ${v.analytics.source}</p>`;
  }
  // overview
  return `<div class="kv">
    <span class="k">Stage</span><span>${stageLabel(v)}</span>
    <span class="k">Angle</span><span>${esc(v.topic.angle)}</span>
    <span class="k">Rationale</span><span>${esc(v.topic.rationale || '')}</span>
    <span class="k">Approval</span><span>${v.approval?.decision || 'pending'}</span>
  </div>
  ${v.stageNote ? `<div class="note">${esc(v.stageNote)}</div>` : ''}
  <h3 style="margin:14px 0 6px;font-size:13px">Agent log</h3>
  <div id="logFeed">${(v.log || []).slice().reverse().map((e) => `<div class="log-line" style="grid-template-columns:70px 1fr"><span class="ts">${new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span><span class="lv-${e.level}">${esc(e.message)}</span></div>`).join('') || '<span class="hint">no log</span>'}</div>`;
}

function closeModal() { $('#modalBackdrop').hidden = true; window._modalVideo = null; }

// ---- events ------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-act],[data-open],[data-close],[data-tab]');
  if (!t) return;

  if (t.dataset.view) { VIEW = t.dataset.view; render(); return; }
  if (t.dataset.close !== undefined) { closeModal(); return; }
  if (t.dataset.open) { openVideo(t.dataset.open); return; }
  if (t.dataset.tab) { MODAL_TAB = t.dataset.tab; renderModal(); return; }

  const a = t.dataset.act;
  const id = t.dataset.id;
  if (a === 'strategy') return act('strategy', () => api('/api/strategy/run', { count: 6 }), 'Strategy agent proposed new topics');
  if (a === 'oneclick') return act('oneclick', () => api('/api/pipeline/oneclick'), 'Ran a topic through to the approval gate');
  if (a === 'analytics') return act('analytics', () => api('/api/analytics/run'), 'Analytics updated and fed back to strategy');
  if (a === 'create-video') return act('create-' + id, async () => { await api(`/api/topics/${id}/create-video`); const r = await api(`/api/state`); const v = r.videos.find((x) => x.topic.id === id); if (v) await api(`/api/videos/${v.id}/run`); }, 'Video ran through to the approval gate');
  if (a === 'approve') return doApprove(id);
  if (a === 'reject') return doReject(id);
  if (a === 'save-settings') return saveSettings();
  if (a === 'save-keys') return saveKeys();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

function doApprove(id) {
  const card = $(`[data-approve="${id}"]`);
  const decision = { notes: $(`[data-notes="${id}"]`)?.value || '' };
  $$('[data-gate]', card).forEach((cb) => {
    const [, key] = cb.dataset.gate.split(':');
    decision[key] = cb.checked;
  });
  return act('approve-' + id, () => api(`/api/videos/${id}/approve`, decision), 'Approved & scheduled');
}

function doReject(id) {
  const notes = $(`[data-notes="${id}"]`)?.value || '';
  return act('reject-' + id, () => api(`/api/videos/${id}/reject`, { notes }), 'Video rejected');
}

function saveSettings() {
  const body = {};
  $$('[data-set]').forEach((el) => setPath(body, el.dataset.set, el.value));
  $$('[data-setb]').forEach((el) => setPath(body, el.dataset.setb, el.checked));
  $$('[data-setn]').forEach((el) => setPath(body, el.dataset.setn, Number(el.value)));
  return act('save-settings', () => api('/api/settings', body), 'Settings saved');
}

function saveKeys() {
  const body = {};
  $$('[data-key]').forEach((el) => { if (el.value.trim()) body[el.dataset.key] = el.value.trim(); });
  if (!Object.keys(body).length) return toast('Nothing to save', '');
  return act('save-keys', () => api('/api/keys', body), 'Saved. Provider status updated.');
}

function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ||= {});
  o[parts[parts.length - 1]] = val;
}

// ---- boot --------------------------------------------------------------------
refresh();
// Background refresh. Never interrupt the user: skip while a modal is open or
// while they're focused in a field, and preserve in-progress edits otherwise.
setInterval(async () => {
  if (!$('#modalBackdrop').hidden) return;
  const el = document.activeElement;
  if (el && el.matches && el.matches('input, textarea, select')) return;
  try { STATE = await api('/api/state'); render({ preserve: true }); } catch (e) { /* server maybe restarting */ }
}, 2500);
