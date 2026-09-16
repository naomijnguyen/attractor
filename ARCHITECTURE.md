---
Title        Attractor architecture
Purpose      The shape of the system — components, seams, data flow, and why it is built this way. Read before changing anything structural.
Author       Jennifer Naomi Nguyen
Canonical    ~/Projects/Anthropic/attractor/ARCHITECTURE.md — authoritative. The docs-only copy at ~/Projects/Anthropic/interpretability/attractor is superseded (see its SUPERSEDED.md).
Updated      2026-09-13
Dependencies none to read. To run what it describes: Node 18+, and either the `claude` binary on PATH (local mode) or a Cloudflare account + Anthropic API key (hosted mode).
---

# Architecture

For *what* the Attractor is, start at [README.md](README.md). For the exact
numbers — every constant, every formula — see [docs/model.md](docs/model.md)
and the "The math" section of the README. This document is about **structure**:
what the pieces are, where the seams fall, and which decisions are load-bearing.

---

## The one idea that determines everything else

**The model is a pure function over plain state.**

`applyUpdate(state, update) -> state` in `src/model.ts` does not read a file, does
not call an API, and does not know whether it is running on a laptop or in a
Cloudflare Worker. Everything else in the codebase exists to feed it and to put
its output somewhere.

That single constraint is what makes the rest of the design fall out:

- The safeguards (delta clamps, weight floor, decay) live *inside* the pure
  function, so they cannot be bypassed by a caller who forgot them. Local mode
  and hosted mode get identical guarantees without sharing a line of I/O code.
- Storage and generation become swappable, because neither is baked into the
  model.
- The model is trivially testable, and `examples/walkthrough.ts` exercises the
  whole update cycle with no network and no key.

The phrase that captures the trust boundary: **the model proposes, `applyUpdate`
decides.** A language model returns a suggested update; nothing it says is
trusted. `parseUpdate` normalizes the shape and clamps deltas to ±0.3,
`applyUpdate` bounds weights to [0.05, 1.0]. A model that asks for a +5.0 swing
gets +0.3.

---

## The two seams

Everything variable in this system is isolated behind exactly two interfaces.
This is the part worth understanding before changing anything.

### Seam 1 — `Store` (`src/store.ts`): where state lives

```
interface Store {
  load():    Promise<AttractorState | null>
  save(state, by?: Provenance): Promise<void>
  history(): Promise<HistorySnapshot[]>
}
```

| Implementation | Backing | Used by |
|---|---|---|
| `FileStore` | one JSON file, default `~/.attractor/state.json` | the local CLI |
| `KvStore` | Cloudflare KV: keys `attractor:state`, `attractor:history` | the hosted Worker |

`FileStore` is Node-only, but it lives in the same module as `KvStore`. It gets
away with that because its `node:fs` imports are **dynamic** — `await import(...)`
inside methods rather than at the top of the file. In the Worker, where
`node:fs` does not exist, the class is simply never constructed and the import
never runs. Static imports here would break the Worker build.

Both implementations cap history at **10 snapshots**. History is a trend line,
not an archive; the run log below is the archive.

### Seam 2 — `Engine` (`src/engine.ts`): what generates an update

```
interface Engine {
  call(system, user, model, maxTokens): Promise<string>   // the one primitive
  complete(prompt, model?, maxTokens?): Promise<string>
  generateUpdate(state, summary, vibes): Promise<AttractorUpdate>
}
```

| Implementation | Transport | Credential |
|---|---|---|
| `ApiEngine` | Anthropic HTTP API | `ANTHROPIC_API_KEY` (pay-as-you-go) |
| `ClaudeCliEngine` | spawns `claude -p` | whatever Claude Code is logged in as — a Pro/Team/Max subscription works |

`ClaudeCliEngine` is the reason local mode needs no API key, and it is the
non-obvious half of this project.

**Both engines are required to route through the single `call` primitive.** That
is a deliberate structural constraint, not tidiness. An earlier version had the
API engine send the attractor prompt as the *system* prompt while the CLI engine
concatenated it into the *user* turn. Both "used the same prompt" and both
worked — but any comparison between them was measuring the role asymmetry rather
than the models. Funnelling both through `call(system, user, ...)` makes the two
requests equivalent by construction.

One asymmetry is known and deliberately left: `claude -p` has no max-tokens
flag, so `ClaudeCliEngine.call` ignores that argument. It is documented in the
code rather than hidden.

---

## Data flow

The core loop is the same in both modes. Only the endpoints differ.

```
  conversation transcript
          |
          v
   [ summarize ]            cheap model (default Haiku) — one Engine.call
          |
          v
   { summary, vibes[] }
          |
          v
   [ buildUpdatePrompt ]    src/model.ts — current state + this conversation
          |
          v
   [ Engine.call ]          judgement model (default Opus) — proposes an update
          |
          v
   [ parseUpdate ]          shape normalized, deltas clamped to ±0.3
          |
          v
   [ applyUpdate ]          PURE. weights bounded, untouched basins decay,
          |                 connections made symmetric, entropy recomputed
          v
   [ Store.save ]           file or KV, + a history snapshot
          |
          v
   [ buildAttractorContext ] rendered text block -> next conversation's system prompt
```

Two jobs, two models, on purpose: deciding what a conversation *meant* needs
judgement; compressing a transcript does not, so that goes somewhere cheap.
Both are overridable (`ATTRACTOR_SUMMARY_MODEL`, `ATTRACTOR_UPDATE_MODEL`)
because pinned model ids age badly.

### The consolidation branch

Keyword consolidation is a **separate model call**, not part of the update, and
that separation is a design decision with evidence behind it.

`applyUpdate` stays pure and synchronous, so it cannot make a model call. When a
basin overflows its 10 keyword slots it records `capHits++` and truncates. The
*caller* — `cli.ts` — then checks `basinsNeedingConsolidation` and, on the 2nd
cap hit, issues a second call that abstracts the basin's keywords down to ≤5.

Why not fold it into the update call? Because the per-conversation update
answers a local question ("what did this conversation do?") and in practice is
purely additive: across 40 logged updates it proposed **115 keyword additions
and zero removals**. Abstraction is a global question about a whole basin. One
call asked to do both does neither well.

Note the asymmetry this creates, because it is a real architectural gap: **the
hosted Worker never consolidates.** `routes.ts` calls `applyUpdate` and saves.
Only the CLI runs the consolidation branch.

---

## Components

```
src/
  model.ts      THE ATTRACTOR. Pure. Entropy, trajectory, decay, clamps,
                prompt construction, context rendering. Read this first.
  types.ts      State, basins, updates, run records, Worker bindings.
  store.ts      Seam 1 — FileStore | KvStore.
  engine.ts     Seam 2 — ClaudeCliEngine | ApiEngine.
  runs.ts       Append-only JSONL log of every generated update.
  sessions.ts   Reads Claude Code's own ~/.claude/projects/*.jsonl transcripts.
  render.ts     Terminal output — bars, tables, comparison grids.
  cli.ts        Local entry point. The only place consolidation is wired in.
  routes.ts     REST API over the model.
  index.ts      Worker entry point. Auth gate, then delegates to routes.
cli/attractor   Zero-dependency bash viewer for a *hosted* deployment.
web/            React force-directed canvas view + a standalone API client.
examples/       walkthrough.ts — the whole cycle, no network, no key.
```

`src/model.ts` is 445 lines and is the project. `store.ts` and `engine.ts` are
the seams. Everything else is plumbing or presentation.

Note that `cli/attractor` (bash) and `src/cli.ts` (Node) are **different tools
that share a name**: the bash script is a read-only viewer that talks HTTP to a
deployed Worker, while `src/cli.ts` runs the entire loop locally against a JSON
file. They do not interact.

---

## The Worker

`src/index.ts` is deliberately thin and does exactly one thing before
delegating: **authentication, failing closed.**

```
request -> is path /api/attractor*?          no  -> 404
        -> is ATTRACTOR_TOKEN set?           no  -> 500 (refuses to serve)
        -> does Bearer token match?          no  -> 401
        -> handleAttractorRoutes(...)
```

The "refuse if the secret is unset" branch is the important one. `seed` can wipe
all state and `ingest` spends your Anthropic key, so an unconfigured deployment
must serve nothing rather than serve everything. Comparison is constant-time so
token checking does not leak length or prefix through timing.

There is no CORS handling and no cookie session: this is a token-guarded
machine-to-machine API, intended to be called by a `SessionEnd` hook, a script,
or a front end that holds the token server-side.

### Bindings

| Binding | Kind | Purpose |
|---|---|---|
| `MODEL_KV` | KV namespace | `attractor:state`, `attractor:history` |
| `JOBS` | Queue producer (`attractor-jobs`) | enqueued by `POST /trigger` |
| `ANTHROPIC_API_KEY` | secret | used by `ApiEngine` |
| `ATTRACTOR_TOKEN` | secret | guards every route |
| `ATTRACTOR_SUBJECT` | var | whose engagement is modelled |

### Known structural gap: the queue has no consumer

`POST /api/attractor/trigger` sends a job to the `attractor-jobs` queue, but
`src/index.ts` exports **only a `fetch` handler** — there is no `queue` handler
in this repository. Messages enqueued by `/trigger` are therefore not consumed
by this Worker. The route returns `{success: true, message: "Attractor update
enqueued"}`, which is true and also misleading, because nothing here will act on
it.

This is a genuine incompleteness rather than a subtlety to preserve. The two
ingest routes (`/ingest`, `/ingest-transcript`) do their work **synchronously**
and are the paths actually in use; `/trigger` is a vestige of a design where
updates were processed in the background against conversations stored in D1 (a
database this Worker does not bind). Either add a `queue` handler or retire the
route — see [TECHNICAL.md](TECHNICAL.md#known-issues-and-gotchas).

---

## Provenance: why the run log exists

`RunLog` (`src/runs.ts`) appends one JSON Lines record per generated update, to
`~/.attractor/runs.jsonl` — from `ingest` (marked `applied: true`) and from every
`compare` leg (`applied: false`, because comparison never writes).

The design decision worth understanding is the **join key**: each record stores a
truncated SHA-256 of the transcript, never the transcript itself. That hash is
what lets you line up runs of the *same* conversation across different models
and different dates.

This matters because **models change underneath you.** The attractor's own state
records where it ended up, never what took it there. Replaying a conversation
you already have runs for and reading down its row shows whether a model's
behaviour moved — a question state alone can never answer. `HistorySnapshot`
carries `model` and `engine` for the same reason.

JSON Lines with no schema magic, so `grep`, `jq` or six lines of Python can read
it without this tool. It survives a partial write, and `RunLog.all()` tolerates a
torn final line.

**Privacy consequence, by construction:** full transcripts are never persisted —
only a hash, a 120-character preview, and the generated summary. Those last two
are still content. The log lives in `~/.attractor/`, outside any repo, and
`.attractor/` and `*.jsonl` are gitignored.

---

## Why these shapes

A few decisions that look arbitrary and are not:

**A basin is an energy state, not a topic.** Conversations do not *belong* to
basins; they pull basins toward them. This is why weight is continuous and
decaying rather than a tag or a count, and why `description` is prose rather
than a category.

**Nothing is ever deleted.** The weight floor is 0.05, not 0, and untouched
basins decay toward 0.3 rather than toward zero. A basin goes dormant and can
reactivate. The cost is a real measurement artifact, documented rather than
hidden: a long run of narrow conversations pulls unrelated basins *together* at
0.3 and raises entropy, so entropy measures how evenly attention is spread, not
how focused someone is.

**Drift, not swing.** Decay closes 5% of the gap per update — a half-life of
about 13.5 updates. This is the single number to change if the system feels too
sticky or too twitchy.

**New basins start below neutral** (0.4 vs. the seed's 0.5), so they have to earn
their place.

**Connections are symmetric,** enforced in `applyUpdate` rather than trusted from
the model, because a one-directional "bridge" is not a bridge.

**Keyword dedup is case-insensitive and deterministic**, done in code rather than
by the model: a model call should not be spent noticing that "Claude CLI
session" and "claude CLI session" are the same string.

---

## What this shape buys

Because the model is a parameter and the prompt is built in exactly one place,
"do different models read a conversation differently?" is a measurable question
rather than a vague one — `attractor compare` runs one transcript through
several `engine:model` legs and prints the basin deltas side by side, writing
nothing.

That is not a feature bolted on; it is what having two clean seams makes nearly
free. The observed differences (one model treating the delta ceiling as a
target, another surfacing emerging patterns where the first surfaces none) are
reported in the README, with the caveat that one conversation and two runs each
is an observation, not a result.

---

## License

MIT — see [LICENSE](LICENSE). **Jennifer Naomi Nguyen**, with **Claude** as contributor.
