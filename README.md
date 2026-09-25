<!--
Title        Attractor — persistent topological memory across conversations
Purpose      The introduction: what the Attractor is, the idea behind it, the math, and how to run it locally or hosted. Start here.
Author       Jennifer Naomi Nguyen
Canonical    ~/Bootwitch/Projects/attractor — authoritative. A docs-only copy previously lived at ~/Projects/Anthropic/interpretability/attractor; it was superseded and did not move to the current project home.
Updated      2026-09-16
Dependencies Node 18+. Local mode needs the `claude` binary on PATH; hosted mode needs a Cloudflare account (KV + Queues) and an Anthropic API key.
-->

# Attractor

> A persistent topological memory structure that tracks how modes of engagement evolve across conversations.

Language models don't remember across sessions. But when the same person talks to them over months, something converges anyway — the interaction develops a shape. Attractor is an attempt to model that shape directly and feed it back in.

It represents areas of engagement as weighted **basins** — gravity wells that conversations fall into. After each conversation the basins shift: some gain weight, untouched ones drift toward dormancy, connections form where thinking moved between two modes. The resulting state is rendered into a text block and injected into the next conversation's system prompt.

Conversation → summary → attractor update → system prompt → conversation.

---

## Documentation

| Document | What it covers |
|---|---|
| **README.md** (this file) | What it is, the idea, the math, how to run it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, the two seams, data flow, why it is shaped this way |
| [TECHNICAL.md](TECHNICAL.md) | Install, configuration, every endpoint and command, deploy, known gotchas |
| [docs/model.md](docs/model.md) | Full mechanics: state shape, update cycle, every tuning constant |
| [RESEARCH.md](RESEARCH.md) | The research framing and open questions |
| [DESIGN-NOTES.md](DESIGN-NOTES.md) | Decisions taken along the way |

---

## The idea

A basin is an **energy state, not a topic**. "Research methodology" and "creative writing" aren't just subjects — they're different computational postures, different patterns of attention. Conversations don't *belong* to basins; they pull basins toward them and get pulled in return.

Three properties fall out of that:

- **It drifts, it doesn't swing.** Weight deltas are clamped to ±0.3 and the update prompt asks for ±0.1. The system is meant to find equilibrium, not react.
- **Nothing is deleted.** Untouched basins decay toward 0.3 and go dormant. A dormant basin can reactivate.
- **Structure is emergent.** Basins connect when a conversation genuinely bridges two modes. New basins appear only when a pattern repeatedly fits nowhere.

Two metrics summarize the state: **entropy** (normalized Shannon entropy over basin weights — 0 means one basin dominates, 1 means attention is evenly spread) and **trajectory** (`stable` / `converging` / `diverging` / `restructuring`, from recent weight deltas).

## The math

Every rule, in one place. All of it is in `src/model.ts`.

### Weights

A basin's weight is its activity. Touched basins move by a model-proposed
delta; untouched ones decay on their own.

```
touched:    w ← clamp(w + Δ,  0.05,  1.0)        Δ ∈ [−0.3, +0.3]
untouched:  w ← w + (0.3 − w) × 0.05
```

Seeded basins start at **0.5**; basins that emerge later start at **0.4**, so
they have to earn their place. The floor is **0.05**, not 0 — a basin goes
dormant, never away, and a dormant basin can reactivate.

The decay closes 5% of the gap to 0.3 per update, which is a half-life of
**≈13.5 updates**. That is the "drifts, doesn't swing" property, and it is the
one number to change if the attractor feels too sticky or too twitchy.

Deltas are clamped to ±0.3 regardless of what the model proposes; the prompt
asks for ±0.1. Measured across 40 logged updates, Haiku proposed a mean of
**+0.126** and Opus **+0.083** — so model choice changes how fast the system
converges, not just what it says.

### Entropy

Normalized Shannon entropy over the weights, treated as a distribution:

```
pᵢ = wᵢ / Σw
H  = −Σ pᵢ log₂ pᵢ
H_norm = H / log₂(n)          n = basin count
```

0 means one basin holds everything; 1 means weight is spread evenly. Edge
cases: `Σw = 0` returns 1, and a single basin returns 0.

**Read this carefully.** Because weights are normalised by their sum, entropy
measures how evenly attention is *spread*, not how *focused* someone is. If
every basin rises together the proportions barely move. Observed: entropy went
1.000 → 0.986 across seven updates while the dominant basin went 50% → 100%.

### Trajectory

From the most recent step of each basin, not a longer trend:

```
cᵢ = |trajectoryᵢ[-1] − trajectoryᵢ[-2]|
c̄  = mean(cᵢ)

converging     top basin grew  and  c̄ < 0.10
restructuring  c̄ > 0.15
diverging      c̄ > 0.05
stable         otherwise
```

### Keywords

Capped at **10** per basin, deduplicated case-insensitively. On filling the
slots for the **2nd** time, the basin is consolidated: its keywords are
rewritten as **≤5** more general ones, `consolidationCount` increments, and the
counter resets.

This exists because the per-conversation update never prunes. Across 40 logged
updates it proposed **115 keyword additions and 0 removals** — abstraction does
not emerge from asking a local question, so it gets its own call.

Consolidation is capped at **3 times per basin**. Uncapped it becomes a ratchet:
the update prompt shows the model each basin's current keywords, so every ingest
imitates whatever register the last consolidation set, and the next consolidation
raises it again. Measured across 35 logged CLI runs with the model held constant
at Opus 5, mean keyword length climbed from **2.0 to 3.6 words** — eventually
every basin is described in language too general to tell it from any other. The
hosted Worker never consolidates at all, which is why its keywords stay concrete.

**Seed keywords set the register.** Because the model imitates the vocabulary it
is shown, whatever you seed with anchors the whole history — and with
consolidation capped, the system can only travel a bounded distance from it.
Seeding `["assay", "api"]` produces a permanently more concrete attractor than
seeding `["measurement-design", "trust-boundary-placement"]`. Write seeds at the
level of abstraction you want the basins to still have after a hundred
conversations.

### Other bounds

| | |
|---|---|
| Trajectory history | 20 points per basin |
| Snapshot history | 10 states |
| Active threshold | weight > 0.4 appears in the injected context |
| Emerging patterns | 5 carried forward |

---

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
  { "label": "Research methodology", "description": "Study design, controls, what makes a result trustworthy", "keywords": ["measurement-design", "control-and-comparison"] },
  { "label": "Systems design", "description": "Where state lives and how parts connect", "keywords": ["where-state-lives", "trust-boundary-placement"] }
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

### What comparing actually shows

Legs are `engine:model` pairs, so you can vary the model, the transport, or
both. A bare model name means the local CLI.

```bash
ATTRACTOR_COMPARE_MODELS="cli:claude-haiku-4-5-20251001,cli:claude-opus-5,api:claude-opus-5" \
  ./dist/attractor.mjs compare --session
```

Running the same model through both `cli:` and `api:` is the control: identical
prompt, different transport, so they should agree. If they don't, the two
engines aren't sending equivalent requests.

Making that true took more than sharing the prompt text. Both engines route
through one primitive, `Engine.call(system, user, model, maxTokens)`, because
they had previously placed the same text in *different roles* — the API sent
the attractor prompt as the system prompt, while the CLI concatenated it into
the user turn. A comparison run at that point would have measured the
asymmetry, not the transport. One known difference remains: `claude -p` has no
max-tokens flag, so that argument is ignored on the CLI side.

Running each model twice separates run-to-run noise from a real difference.
One conversation, two runs per model:

```
  basin                cli:haiku-4-5 cli:haiku-4-5    cli:opus-5    cli:opus-5
  ----------------------------------------------------------------------------
  Context architecture         +0.05         +0.10         +0.05         +0.05
  Systems design               +0.15         +0.15         +0.09         +0.08
  ----------------------------------------------------------------------------
  connections                      0             0             0             0
  emerging                         0             0             3             4
```

Two differences survive that control, and both are structural rather than
stylistic.

**Haiku moves the attractor about twice as fast.** The prompt asks both models
to be conservative and reserve large deltas for conversations deeply about a
topic. Opus does that; Haiku treats the ceiling as the target. At +0.15 a basin
saturates in roughly four conversations, at +0.085 in seven — the same code
gives you a memory that settles at two different speeds.

**Haiku surfaces no emerging patterns; Opus surfaces three or four.** That one
has consequences, because `emerging_patterns` is how new basins are born. Under
Haiku the attractor can only redistribute weight among the basins you seeded.
Under Opus it stays open-ended.

Neither is wrong. They're different instruments, and which you want depends on
whether you're modelling a settled set of interests or looking for new ones.

One conversation and two runs each is an observation, not a result — but the
method is one command, so making it a result is cheap.

### The run log

Every update the attractor generates is appended to `~/.attractor/runs.jsonl`
— from `ingest` and from each `compare` leg, marked `applied` or `dry`.

```bash
./dist/attractor.mjs runs              # grouped by conversation
./dist/attractor.mjs runs <hash>       # one conversation
./dist/attractor.mjs runs opus         # filter by model
```

```
  3553445eb1f8  466 chars, 2 run(s)
  "User: I want the attractor to run without an API key so anyone with..."

    basin                      haiku-4-5          opus-5
    ----------------------------------------------------
    systems-design                 +0.15           +0.09
    context-architecture           +0.08           +0.06
    ----------------------------------------------------
    emerging                           1               4
    via                              cli             cli
    applied                          dry             dry
    when                      2026-09-11      2026-09-11
```

Runs are grouped by a hash of the transcript, and that join key is the whole
design. **Models change underneath you.** When one is updated, replaying a
conversation you already have runs for and reading down its row shows whether
its behaviour moved — something the attractor's own state can never tell you,
because state only records where it ended up, not what took it there.

`attractor history` now also records which model produced each step:

```
2026-09-11 02:35    67% #######...    87% #########.    opus-5
2026-09-11 02:35    65% #######...   100% ##########    haiku-4-5
```

So if the attractor's behaviour shifts, you can see whether the conversations
changed or the model did.

It's plain JSON Lines with no schema magic, so you don't need this tool to
analyse it:

```bash
python3 -c "
import json, collections
agg = collections.defaultdict(list)
for line in open('$HOME/.attractor/runs.jsonl'):
    r = json.loads(line)
    for u in r['update']['basin_updates']: agg[r['model']].append(u['weight_delta'])
for m, v in agg.items(): print(f'{m:<30} mean delta {sum(v)/len(v):+.3f} (n={len(v)})')
"
```

```
claude-haiku-4-5-20251001      mean delta +0.126 (n=5)
claude-opus-5                  mean delta +0.083 (n=4)
```

**A privacy note.** The log stores conversation *summaries* and a 120-character
preview — not full transcripts, but still content. It lives in `~/.attractor/`
outside any repo, and `.attractor/` and `*.jsonl` are gitignored here. Don't
commit it, and think before sharing it.

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
        {"label":"Research methodology","description":"Study design, controls, what makes a result trustworthy","keywords":["measurement-design","control-and-comparison","replication-as-evidence"]},
        {"label":"Systems architecture","description":"How components fit together and where state lives","keywords":["where-state-lives","trust-boundary-placement","interface-contracts"]}
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

## Tech stack and AI collaboration

The core is TypeScript on Node.js. Local mode calls the Claude Code CLI; hosted mode runs on Cloudflare Workers with KV and Queues and calls the Anthropic API. The repository also includes a zero-dependency Bash client and a React canvas visualization.

Since 2025, I’ve been making software in active collaboration with AI coding systems across providers, and I want to do more of it. I built Attractor with Claude and Claude Code from Anthropic, then used its model-comparison workflow to study how different Claude models change the system’s behavior.

## Status

Working, deployed, and in daily use. Known rough edges:

- `computeTrajectory` reads only the last step of each trajectory, so it describes the most recent update rather than a longer-run trend.
- Because untouched basins decay toward 0.3 rather than toward zero, a long stretch of narrow conversations pulls the *unrelated* basins together at 0.3 and raises entropy. That's intended (dormancy, not deletion) but it means entropy answers "how evenly is attention spread" and not "how focused is this person."
- The web view recomputes the force simulation from scratch on resize.

---

## License

MIT — see [LICENSE](LICENSE).

