#!/usr/bin/env node
// Seeds a realistic demo state so the dashboard has something to show on first
// open: fresh topics, a couple of videos waiting at the approval gate, and one
// approved + scheduled video with analytics. Safe to run repeatedly.
//   npm run seed

import * as store from '../src/store.js';
import * as orch from '../src/orchestrator.js';

async function main() {
  store.update((s) => {
    if (!s.settings.channel.niche) {
      s.settings.channel.name = 'Demo Channel';
      s.settings.channel.niche = 'home espresso';
      s.settings.channel.voice = 'blunt, first-hand, no fluff';
    }
  });

  console.log('› running content strategy…');
  const topics = await orch.runStrategy(6);

  console.log('› sending 3 topics through to the approval gate…');
  const made = [];
  for (const t of topics.slice(0, 3)) {
    const v = orch.createVideoFromTopic(t.id);
    await orch.runVideoToGate(v.id);
    made.push(v.id);
  }

  console.log('› approving 1 (all gates confirmed) so there is a scheduled video + analytics…');
  await orch.approveVideo(made[0], {
    factualReview: true, mediaRights: true, humanSignoff: true, syntheticDisclosure: true,
    notes: 'Rewrote the hook, added my own dial-in numbers from a real machine.',
    by: 'seed',
  });

  store.flush();
  console.log('\n✓ Seeded. Start the server:  npm start  →  http://localhost:3456');
  console.log('  2 videos are waiting in the Approvals tab; 1 is scheduled.');
  process.exit(0);
}

main().catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
