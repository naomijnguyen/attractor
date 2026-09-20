---
Title        Attractor architecture
Purpose      The shape of the system — components, seams, data flow, and why it is built this way. Read before changing anything structural.
Author       Jennifer Naomi Nguyen
Canonical    ~/Bootwitch/Projects/attractor/ARCHITECTURE.md — authoritative. A docs-only copy previously lived at ~/Projects/Anthropic/interpretability/attractor; it was superseded and did not move to the current project home.
Updated      2026-09-20
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

## 2026-09-20 — The weight dynamics as shipped

This section is **appended, not merged**. Everything above it is left exactly as
written, because a document that quietly rewrites itself loses the record of
what was believed when. Where a statement above is now wrong, it is named here
and superseded rather than deleted.

Commit `b26b7f8` ("Stop the weights and the keywords from ratcheting") replaced
the decay model with zero-sum normalization plus mean reversion, and capped
keyword consolidation. That change is shipped and committed; this section brings
the structural description into line with it.

### What this section supersedes

| Where | The earlier statement | Why it is now wrong |
|---|---|---|
| *The one idea…*, the safeguards list | "delta clamps, weight floor, decay" | There is no decay term. The safeguards are the delta clamp, the weight floor/ceiling, zero-sum normalization, and mean reversion. |
| *Data flow*, the `applyUpdate` box | "untouched basins decay" | Untouched basins are not decayed. They absorb their share of the redistribution — they lose `meanDelta`, the same quantity the mentioned basins are measured against. The ASCII diagram itself is left as drawn; this row is the correction. |
| *Components* | "`src/model.ts` is 445 lines" | It is **618** lines as of this date (`wc -l src/model.ts`). The claim "and is the project" still holds and is the part that mattered. |
| *Why these shapes* | "untouched basins decay toward 0.3" | Replaced by mean reversion toward the **live** mean, not a fixed constant. |
| *Why these shapes* | "Drift, not swing. Decay closes 5% of the gap per update — a half-life of about 13.5 updates. This is the single number to change…" | `DECAY_RATE` no longer exists. The nearest equivalent knob is `REVERSION_RATE = 0.04`, and it is **not** the single number to change: normalization and reversion do different jobs, and the section below says which is which. |
| *Why these shapes* | "New basins start below neutral (0.4 vs. the seed's 0.5)" | The values are now 0.25 vs. a seed of 0.35. The *reason* — a late basin should arrive uncompetitive — is unchanged. |
| *Components*, the `model.ts` line | "Entropy, trajectory, decay, clamps" | Same substitution: normalization and reversion in place of decay. |

### A note on this file's `Canonical` header

The header above names this file as authoritative and names a second, superseded
docs-only copy. Two working copies of this repository exist on this machine:

- `~/Bootwitch/Projects/attractor` — the one this file lives in, and the one
  these appends were written against.
- `~/Projects/Anthropic/attractor` — older mtimes, an older and smaller README,
  and older versions of all four architecture documents.

**Only the first was touched.** That restraint is deliberate and worth stating
outright, because the temptation is to "helpfully" sync both. Which copy the
`attractor` binary and the Cloudflare deploy actually resolve to has not been
established here, and editing a copy you cannot prove is live is how two
divergent authorities get created instead of one. Until someone checks what is
actually imported and deployed, the second copy is **ambiguous, not dead** — it
is flagged, not asserted.

### The constants, and what each one is for

Every value below is in `src/model.ts`, which carries the same reasoning inline.
Where the code and this table disagree, the code wins.

| Constant | Value | Why this value |
|---|---|---|
| `NORMALIZATION_STRENGTH` | `1` | Pure zero-sum. Anything less compounds: residual drift accumulates without bound, so there is no setting that saturates "only a little". Softening belongs in reversion instead. |
| `REVERSION_RATE` | `0.04` | The gentlest pull that keeps both rails clear over a long replay without flattening the usable range. Targets the **live mean**, so it never fights the distribution the conversations produced — it only limits how far the tails can run. |
| `SEED_WEIGHT` | `0.35` | Under zero-sum this is also the system's permanent mean, since updates redistribute rather than add. Sits just inside the "low" colour band, so a basin must earn its climb and has somewhere to fall. The old `0.5` opened the graph at its least informative. |
| `NEW_BASIN_WEIGHT` | `0.25` | Below the mean on purpose: a basin that emerges later must earn its place rather than arrive level with the founders. |
| `MAX_DELTA` | `0.3` | Clamped in `parseUpdate`, on what the model may *ask* for — before `applyUpdate` ever sees it. |
| `MIN_WEIGHT` / `MAX_WEIGHT` | `0.05` / `1` | A basin goes dormant; it never dies. The floor being non-zero is what makes reactivation possible. |
| `MAX_CONSOLIDATIONS` | `3` | A bound on how many times one basin may be abstracted, ever. See the ratchet below. |
| `MAX_KEYWORDS` | `10` | Slot count per basin. Overflow increments `capHits` rather than triggering work, because `applyUpdate` must stay pure. |
| `CONSOLIDATE_AFTER_CAP_HITS` | `2` | Consolidate on the second overflow, not the first — one overflow is noise. |

### What each guard prevents, and what it costs

A guard with no stated cost is a guard nobody will be able to reason about later.

**Zero-sum normalization** prevents saturation. It makes reaching `1.0` require
being dominant *relative to everything else*, rather than merely being mentioned
often — which is a property of the conversation rather than of the arithmetic.

> **Its cost, stated plainly:** weight no longer means "how active is this
> basin" but "what share of attention does it hold". A phase in which all your
> work intensifies together reads as **flat**. `phase` and `conversationCount`
> carry the absolute story; weight does not, any more.

**Mean reversion** prevents zero-sum's mirror failure. A basin that is
consistently mentioned below average — ambient: present in most conversations,
the subject of none — would otherwise sink to `MIN_WEIGHT` and stay there, which
is exactly as uninformative as pinning at the ceiling.

> **Its cost:** a genuinely dominant basin is permanently dragged back toward its
> peers. Dominance shows up in the *trend*, not the *level*. It is also applied
> **after** the trajectory point is recorded, so the recorded history shows what
> the conversation did and keeps compression as a separate, slower force
> underneath — an ordering that looks like a mistake until you know why.

**The consolidation cap** prevents a ratchet. Consolidation only ever pushes
toward generality, and `buildUpdatePrompt` shows the model each basin's current
keywords — so the next ingest imitates whatever register the last consolidation
set, and the next consolidation abstracts *that*. It turns one way only.

> **Its cost, which is real and was accepted deliberately:** once
> `consolidationCount` reaches 3, `basinsNeedingConsolidation` stops returning
> that basin, but its keyword list keeps overflowing — so it falls back to
> **eviction by recency** in `applyUpdate`, via `keywords.slice(-MAX_KEYWORDS)`.
> Its keywords then drift toward describing its last few conversations rather
> than its identity, which is precisely the failure consolidation was built to
> prevent. The cap trades a slow loss of specificity for a slow loss of history,
> on the grounds that the second is at least visible in the keywords themselves.
>
> **And it is silent.** There is no log line and no field marking the crossing.
> A climbing `capHits` on a basin already at the cap is the only symptom.

### Entropy is not a saturation alarm

This belongs in the architecture document rather than a footnote, because it
invalidates the obvious monitoring design.

`computeEntropy` normalizes weights by their sum before taking the Shannon
entropy — it has to, because weights are independent values in `[0.05, 1]` and
not a probability distribution. The consequence is that the measure is
**scale-invariant**: six basins all at `1.0` and six basins all at `0.3` both
score exactly `1.0000`.

So entropy cannot detect the failure this entire change exists to prevent. The
fully saturated state reads as maximally healthy. Use `max(weight) − min(weight)`,
or a count of basins sitting at `MAX_WEIGHT`, and treat entropy as what its own
docstring says it is: a measure of how evenly attention is spread.

### The hosted Worker does not consolidate

`src/routes.ts` runs the same chain as the CLI **minus the consolidation
branch** — `grep consolidat src/routes.ts` returns nothing. Consolidation lives
only in `src/cli.ts`.

This is the structural reason the two deployments diverge in character: the
Worker's keywords stay concrete because nothing ever abstracts them, while the
CLI's drift steadily more general. A hosted attractor evicts by recency forever.
Known, documented, not fixed — and note that it means the cap moves the CLI
*toward* the Worker's existing behaviour rather than inventing a third one.

### One thing that is implemented but not demonstrated

`MAX_CONSOLIDATIONS = 3` **has never fired.** No state in existence was produced
under the cap; the basins carrying `consolidationCount` of 4 and 5 predate it.
It is documented here as implemented, and should not be described as
demonstrated until a state regenerated under the cap exercises it.

### A pointer this file makes that is currently stale

The header of this document and of `TECHNICAL.md` both send readers to
`docs/model.md` as authoritative for the constants. **`docs/model.md` has not
been updated for this change** — it still describes decay toward 0.3, a seed of
0.5 and new basins at 0.4. That file is outside this pass's ownership and is
flagged, not edited. Until it is corrected, the authoritative source for the
numbers is `src/model.ts` itself.

---

## License

MIT — see [LICENSE](LICENSE). **Jennifer Naomi Nguyen**, with **Claude** as contributor.
