---
Title        Attractor technical reference
Purpose      Operational reference — install, configuration, every endpoint and CLI command, deploy steps, and the known gotchas. Reach for this when running or deploying it.
Author       Jennifer Naomi Nguyen
Canonical    ~/Bootwitch/Projects/attractor/TECHNICAL.md — authoritative
Updated      2026-09-20
Dependencies Node 18+ (the CLI uses `node:crypto`, `node:fs/promises`, and a global `Response`). Local mode needs the `claude` binary on PATH. Hosted mode needs a Cloudflare account with KV + Queues, and an Anthropic API key.
---

# Technical reference

[README.md](README.md) is the introduction and [ARCHITECTURE.md](ARCHITECTURE.md)
explains the structure. This is the operational document: what to install, what
to set, what every endpoint does, and what is known to be broken.

The model's constants and formulas are not repeated here — they are in
[docs/model.md](docs/model.md) and in the README's "The math" section, which are
authoritative for those numbers.

---

## Requirements

| | |
|---|---|
| Node | 18 or newer |
| Local mode | the `claude` binary on PATH (Claude Code), signed in |
| Hosted mode | Cloudflare account (KV + Queues), Anthropic API key, `wrangler` |
| TypeScript | 5.7+ (dev only) |

Node 18 is the floor because the CLI relies on a global `Response` (used to read
stdin) alongside `node:crypto` and `node:fs/promises`.

Local mode bills against your **Claude Code subscription quota**, not
per-token API billing, because it drives the binary under your own login. It is
also slower — one process start per call, and `ingest` makes two calls. Fine for
a handful of conversations, wrong for hundreds; batch through hosted mode.

---

## Install

```bash
npm install
npm run build      # -> dist/attractor.mjs, chmod +x
```

### Scripts

| Script | What it does |
|---|---|
| `npm run build` | bundles `src/cli.ts` -> `dist/attractor.mjs` |
| `npm run attractor` | build (silent) then run the CLI |
| `npm run example` | `examples/walkthrough.ts` — seeds 3 basins, applies 3 updates. **No key, no network.** |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev` | `wrangler dev` — local Worker |
| `npm run deploy` | `wrangler deploy` |

`npm run example` is the fastest way to see the system move and the right first
command to run.

> **Undeclared dependency.** `build` and `example` invoke `esbuild`, which is
> **not** listed in `devDependencies`. It currently resolves because `wrangler`
> depends on it and npm hoists the binary into `node_modules/.bin/`. This works
> today and is fragile: a wrangler release that bundles or relocates esbuild
> breaks both scripts with `esbuild: command not found`. Fix by adding esbuild
> to `devDependencies` explicitly.

---

## Configuration

### Local mode — environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ATTRACTOR_STATE` | `~/.attractor/state.json` | state + history file |
| `ATTRACTOR_RUNS` | `~/.attractor/runs.jsonl` | append-only run log |
| `ATTRACTOR_SUBJECT` | `the user` | whose engagement is modelled; appears in the update prompt and the injected context |
| `ATTRACTOR_SUMMARY_MODEL` | `claude-haiku-4-5-20251001` | transcript summarization |
| `ATTRACTOR_UPDATE_MODEL` | `claude-opus-5` | update generation and consolidation |
| `ATTRACTOR_COMPARE_MODELS` | Haiku + Opus, plus API legs if a key is set | comma-separated `engine:model` legs for `compare` |
| `ANTHROPIC_API_KEY` | unset | only needed for `api:` legs of `compare` |

Defaults live in one place: `DEFAULT_MODELS` in `src/engine.ts`.

### Hosted mode — bindings

Declared in `wrangler.toml`:

| Binding | Kind | Notes |
|---|---|---|
| `MODEL_KV` | KV namespace | keys `attractor:state` and `attractor:history` |
| `JOBS` | Queue producer | queue `attractor-jobs` — **see gotchas: no consumer** |
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put ANTHROPIC_API_KEY` |
| `ATTRACTOR_TOKEN` | secret | `wrangler secret put ATTRACTOR_TOKEN` — guards every route |
| `ATTRACTOR_SUBJECT` | var | defaults to `"the user"` |
| `ATTRACTOR_SUMMARY_MODEL` | var (commented out) | optional override |
| `ATTRACTOR_UPDATE_MODEL` | var (commented out) | optional override |

Secrets are secrets, never `[vars]`. `ATTRACTOR_TOKEN` and `ANTHROPIC_API_KEY`
must be set with `wrangler secret put`.

> **`wrangler.toml` as committed is not deployable.** The KV namespace id is the
> literal placeholder `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`. Create a namespace and
> paste the real id before deploying. This is intentional — a real namespace id
> should not be committed — but it means `wrangler deploy` fails out of the box
> until you do it.

---

## Deploy

```bash
npm install

wrangler kv namespace create MODEL_KV       # paste the id into wrangler.toml
wrangler queues create attractor-jobs       # required: the JOBS binding won't resolve without it

wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ATTRACTOR_TOKEN

wrangler deploy
```

Then seed it — the Worker serves nothing useful until it has basins:

```bash
curl -X POST "$API/api/attractor/seed" \
  -H "Authorization: Bearer $ATTRACTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"basins":[
        {"label":"Research methodology","description":"Study design, controls, what makes a result trustworthy","keywords":["assay","controls","replication"]},
        {"label":"Systems architecture","description":"How components fit together and where state lives","keywords":["api","storage","interfaces"]}
      ]}'
```

All basins start at weight 0.5 and entropy 1.0 — nothing is favoured until
conversations arrive.

Creating the queue is not optional even though nothing consumes it: the `JOBS`
producer binding must resolve for the Worker to deploy at all.

---

## HTTP API

**Every** route requires `Authorization: Bearer <ATTRACTOR_TOKEN>`. Anything
outside `/api/attractor*` is a 404. If `ATTRACTOR_TOKEN` is unset the Worker
returns 500 to everything and serves nothing — it fails closed on purpose,
because `seed` can wipe state and `ingest` spends your API key.

### `GET /api/attractor`
Current state. Before seeding returns `{initialized: false, message: ...}` with
status 200 — check the flag, not the status code.

### `GET /api/attractor/history`
Up to the last **10** snapshots. Returns `{history: []}` rather than an error
when empty, including when the stored value fails to parse.

### `POST /api/attractor/seed`
```json
{ "basins": [ {"label": "...", "description": "...", "keywords": ["..."]} ], "force": false }
```
Initializes. **409** if already initialized unless `force: true` — which resets
all history. At least one basin required.

### `POST /api/attractor/basins`
```json
{ "label": "...", "description": "...", "keywords": ["..."] }
```
Adds one basin at weight **0.5** (not the 0.4 that model-proposed new basins
get — a basin you add by hand is treated as seeded, not emergent). 400 if not
initialized, 409 if the slug already exists. Keywords truncated to 10.

### `DELETE /api/attractor/basins/:id`
Removes the basin *and* strips it from every other basin's `connections`.
404 if not found.

### `POST /api/attractor/ingest`
```json
{ "summary": "...", "vibes": ["technical"], "source": "claude-ai" }
```
Feeds a **pre-written** summary straight in. Generates and applies the update
synchronously — no queue, immediate feedback. Returns basins touched, new
connections, emerging patterns, new basin, entropy and trajectory.

### `POST /api/attractor/ingest-transcript`
```json
{ "messages": [ {"role": "user", "content": "..."} ], "source": "claude-code" }
```
Raw messages in. Requires **at least 2** messages. Keeps the **last 30**, each
truncated to **500 characters**, summarizes them with the summary model, then
applies the update. This is what a Claude Code `SessionEnd` hook posts to.
Returns the generated `summary` and `vibes` alongside the update result.

### `POST /api/attractor/trigger`
```json
{ "conversation_id": "..." }
```
Enqueues a job on `attractor-jobs` and returns success. **Nothing in this
repository consumes that queue** — see gotchas below.

---

## Local CLI

```bash
./dist/attractor.mjs seed basins.json      # a JSON array of {label, description, keywords}
./dist/attractor.mjs ingest transcript.txt # or `-` for stdin, or a .jsonl session file
./dist/attractor.mjs ingest --session      # your latest Claude Code session
./dist/attractor.mjs ingest --session foo  # latest session whose project dir matches "foo"
./dist/attractor.mjs sessions [filter]     # list Claude Code sessions, newest first
./dist/attractor.mjs compare transcript    # several models, side by side, writes nothing
./dist/attractor.mjs runs [filter]         # every update ever generated, by conversation
./dist/attractor.mjs                       # show current state (default command)
./dist/attractor.mjs history               # weight evolution
./dist/attractor.mjs context               # the system-prompt block
```

`ingest` and `compare` require `claude` on PATH and exit with a clear message if
it is missing. `seed` refuses if state already exists — delete the state file to
start over (unlike the API, the CLI has no `--force`).

Input resolution: a `.jsonl` path is parsed as a Claude Code session file, `-`
reads stdin, anything else is read as prose. Transcripts are capped at the
**last 40,000 characters** before summarization.

### Claude Code session parsing

`ingest --session` reads `~/.claude/projects/<slugified-path>/<session-id>.jsonl`
directly, so real conversations can be fed in without exporting anything. Only
`user` and `assistant` events with text content are kept; tool calls and results
are skipped, as are text blocks under **30 characters** (acknowledgements and
tool noise). Sessions that parse to zero messages are omitted from `sessions`.

### `compare`

Legs are `engine:model` pairs; a bare model name means `cli:`. Defaults to Haiku
and Opus on the CLI, plus the same two through the API when `ANTHROPIC_API_KEY`
is set.

```bash
ATTRACTOR_COMPARE_MODELS="cli:claude-haiku-4-5-20251001,cli:claude-opus-5,api:claude-opus-5" \
  ./dist/attractor.mjs compare --session
```

Read-only by design: it shows what each model *would* do and saves no state. Legs
are logged to the run log with `applied: false`. A failing leg is reported in the
results table rather than aborting the run. Running the same model through both
`cli:` and `api:` is the control — identical prompt, different transport, so they
should agree.

### The run log

`~/.attractor/runs.jsonl`, one JSON object per line, appended by `ingest` and by
every `compare` leg. Grouped by a truncated SHA-256 of the transcript, which is
the join key that lets you compare models on the same conversation over time.

```bash
./dist/attractor.mjs runs              # grouped by conversation
./dist/attractor.mjs runs <hash>       # one conversation
./dist/attractor.mjs runs opus         # filter by model substring
```

**Privacy.** Full transcripts are never written — only a hash, a 120-character
preview, and the generated summary. The preview and summary are still content.
The file lives in `~/.attractor/`, outside any repo; `.attractor/` and `*.jsonl`
are gitignored. Don't commit it, and think before sharing it.

---

## Making `claude -p` behave like an API call

Relevant to anyone building something similar. `claude -p` is an **agent**, not a
completion endpoint. Left alone it carries Claude Code's own system prompt, the
built-in tools, the working directory, any MCP servers, and your `CLAUDE.md`.
Handed a summarization prompt inside a code repository, a capable model may
reasonably decide the helpful thing is to go read the repository — good agent
behaviour, broken inference call. A weaker model just answers, so **this fails
only when you reach for a better model.**

`ClaudeCliEngine` therefore spawns:

```bash
claude -p \
  --model <id> \
  --tools ""            # no tools: text is the only possible output
  --strict-mcp-config   # no MCP servers
  --setting-sources ""  # no CLAUDE.md, user or project
  --system-prompt "..." # replace the coding-assistant framing
```

`--setting-sources ""` matters most for a distributed tool: without it, whoever
runs this gets summaries shaped by *their* `CLAUDE.md`, so the same conversation
produces different updates on different machines.

No `temperature` is sent on either engine. Newer models reject it outright (400,
`temperature is deprecated for this model`) and `claude -p` never exposed it — so
sending it made the two engines diverge on sampling, which is exactly what the
comparison exists to detect.

---

## Known issues and gotchas

**The queue has no consumer.** `POST /api/attractor/trigger` enqueues to
`attractor-jobs`, but `src/index.ts` exports only a `fetch` handler. Messages are
never processed. The route reports success, which is true (it did enqueue) and
misleading (nothing will act on it). The route also references a conversation
stored by id, implying a D1 database this Worker does not bind. Use `/ingest` or
`/ingest-transcript`, which are synchronous and are the paths in real use. Either
add a `queue` handler or retire the route.

**The hosted Worker never consolidates keywords.** Consolidation is wired into
`cli.ts` only. A hosted attractor will fill its 10 keyword slots and then evict
by recency indefinitely, so its basins gradually describe their last few
conversations rather than their identity — precisely the failure consolidation
exists to prevent.

**`esbuild` is undeclared.** See Install, above.

**`wrangler.toml` ships a placeholder KV id.** See Configuration, above.

**Entropy does not measure focus.** Because weights are normalized by their sum,
entropy measures how evenly attention is *spread*. Observed: entropy moved
1.000 → 0.986 across seven updates while the dominant basin went 50% → 100%. A
long run of narrow conversations pulls unrelated basins together at the 0.3
decay target and *raises* entropy. Intended behaviour (dormancy, not deletion),
but do not read "focus" into the number.

**`computeTrajectory` reads only the last step** of each basin's trajectory, so
it describes the most recent update, not a longer-run trend.

**Model choice changes the dynamics, not just the wording.** Measured across 40
logged updates: mean proposed delta +0.126 (Haiku) vs +0.083 (Opus) — roughly a
four-conversation versus seven-conversation saturation. Haiku also surfaced no
emerging patterns where Opus surfaced three or four, and `emerging_patterns` is
how new basins are born, so under a cheaper model the attractor can only
redistribute weight among the basins you seeded. Neither is wrong; they are
different instruments. One conversation with two runs each is an observation,
not a result.

**`claude -p` ignores max-tokens.** The only remaining deliberate asymmetry
between the engines. It surfaced as a real bug: a 800-token budget truncated
Opus mid-JSON on the API path while the CLI path succeeded, because reasoning
models spend the budget on a thinking block first. The budget is now 4000 for
update generation.

**Reasoning models return a thinking block first.** `ApiEngine` takes the first
block whose `type === "text"`, never `content[0]`. Anything reading Anthropic
responses in this codebase must do the same.

**The web view recomputes its force simulation from scratch on resize.**

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| 500 on every route | `ATTRACTOR_TOKEN` not set — the Worker is failing closed |
| 401 | token missing, or not sent as `Bearer <token>` |
| `{"initialized": false}` | not seeded yet — `POST /api/attractor/seed` |
| 409 on seed | already initialized; `force: true` resets **all** history |
| `esbuild: command not found` | undeclared dependency — `npm i -D esbuild` |
| `wrangler deploy` fails on KV | the placeholder namespace id is still in `wrangler.toml` |
| ``` `claude` not found on PATH ``` | local mode needs Claude Code installed |
| `Claude API error: 400 — ...deprecated` | a model rejected a parameter; the API's own message is surfaced deliberately |
| `No text block in response` | the reply had only non-text blocks; the error lists the block types it did see |
| Summary won't parse | the model wrapped JSON in prose. `ingest` exits; `compare` fails only that leg |

---

## 2026-09-20 — Dynamics constants and measured behaviour

Appended, not merged. Nothing above this line was edited.

**Read the attributions in this section as part of the claims.** Every number
below came from one of exactly two places, and this document did not establish
any of them:

- **The run log** — `~/.attractor/runs.jsonl`, 35 records, every one
  `engine: "cli"` and `model: "claude-opus-5"`. This is observational data from
  real ingests. Statements sourced to it are *measurements*.
- **The replay** — a harness that reimplements `applyUpdate`'s arithmetic
  outside TypeScript so the constants can be varied, then replays the logged
  deltas through it. Statements sourced to it are *simulations*, and they
  inherit the assumption that the reimplementation is faithful. Its faithfulness
  check is that it reproduces two saved state files exactly; see below.

Where a line says "measured", it means the run log. Where it says "replay", it
means the harness. Nothing here was observed by running the shipped TypeScript
path end to end on live ingest.

### Operational constants

| Constant | Value | Where |
|---|---|---|
| `NORMALIZATION_STRENGTH` | `1` | `src/model.ts` |
| `REVERSION_RATE` | `0.04` | `src/model.ts` |
| `SEED_WEIGHT` | `0.35` | `src/model.ts` |
| `NEW_BASIN_WEIGHT` | `0.25` | `src/model.ts` |
| `MIN_WEIGHT` / `MAX_WEIGHT` | `0.05` / `1` | `src/model.ts` |
| `MAX_DELTA` | `0.3` | `src/model.ts`, applied in `parseUpdate` |
| `MAX_KEYWORDS` | `10` | `src/model.ts` |
| `CONSOLIDATE_AFTER_CAP_HITS` | `2` | `src/model.ts` (exported) |
| `MAX_CONSOLIDATIONS` | `3` | `src/model.ts` (exported) |
| `ACTIVE_THRESHOLD` | `0.4` | `src/model.ts` — above this a basin appears in the injected prompt |

`ARCHITECTURE.md`'s appended section of the same date explains *why* each value
is what it is. This table is the lookup.

### Measured from the run log

Source: `~/.attractor/runs.jsonl`. Re-derived on 2026-09-20 by a Python pass
over the file; the figures below are that pass's output, not a recollection.

| Measurement | Value |
|---|---|
| Runs logged | 35 |
| Engines represented | `cli` only — **no API run has ever been logged** |
| Models represented | `claude-opus-5` only |
| Weight deltas proposed | 126 |
| …of which positive | 125 (one negative, none zero) |
| Mean proposed delta | `+0.0570`, range `−0.02 … +0.18` |
| Keyword additions | 255 |
| Keyword removals | 22 |
| `new_basin` proposals | 0 |
| `phase_shift` proposals | 0 |
| Mean keyword length, first 5 runs | 2.095 words (n=42) |
| Mean keyword length, last 5 runs | 3.613 words (n=31) |
| Register shift | **+72%**, with the model held constant at `claude-opus-5` |

That last row is the measurement behind the consolidation cap: the system's own
vocabulary drifted by 72% with nothing about the model changing.

> **A note for anyone citing the `cli:`/`api:` transport control in `compare`:**
> all 35 logged runs are `engine: "cli"`. The API leg has never appeared in
> logged data. It is implemented; it is not verified. Do not describe it
> otherwise.

### An unresolved contradiction — left open deliberately

The docstring on `buildConsolidatePrompt` in `src/model.ts` states that the
per-conversation update is "purely additive in practice — across 40 logged
updates it proposed 115 keyword additions and zero removals."

The run log measures **255 additions and 22 removals** across 35 runs and 126
basin updates.

These do not agree, and **this pass did not resolve them.** The in-code figure
cites "40 logged updates", which matches neither 35 runs nor 126 basin updates,
so it plausibly describes a different window — an earlier log, or a different
unit of counting — rather than being wrong. Both readings are live. The honest
statement is that the "zero removals" claim is **not reproducible against the
current log**, which is a weaker and truer thing than saying it is false.

Resolving it needs whatever log the 115/40 figures were taken from. Until then,
do not quote "zero keyword removals" as a current property of the system.

### Replay: normalization sweep

Source: the replay harness, replaying the 35 logged updates from seed `0.35`.

**Precondition, which the in-code comment does not state:** these numbers only
reproduce with **mean reversion disabled**. With reversion at its shipped `0.04`
the sweep is muddied by the second force, so the sweep isolates normalization by
switching reversion off. Quoting these figures as behaviour of the shipped
configuration would be wrong.

| `NORMALIZATION_STRENGTH` | Basins pinned at 1.0 | Entropy |
|---|---|---|
| `0.0` (no normalization) | 6 of 6 | `1.0000` |
| `0.5` | 2 | `0.9834` |
| `0.7` | 2 | `0.9582` |
| `1.0` (shipped) | **0** | `0.8801` |

The entropy column is the cautionary one: the *worst* row scores the *highest*
entropy. See "Entropy cannot detect saturation" below.

### Replay: reversion sweep

Source: the replay harness at `NORMALIZATION_STRENGTH = 1`, over 105 updates
(the 35-run log replayed three times) to expose long-run behaviour.

| `REVERSION_RATE` | Min weight | Max weight |
|---|---|---|
| `0.00` (off) | `0.0500` — on the floor | `0.9617` |
| `0.01` | `0.0541` | `0.9298` |
| `0.02` | `0.0639` | `0.8651` |
| `0.04` (shipped) | `0.1753` | `0.6331` |
| `0.08` | `0.2207` | `0.4670` |

`0.04` is the gentlest rate that keeps both rails clear. `0.08` over-compresses —
the whole system lands inside a 0.25-wide band, which discards the spread the
weights exist to express.

> **Correction to a figure circulated earlier in this session:** rates `0.01`
> and `0.02` were described as leaving basins "stuck at the 0.05 floor by 105
> updates". That holds for `0.00` only. At `0.01` and `0.02` the minimum is
> `0.0541` and `0.0639` — hovering just above the floor with no recovery, which
> is still a failure, but it is not the floor.

### Replay: the saved state was a code artifact

This is the harness's own faithfulness check, and the strongest single result.

Replaying the 126 logged deltas under the **old** constants — seed `0.5`, decay
toward `0.3` at rate `0.05`, no normalization, no reversion — reproduces the
previously saved state exactly:

```
systems-architecture           1.0000
context-and-memory             1.0000
developer-tooling              1.0000
provenance-and-documentation   1.0000
interface-and-visualization    0.8641
research-and-evaluation        0.8390
```

Those are the values in `~/.attractor/state.pre-promotion-2026-09-20.json`,
including `0.864` and `0.839`, to four decimal places.

**What that establishes:** the saturated state was produced by the arithmetic,
not by the conversations. It was never evidence about how anyone works. It had
to be regenerated rather than patched, and it was — the current
`~/.attractor/state.json` is the same 126 deltas replayed under the shipped
constants, and the harness reproduces *that* file to four decimals too:

```
systems-architecture           0.1886      entropy 0.9625
context-and-memory             0.4700      spread  0.3530
developer-tooling              0.4845
provenance-and-documentation   0.5416
interface-and-visualization    0.3154
research-and-evaluation        0.2351
```

Reproducing both files under their respective constants is what licenses the
replay's other results. It is not proof the TypeScript path behaves identically
under live ingest — only that the arithmetic matches.

Under the old constants the first basin reaches `1.0` on update **7**, and four
of six are pinned by update 35. Note "within ~8 updates" describes the **onset**
of saturation, not its completion — it never reached all six.

### Additions to *Known issues and gotchas*

**Entropy cannot detect saturation.** `computeEntropy` divides weights by their
sum before taking the Shannon entropy, which makes it scale-invariant: six
basins all at `1.0` and six all at `0.3` both score `1.0000`. The fully
saturated pre-regeneration state reads `0.9984` — essentially perfect. Any
alarm, dashboard or health check built on entropy will miss the exact failure
this change exists to prevent. Use `max(weight) − min(weight)`, or count basins
sitting at `MAX_WEIGHT`.

**`MAX_CONSOLIDATIONS` has never fired.** Four basins carry `consolidationCount`
of 4 or 5, above the cap of 3 — they were produced before the cap existed and
survived regeneration, which rebuilds weights rather than keyword history. The
cap is implemented and reviewed; it is **not** demonstrated. Only a state built
from scratch under the cap will exercise it.

**Crossing the consolidation cap is silent.** No log line, no field, no counter
distinguishes "this basin is being consolidated" from "this basin is now being
evicted by recency because it hit the cap". `capHits` continuing to climb on a
basin already at `consolidationCount = 3` is the only available symptom. A
`consolidationCapped` boolean, or a single log line at the crossing, would make
the fallback observable rather than inferred — suggested, not implemented.

**The hosted Worker never consolidates.** `grep consolidat src/routes.ts`
returns nothing; the branch exists only in `src/cli.ts`. A hosted attractor
evicts keywords by recency forever. This is why hosted keywords stay concrete
while CLI keywords drift general — a deployment difference, not a bug in either.

**The web view scales visual weight by share of maximum, not absolutely.**
`web/AttractorView.jsx` sets `weightScale = Math.max(0.01, ...weights)` once per
loaded state, and both the colour ramp and the node radius divide by it. This is
a consequence of zero-sum: under the shipped constants nothing reaches `1.0`, so
absolute colour bands would render every basin in the same low band permanently.
The `Math.max(0.01, …)` floor is a divide-by-zero guard for an empty or
all-floor state, not a tuning value. Note that the *numeric* percentages the
view prints are still the raw weight — the encoding is relative, the label is
absolute — which is intentional but worth knowing before reading a screenshot.

---

## License

MIT — see [LICENSE](LICENSE). **Jennifer Naomi Nguyen**, with **Claude** as contributor.
