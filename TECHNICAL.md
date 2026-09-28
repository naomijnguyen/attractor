<!--
Title        Attractor technical reference (public overview)
Purpose      Operational reference for the published surface — run modes,
             configuration, the HTTP API, the CLI commands, and the known
             behavioural gotchas. Reach for this when running or deploying it.
Author       Jennifer Naomi Nguyen
Canonical    TECHNICAL.md in the public `attractor` repository — authoritative
             for the public operational surface. Implementation details, model
             constants and internal file references live in the private
             implementation repository and are deliberately not reproduced here.
Updated      2026-09-28
Dependencies Node 18+. Local mode needs the `claude` binary on PATH. Hosted mode
             needs a Cloudflare account with KV + Queues, and an Anthropic API key.
-->

# Technical reference

[README.md](README.md) is the introduction. This is the operational document:
what to set, what every endpoint does, and what is known to be rough.

**Scope.** This repository publishes the overview and the operational surface.
The implementation is private. Tuning constants, internal module structure and
the measured dynamics of the model are **not** reproduced here.

---

## Requirements

| | |
|---|---|
| Node | 18 or newer |
| Local mode | the `claude` binary on PATH (Claude Code), signed in |
| Hosted mode | Cloudflare account (KV + Queues), Anthropic API key, `wrangler` |

Local mode bills against your **Claude Code subscription quota**, not per-token
API billing, because it drives the binary under your own login. It is also
slower — one process start per call, and an ingest makes two calls. Fine for a
handful of conversations, wrong for hundreds; batch through hosted mode.

---

## Configuration

### Local mode — environment variables

| Variable | Purpose |
|---|---|
| `ATTRACTOR_STATE` | path to the state + history file |
| `ATTRACTOR_RUNS` | path to the append-only run log |
| `ATTRACTOR_SUBJECT` | whose engagement is modelled; appears in the update prompt and the injected context |
| `ATTRACTOR_SUMMARY_MODEL` | model used for transcript summarization |
| `ATTRACTOR_UPDATE_MODEL` | model used for update generation and consolidation |
| `ATTRACTOR_COMPARE_MODELS` | comma-separated `engine:model` legs for a comparison run |
| `ANTHROPIC_API_KEY` | only needed for API legs of a comparison run |

Two jobs, two models. Generating an update needs judgement about what a
conversation meant; summarizing a transcript doesn't, so that goes somewhere
cheaper.

### Hosted mode — bindings

| Binding | Kind | Notes |
|---|---|---|
| `MODEL_KV` | KV namespace | holds the state and the history |
| `JOBS` | Queue producer | see gotchas: no consumer |
| `ANTHROPIC_API_KEY` | secret | `wrangler secret put ANTHROPIC_API_KEY` |
| `ATTRACTOR_TOKEN` | secret | `wrangler secret put ATTRACTOR_TOKEN` — guards every route |
| `ATTRACTOR_SUBJECT` | var | whose engagement is modelled |
| `ATTRACTOR_SUMMARY_MODEL` | var | optional override |
| `ATTRACTOR_UPDATE_MODEL` | var | optional override |

Secrets are secrets, never plain vars. A real KV namespace id should never be
committed — create the namespace and supply the id at deploy time.

---

## Deploy

```bash
wrangler kv namespace create MODEL_KV       # supply the id in your config
wrangler queues create attractor-jobs       # required: the JOBS binding won't resolve without it

wrangler secret put ANTHROPIC_API_KEY
wrangler secret put ATTRACTOR_TOKEN

wrangler deploy
```

Creating the queue is not optional even though nothing consumes it: the `JOBS`
producer binding must resolve for the Worker to deploy at all.

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

All basins start at the same weight and entropy 1.0 — nothing is favoured until
conversations arrive.

---

## HTTP API

**Every** route requires `Authorization: Bearer <ATTRACTOR_TOKEN>`. Anything
outside `/api/attractor*` is a 404. If `ATTRACTOR_TOKEN` is unset the Worker
returns 500 to everything and serves nothing — it fails closed on purpose,
because seeding can wipe state and ingesting spends your API key.

### `GET /api/attractor`
Current state. Before seeding returns `{initialized: false, message: ...}` with
status **200** — check the flag, not the status code.

### `GET /api/attractor/history`
The most recent snapshots. Returns `{history: []}` rather than an error when
empty, including when the stored value fails to parse.

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
Adds one basin at the **seeded** weight, not the lower weight a model-proposed
basin gets — a basin you add by hand is treated as seeded, not emergent. 400 if
not initialized, 409 if the slug already exists. Keywords are truncated to the
per-basin cap.

### `DELETE /api/attractor/basins/:id`
Removes the basin *and* strips it from every other basin's `connections`.
404 if not found.

### `POST /api/attractor/ingest`
```json
{ "summary": "...", "vibes": ["technical"], "source": "claude-ai" }
```
Feeds a **pre-written** summary straight in. Generates and applies the update
synchronously — no queue, immediate feedback. Returns basins touched, new
connections, emerging patterns, any new basin, entropy and trajectory.

### `POST /api/attractor/ingest-transcript`
```json
{ "messages": [ {"role": "user", "content": "..."} ], "source": "claude-code" }
```
Raw messages in. Requires at least two messages. Keeps a bounded tail, each
message truncated, summarizes them with the summary model, then applies the
update. This is what a Claude Code `SessionEnd` hook posts to. Returns the
generated `summary` and `vibes` alongside the update result.

### `POST /api/attractor/trigger`
```json
{ "conversation_id": "..." }
```
Enqueues a background job and returns success. **Nothing consumes that queue** —
see gotchas.

---

## Local CLI

```bash
attractor seed basins.json      # a JSON array of {label, description, keywords}
attractor ingest transcript.txt # or `-` for stdin, or a .jsonl session file
attractor ingest --session      # your latest Claude Code session
attractor ingest --session foo  # latest session whose project dir matches "foo"
attractor sessions [filter]     # list Claude Code sessions, newest first
attractor compare transcript    # several models, side by side, writes nothing
attractor runs [filter]         # every update ever generated, by conversation
attractor                       # show current state (default command)
attractor history               # weight evolution
attractor context               # the system-prompt block
```

`ingest` and `compare` require `claude` on PATH and exit with a clear message if
it is missing. `seed` refuses if state already exists — delete the state file to
start over (unlike the API, the CLI has no `--force`).

Input resolution: a `.jsonl` path is parsed as a Claude Code session file, `-`
reads stdin, anything else is read as prose. Transcripts are capped to a bounded
tail before summarization.

### Claude Code session parsing

`ingest --session` reads Claude Code's own session transcripts directly, so real
conversations can be fed in without exporting anything. Only `user` and
`assistant` events with text content are kept; tool calls and results are
skipped, as are very short text blocks (acknowledgements and tool noise).
Sessions that parse to zero messages are omitted from the listing.

### `compare`

Legs are `engine:model` pairs; a bare model name means the local CLI.

Read-only by design: it shows what each model *would* do and saves no state. Legs
are logged to the run log marked as not applied. A failing leg is reported in the
results table rather than aborting the run. Running the same model through both
transports is the control — identical prompt, different transport, so they should
agree.

### The run log

One JSON object per line, appended by every ingest and by every comparison leg.
Runs are grouped by a truncated hash of the transcript, and **that join key is
the whole design**. Models change underneath you; replaying a conversation you
already have runs for and reading down its row shows whether the model's
behaviour moved — something the attractor's own state can never tell you, because
state only records where it ended up, not what took it there.

**Privacy.** Full transcripts are never written — only a hash, a short preview,
and the generated summary. The preview and the summary are still content. The
file lives outside any repository. Don't commit it, and think before sharing it.

---

## Making `claude -p` behave like an API call

Relevant to anyone building something similar. `claude -p` is an **agent**, not a
completion endpoint. Left alone it carries Claude Code's own system prompt, the
built-in tools, the working directory, any MCP servers, and your `CLAUDE.md`.
Handed a summarization prompt inside a code repository, a capable model may
reasonably decide the helpful thing is to go read the repository — good agent
behaviour, broken inference call. A weaker model just answers, so **this fails
only when you reach for a better model.**

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

No `temperature` is sent on either engine. Newer models reject it outright and
`claude -p` never exposed it — so sending it made the two engines diverge on
sampling, which is exactly what the comparison exists to detect.

---

## Known issues and gotchas

**The queue has no consumer.** The trigger route enqueues a job, but nothing
processes it. The route reports success, which is true (it did enqueue) and
misleading (nothing will act on it). Use the synchronous ingest routes, which are
the paths in real use.

**The hosted Worker never consolidates keywords.** Consolidation is wired into
the CLI path only. A hosted attractor fills its keyword slots and then evicts by
recency indefinitely, so its basins gradually describe their last few
conversations rather than their identity — precisely the failure consolidation
exists to prevent. This is a deployment difference, not a bug in either path.

**Entropy cannot detect saturation.** Entropy divides weights by their sum before
taking the Shannon entropy, which makes it scale-invariant: every basin at the
ceiling and every basin at the dormancy target score the same. A fully saturated
state reads as essentially perfect entropy. Any alarm, dashboard or health check
built on entropy will miss exactly the failure you care about. Use the spread
between the largest and smallest weight, or count basins sitting at the ceiling.

**Trajectory reads only the last step** of each basin's history, so it describes
the most recent update, not a longer-run trend.

**Model choice changes the dynamics, not just the wording.** A cheaper model
proposes systematically larger weight deltas and surfaces no emerging patterns,
so the attractor saturates faster and can only redistribute weight among the
basins you seeded. Neither behaviour is wrong; they are different instruments.

**`claude -p` ignores max-tokens.** The only remaining deliberate asymmetry
between the engines. It surfaced as a real bug: a small token budget truncated a
reasoning model mid-JSON on the API path while the CLI path succeeded, because
reasoning models spend the budget on a thinking block first.

**Reasoning models return a thinking block first.** Take the first block whose
type is `text`, never simply the first block. Anything reading Anthropic
responses must do the same.

**Crossing the consolidation cap is silent.** Nothing distinguishes "this basin
is being consolidated" from "this basin is now being evicted by recency because
it hit the cap". A flag or a single log line at the crossing would make the
fallback observable rather than inferred — suggested, not implemented.

**The web view encodes weight relatively, labels it absolutely.** Node size and
colour are scaled by the largest current weight, while the printed percentage is
the raw weight. Intentional, but worth knowing before reading a screenshot.

**The web view recomputes its force simulation from scratch on resize.**

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| 500 on every route | `ATTRACTOR_TOKEN` not set — the Worker is failing closed |
| 401 | token missing, or not sent as `Bearer <token>` |
| `{"initialized": false}` | not seeded yet — seed it |
| 409 on seed | already initialized; `force: true` resets **all** history |
| `wrangler deploy` fails on KV | no real KV namespace id supplied |
| `` `claude` not found on PATH `` | local mode needs Claude Code installed |
| `Claude API error: 400 — ...deprecated` | a model rejected a parameter; the API's own message is surfaced deliberately |
| `No text block in response` | the reply had only non-text blocks; the error lists the block types it did see |
| Summary won't parse | the model wrapped JSON in prose. Ingest exits; comparison fails only that leg |

---

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
