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
  store.ts      Where state lives -- FileStore (local) or KvStore (hosted)
  engine.ts     What generates updates -- ClaudeCliEngine or ApiEngine
  render.ts     Terminal output
  cli.ts        Local CLI entry point
  routes.ts     REST API over the model
  index.ts      Worker entry point
  types.ts      State, basins, updates
cli/attractor   Zero-dependency bash viewer for a hosted deployment
web/            React canvas view with force-directed layout
docs/model.md   How the model works
```

`src/model.ts` is the part worth reading. `store.ts` and `engine.ts` are the two
seams that let the same model run locally or hosted; everything else is
plumbing.

---

## Two ways to run it

| Mode | Engine | State | You need |
|---|---|---|---|
| **Local** | `claude -p` | `~/.attractor/state.json` | Claude Code |
| **Hosted** | Anthropic API | Cloudflare KV | A Worker + an API key |

Local is the one to try first. It needs no API key and no Cloudflare account,
because `claude -p` runs against whatever login Claude Code already has — a
Pro, Team or Max subscription works. Hosted is what you deploy when you want
the attractor reachable from anything, not just the machine it lives on.

Both share `src/model.ts`. The safeguards in `applyUpdate` — the delta clamps,
the weight bounds, the decay — apply identically either way, because the model
is pure functions over plain state and doesn't know where that state lives.

---

## Local mode

```bash
npm install && npm run build

cat > basins.json <<'EOF'
[
  { "label": "Research methodology", "description": "Study design, controls, what makes a result trustworthy", "keywords": ["assay", "controls"] },
  { "label": "Systems design", "description": "Where state lives and how parts connect", "keywords": ["api", "storage"] }
]
EOF

./dist/attractor.mjs seed basins.json
./dist/attractor.mjs ingest conversation.txt   # or - for stdin
./dist/attractor.mjs ingest --session          # your latest Claude Code session
./dist/attractor.mjs sessions                  # list Claude Code sessions
./dist/attractor.mjs                           # show current state
./dist/attractor.mjs history                   # weight evolution
./dist/attractor.mjs context                   # the system-prompt block
```

`ingest --session` reads Claude Code's own transcripts from
`~/.claude/projects/`, so you can feed it real conversations without exporting
anything. `--session <filter>` narrows to a project directory; `sessions` lists
what's there.

### Comparing models

```bash
./dist/attractor.mjs compare conversation.txt
```

Runs the same conversation through several models and shows what each *would*
do — summary, vibes, basin deltas, proposed connections, resulting entropy.
Nothing is saved. Set `ATTRACTOR_COMPARE_MODELS` to a comma-separated list to
choose them; it defaults to Haiku and Opus.

This is the useful side effect of having an engine seam: because the model is a
parameter and the prompt is built in one place, "do different models read a
conversation differently?" becomes a measurable question rather than a vague
one. The readout is basin deltas, not prose.

### Choosing models

Two jobs, two models. Generating an update needs judgement about what a
conversation meant; summarizing a transcript doesn't, so that goes somewhere
cheap. Override either:

```bash
ATTRACTOR_SUMMARY_MODEL=claude-haiku-4-5-20251001 \
ATTRACTOR_UPDATE_MODEL=claude-opus-5 \
  ./dist/attractor.mjs ingest --session
```

The hosted Worker reads the same two names from `wrangler.toml`. Defaults live
in one place, `DEFAULT_MODELS` in `src/engine.ts`.

---

## How this uses Claude Code

Local mode shells out to the `claude` binary on your machine, so **it runs
under your own Claude Code login** — your subscription, your quota, your
machine. Nothing is proxied through anyone else's account, and there's no
shared credential.

Two consequences worth knowing before you run it on a large history:

- **It bills against your subscription quota**, not per-token API billing.
- **It's slower than the API** — a process start per call, and `ingest` makes
  two calls. Fine for a handful of conversations, wrong for hundreds. Use
  hosted mode with an API key if you're batching.

### Making `claude -p` behave like an API call

This turned out to be the subtle part, and it's worth spelling out if you're
building anything similar.

`claude -p` is not a completion endpoint. It's an agent. Left alone it carries
Claude Code's own system prompt, the built-in tools, your working directory,
any MCP servers, and your `CLAUDE.md`. Given a summarization prompt inside a
code repository, a capable model may reasonably decide the helpful thing is to
go *read the repository* — which is good agent behaviour and a broken
inference call. A weaker model just answers, so this fails only when you reach
for a better one.

Four flags strip the environment back to something reproducible:

```bash
claude -p \
  --model <id> \
  --tools ""              # no tools, so text is the only possible output
  --strict-mcp-config     # no MCP servers
  --setting-sources ""    # no CLAUDE.md, user or project
  --system-prompt "..."   # replace the coding-assistant framing
```

The `--setting-sources` one matters most for a tool you distribute. Without
it, whoever runs this gets summaries shaped by *their* `CLAUDE.md` — so the
same conversation produces different attractor updates on different machines.

`ingest` makes two `claude -p` calls: one to summarize the transcript, one to
generate the update. Expect a few seconds each — the CLI starts a process per
call, which is fine for a handful of conversations and wrong for hundreds.

Set `ATTRACTOR_STATE` to put the file somewhere other than `~/.attractor/`, and
`ATTRACTOR_SUBJECT` to say whose engagement it models.

---

## Hosted mode

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
