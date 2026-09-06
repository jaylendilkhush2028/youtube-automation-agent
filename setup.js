#!/usr/bin/env node
// Setup wizard. Walks you through the AI provider key and channel connection,
// then writes .env. Everything is optional — skip a prompt to run in demo mode.
//   Usage: npm run setup

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { saveEnv, loadEnv, integrationStatus } from './src/config.js';
import * as store from './src/store.js';

const rl = readline.createInterface({ input, output });
const ask = async (q, fallback = '') => (await rl.question(q)).trim() || fallback;

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m` };

async function main() {
  loadEnv();
  console.log(`\n${c.b('▶  YouTube Automation Agent — setup')}`);
  console.log(c.dim('   Press Enter to skip any step. You can run the whole thing with no keys.\n'));

  const env = {};

  // 1. AI provider
  console.log(c.b('1) AI provider'));
  console.log(c.dim('   gemini has a free tier and is the easiest start. Options: gemini | openai | claude | openrouter | auto'));
  const provider = await ask(`   Preferred provider [${c.g('auto')}]: `, 'auto');
  env.AI_PROVIDER = provider;
  const keyPrompts = {
    gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', claude: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY',
  };
  if (keyPrompts[provider]) {
    const key = await ask(`   ${provider} API key: `);
    if (key) env[keyPrompts[provider]] = key;
  } else {
    for (const [name, envKey] of Object.entries(keyPrompts)) {
      const key = await ask(`   ${name} API key (optional): `);
      if (key) env[envKey] = key;
    }
  }

  // 2. YouTube
  console.log(`\n${c.b('2) YouTube')}`);
  console.log(c.dim('   Data API key (read-only) powers trend & competitor research. Free from Google Cloud Console.'));
  const ytKey = await ask('   YOUTUBE_API_KEY (optional): ');
  if (ytKey) env.YOUTUBE_API_KEY = ytKey;

  console.log(c.dim('\n   Uploading needs OAuth. Create an OAuth client (type: Desktop) in Google Cloud Console,'));
  console.log(c.dim('   enable "YouTube Data API v3", then paste the credentials + a refresh token below.'));
  console.log(c.dim('   Leave blank to keep publishing in mock mode (recommended while learning).'));
  const cid = await ask('   YOUTUBE_CLIENT_ID (optional): ');
  if (cid) {
    env.YOUTUBE_CLIENT_ID = cid;
    env.YOUTUBE_CLIENT_SECRET = await ask('   YOUTUBE_CLIENT_SECRET: ');
    env.YOUTUBE_REFRESH_TOKEN = await ask('   YOUTUBE_REFRESH_TOKEN: ');
  }

  // 3. Voice
  console.log(`\n${c.b('3) Voiceover (optional)')}`);
  const el = await ask('   ELEVENLABS_API_KEY (optional, better TTS): ');
  if (el) env.ELEVENLABS_API_KEY = el;

  // 4. Channel
  console.log(`\n${c.b('4) Your channel')}`);
  const name = await ask('   Channel name: ');
  const niche = await ask('   Niche (e.g. "home espresso", "indie game dev"): ');
  const voice = await ask('   Your voice / POV (e.g. "blunt, first-hand, no fluff"): ');

  // Persist
  if (Object.keys(env).length) saveEnv(env);
  store.update((s) => {
    if (name) s.settings.channel.name = name;
    if (niche) s.settings.channel.niche = niche;
    if (voice) s.settings.channel.voice = voice;
  });
  store.flush();

  const int = integrationStatus();
  console.log(`\n${c.g('✓ Setup saved to .env and data/state.json')}`);
  console.log(`  AI provider:     ${int.textProvider === 'mock' ? c.y('mock (demo mode)') : c.g(int.textProvider)}`);
  console.log(`  YouTube upload:  ${int.youtube ? c.g('connected') : c.y('mock')}`);
  console.log(`  YouTube research:${int.youtubeReadOnly ? c.g(' live') : c.y(' mock')}`);
  console.log(`  Voiceover:       ${int.elevenlabs ? c.g('ElevenLabs') : c.y('mock')}`);
  console.log(`\n  Approval gates are ${c.g('ON')} by default. ${c.dim('Leave them on.')}`);
  console.log(`\n  Next: ${c.b('npm start')}  →  ${c.b('http://localhost:3456')}\n`);
  rl.close();
}

main().catch((e) => { console.error(c.r('setup failed: ' + e.message)); rl.close(); process.exit(1); });
