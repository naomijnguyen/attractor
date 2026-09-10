# Attractor

> A persistent topological memory structure that tracks how modes of engagement evolve across conversations.

Language models don't remember across sessions. But when the same person talks to them over months, something converges anyway — the interaction develops a shape. Attractor is an attempt to model that shape directly and feed it back in.

It represents areas of engagement as weighted **basins** — gravity wells that conversations fall into. After each conversation the basins shift: some gain weight, untouched ones drift toward dormancy, connections form where thinking moved between two modes. The resulting state is rendered into a text block and injected into the next conversation's system prompt.

Conversation → summary → attractor update → system prompt → conversation.

---

## The idea

A basin is an **energy state, not a topic**. "Research methodology" and "creative writing" aren't just subjects — they're different computational postures, different patterns of attention. Conversations don't *belong* to basins; they pull basins toward them and get pulled in return.

Three properties fall out of that:

- **It drifts, it doesn't swing.** Weight deltas are clamped to ±0.3 and the update prompt asks for ±0.1. The system is meant to find equilibrium, not react.
- **Nothing is deleted.** Untouched basins decay toward 0.3 and go dormant. A dormant basin can reactivate.
- **Structure is emergent.** Basins connect when a conversation genuinely bridges two modes. New basins appear only when a pattern repeatedly fits nowhere.

Two metrics summarize the state: **entropy** (normalized Shannon entropy over basin weights — 0 means one basin dominates, 1 means attention is evenly spread) and **trajectory** (`stable` / `converging` / `diverging` / `restructuring`, from recent weight deltas).

Full mechanics — state shape, update cycle, every tuning constant — are in [`docs/model.md`](docs/model.md).

---

## Watch it move

No API key needed — `npm run example` seeds three basins and applies three
updates by hand:

```
seed          Research  50%  Systems   50%  Creative  50%   H=1.000  stable
architecture  Research  49%  Systems   70%  Creative  49%   H=0.986  converging
arch + method Research  59%  Systems   85%  Creative  48%   H=0.974  converging
architecture  Research  58%  Systems  100%  Creative  47%   H=0.951  converging

Untouched basin decayed 0.500 -> 0.471 (drifting toward 0.300, never deleted)
```

Three things to notice. `Systems` climbs to saturation while `Creative`, never
mentioned, slides quietly toward dormancy. A connection forms on the second
update, when one conversation touched both basins. And entropy barely moves —
1.000 to 0.951 — even as one basin goes from half to full weight, because it is
computed over weights normalized by their sum. It's a good measure of how
evenly attention is spread and a poor one for how focused someone is. Worth
knowing before you read anything into the number.

---

## Layout

```
src/
  model.ts      The attractor itself: entropy, trajectory, decay, update application
  routes.ts     REST API over the model
  index.ts      Worker entry point
  types.ts      State, basins, updates
  utils.ts      HTTP helpers
cli/attractor   Terminal visualization (bash + python3)
web/            React canvas view with force-directed layout
docs/model.md   How the model works
```

`src/model.ts` is the part worth reading. Everything else is plumbing around it.

---

## Setup

Requires a Cloudflare account and an Anthropic API key.

```bash
npm install
wrangler kv namespace create MODEL_KV     # put the id in wrangler.toml
wrangler queues create attractor-jobs
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ATTRACTOR_TOKEN     # every route requires this
wrangler deploy
```

Set `ATTRACTOR_SUBJECT` in `wrangler.toml` to whoever the attractor models —
it appears in the update prompt and in the injected context block.

Then seed it with your starting basins:

```bash
curl -X POST "$API/api/attractor/seed" \
  -H "Authorization: Bearer $ATTRACTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"basins":[
        {"label":"Research methodology","description":"Study design, controls, what makes a result trustworthy","keywords":["assay","controls","replication"]},
        {"label":"Systems architecture","description":"How components fit together and where state lives","keywords":["api","storage","interfaces"]}
      ]}'
```

All basins start at weight 0.5 and entropy 1.0 — nothing is favoured until conversations arrive.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/attractor` | Current state |
| `GET` | `/api/attractor/history` | Last 10 snapshots |
| `POST` | `/api/attractor/seed` | Initialize with basins (`force: true` to re-seed) |
| `POST` | `/api/attractor/basins` | Add a basin |
| `DELETE` | `/api/attractor/basins/:id` | Remove a basin and clean up its connections |
| `POST` | `/api/attractor/ingest` | Feed in a pre-written summary |
| `POST` | `/api/attractor/ingest-transcript` | Feed in raw messages (summarized via Haiku first) |
| `POST` | `/api/attractor/trigger` | Enqueue a background update for a stored conversation |

`ingest-transcript` is what a Claude Code `SessionEnd` hook posts to.

---

## CLI

```bash
export ATTRACTOR_API_URL="https://your-worker.workers.dev"
echo "$YOUR_TOKEN" > ~/.claude/attractor-token

cli/attractor            # current state: weights, bars, trends, keywords
cli/attractor history    # weight evolution table over time
```

```
  Attractor
  ========================================
  Phase 1 | Entropy: 0.978 | CONVERGING
  Updates: 6 | Dominant: context-architecture

  Context architecture 100.0% ^  [##############################]  (5 convos)
                       -> systems-design, immunology
  Systems design        80.5% ^^ [########################......]  (3 convos)
                       -> context-architecture
  Immunology            77.8% ~  [#######################.......]  (3 convos)
                       -> context-architecture, creative-writing
  Creative writing      58.8% ~  [#################.............]  (1 convo)
                       -> immunology
  Bench assays          44.7% ~  [#############.................]  (0 convos)

  Emerging patterns:
    * emergent persistence
```

`attractor history` shows the same weights as a table over time:

```
Timestamp          Context Architec.        Immunology    Systems Design  Creative Writing
------------------------------------------------------------------------------------------
2026-06-06 09:00    68% #######...    49% #####.....    62% ######....    49% #####.....
2026-06-14 09:00    93% #########.    62% ######....    70% #######...    47% #####.....
2026-06-22 09:00    96% ##########    80% ########..    66% #######...    60% ######....
2026-06-26 09:00   100% ##########    78% ########..    80% ########..    59% ######....
```

---

## Web view

`web/AttractorView.jsx` renders the attractor as a force-directed graph on canvas — basins sized and coloured by weight, edges for connections, sparklines for trajectory. Drop it into any React app; `web/useApi.js` is a standalone client for the two GET endpoints.

---

## Status

Working, deployed, and in daily use. Known rough edges:

- `computeTrajectory` reads only the last step of each trajectory, so it describes the most recent update rather than a longer-run trend.
- Because untouched basins decay toward 0.3 rather than toward zero, a long stretch of narrow conversations pulls the *unrelated* basins together at 0.3 and raises entropy. That's intended (dormancy, not deletion) but it means entropy answers "how evenly is attention spread" and not "how focused is this person."
- The web view recomputes the force simulation from scratch on resize.

---

## License

MIT — see [LICENSE](LICENSE).

**Jennifer Naomi Nguyen**, with **Claude** as contributor.
