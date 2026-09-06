# YouTube Automation Agent

Seven AI agents that run the boring 90% of a YouTube channel — trend research,
scripting drafts, thumbnails, SEO, production assembly, scheduling, and analytics —
chained together with a feedback loop and **human approval gates you keep on**.

Built from the guide *"How to Automate Your Entire YouTube Channel."* The whole
point, and the thing that decides whether the channel monetizes, is in the guide's
own words:

> The agents handle the 90 percent. The 10 percent you keep is what makes it a
> channel instead of a content farm.

So this is a **production crew, not a replacement for you**. Two agents — the script
and the final video — are wired to stop and wait for you every time. Nothing
publishes until you clear three gates by hand.

---

## The 7 agents

| # | Agent | Supervision | What it does |
|---|-------|-------------|--------------|
| 1 | Content Strategy | runs itself | Pulls trend data, checks competitors, proposes topics, plans the calendar. Reads the analytics feedback. |
| 2 | **Script Writer** | **you, every time** | Drafts a full script (hook, story, CTA) per format. You rewrite the hook and add something only you know. |
| 3 | Thumbnail Designer | runs itself | Renders A/B thumbnail variants to test click-through. |
| 4 | SEO Optimizer | runs itself | Keyword research + title, description, tags. |
| 5 | **Production Management** | **you, every time** | TTS voiceover, shot list, captions, build manifest for the final cut. |
| 6 | Publishing & Scheduling | runs itself | Picks the slot and uploads — **only after every gate passes** (enforced in code). |
| 7 | Analytics | runs itself | Measures performance and feeds lessons back into strategy — the loop. |

Agent 7 loops back into Agent 1. *A pipeline that produces videos is a factory. A
pipeline that learns which of its videos worked is a system.*

---

## Quick start

```bash
npm install
npm run setup     # optional — walks you through keys + channel. Skip to run in demo mode.
npm run seed      # optional — fills the dashboard with example videos to click around
npm start         # → http://localhost:3456
```

**It runs with zero API keys.** In demo mode every agent uses a built-in offline
generator, so you can see the entire pipeline — topics, scripts, thumbnails, SEO,
scheduling, analytics, the feedback loop — before spending a cent. Add one key in
the **Setup** tab (or via `npm run setup`) to make it real.

### What you need to go live
- **Node.js 18+** (uses built-in `fetch`).
- **One AI provider key** — Gemini (free tier), OpenAI, Claude, or OpenRouter.
- **YouTube Data API key** (free, Google Cloud Console) for real trend research.
- **YouTube OAuth** (Desktop client + refresh token) only when you actually want to
  upload. Left blank, publishing stays in mock mode.
- **ElevenLabs key** — optional, for a real voiceover instead of a saved script.

---

## The workflow that actually works

1. **Run the strategy agent weekly and read the topic list.** Kill anything you have
   no genuine angle on — a topic you can't add to is a video that won't monetize.
2. **Let the script agent draft, then rewrite the hook** and add at least one thing
   from your own experience. This is the highest-leverage ten minutes in the pipeline.
3. **Let production, thumbnails, and SEO run mostly unsupervised** — check the output,
   not the process.
4. **Review before publishing, every time,** with the gates on. Watch the finished cut
   once at speed. Check the voiceover didn't mangle anything, the thumbnail matches
   the content, and no claim in the script is invented.
5. **Read the analytics report monthly and act on it.** The loop only compounds if you
   let it change what you make.
6. **Publish less than the system technically can.** Two genuinely good videos a week
   beats fourteen interchangeable ones.

### Disclose synthetic content
YouTube requires you to label realistic synthetic media in the upload flow. The
publishing agent sets that flag, and the SEO agent adds a disclosure line to the
description. Leave it on — it costs you nothing.

---

## How it's built

- **No framework magic.** One dependency (`express`). Plain ES modules, a JSON file
  store you can open and read (`data/state.json`), and provider adapters behind a
  single `generateText` / `generateJSON` interface.
- **The approval gate is code, not policy.** `publishingScheduling.js` throws if a
  video isn't approved with every enabled gate confirmed. The orchestrator never
  auto-approves.
- **Everything degrades to mock.** Missing key → offline generator. Missing OAuth →
  the upload is simulated and clearly labeled `[mock]`.

```
src/
  orchestrator.js        # runs the chain, enforces the gate
  agents/                # the 7 agents (one file each)
  providers/             # gemini · openai · claude · openrouter (+ mock fallback)
  integrations/          # youtube · tts
  store.js  config.js  logger.js
server.js                # dashboard + API at :3456
public/                  # the dashboard (vanilla JS)
```

---

## Before you build a business on it

- This is an independent implementation of the guide's design, written from scratch.
  If you were sent to a specific repo, **check its LICENSE and maintainer before
  running anyone's code** — including forks.
- **Don't point it at an existing monetized channel while learning.** Test on a new
  channel, get the output to a standard you'd put your name on, then decide.
- **Check your API costs after the first week.** A system designed to run continuously
  finds the edge of a free tier faster than you expect.

MIT.
