<!--
Title        Attractor — persistent topological memory across conversations
Purpose      Public overview: what the Attractor is, the idea behind it, and the
             shape of the model. Start here.
Author       Jennifer Naomi Nguyen
Canonical    README.md in the public `attractor` repository — authoritative for
             the public overview. The implementation lives in a separate
             private repository and is not published here.
Updated      2026-09-28
-->

# Attractor

> A persistent topological memory structure that tracks how modes of engagement evolve across conversations.

Language models don't remember across sessions. But when the same person talks to
them over months, something converges anyway — the interaction develops a shape.
Attractor is an attempt to model that shape directly and feed it back in.

It represents areas of engagement as weighted **basins** — gravity wells that
conversations fall into. After each conversation the basins shift: some gain
weight, untouched ones drift toward dormancy, connections form where thinking
moved between two modes. The resulting state is rendered into a text block and
injected into the next conversation's system prompt.

Conversation → summary → attractor update → system prompt → conversation.

<!-- The loop is the whole thesis: the output of one conversation is an input to
     the next, so the memory is a fixed point being iterated rather than a log
     being appended to. -->

---

## Scope of this repository

This repository is the **conceptual and operational overview** of Attractor.

The implementation — the model code, the CLI, the Worker, the web view — is
maintained privately and is **not** published here. What follows describes what
the system does and how it behaves, not how it is built.

| Document | What it covers |
|---|---|
| **README.md** (this file) | What it is, the idea, the shape of the model |
| [TECHNICAL.md](TECHNICAL.md) | Operational reference: modes, configuration surface, the HTTP API, known behavioural gotchas |

---

## The idea

A basin is an **energy state, not a topic**. "Research methodology" and "creative
writing" aren't just subjects — they're different computational postures,
different patterns of attention. Conversations don't *belong* to basins; they
pull basins toward them and get pulled in return.

Three properties fall out of that:

- **It drifts, it doesn't swing.** Weight changes are clamped hard and the update
  prompt asks for something an order of magnitude smaller than the clamp. The
  system is meant to find equilibrium, not react.
- **Nothing is deleted.** Untouched basins decay toward a dormancy target rather
  than toward zero. A dormant basin can reactivate.
- **Structure is emergent.** Basins connect when a conversation genuinely bridges
  two modes. New basins appear only when a pattern repeatedly fits nowhere.

Two metrics summarize the state: **entropy** (normalized Shannon entropy over
basin weights) and **trajectory** (`stable` / `converging` / `diverging` /
`restructuring`, derived from recent weight changes).

---

## The shape of the model

### Weights

A basin's weight is its activity. Touched basins move by a model-proposed delta,
clamped; untouched basins decay on their own toward a dormancy target that is
deliberately **above zero** — a basin goes quiet, never away.

Seeded basins and later-emerging basins start at different weights, so a basin
the model invents has to earn its place against ones you named.

<!-- The dormancy target being non-zero is the single most load-bearing choice
     here, and the one that looks like a bug to a reader who expects decay to
     mean "forget". It does not mean forget. -->

### Entropy

Normalized Shannon entropy over the weights, treated as a distribution:

```
pᵢ     = wᵢ / Σw
H      = −Σ pᵢ log₂ pᵢ
H_norm = H / log₂(n)          n = basin count
```

0 means one basin holds everything; 1 means weight is spread evenly.

**Read this carefully.** Because weights are normalized by their sum, entropy
measures how evenly attention is *spread*, not how *focused* someone is — and it
is scale-invariant, so it cannot see saturation. In observed runs entropy barely
moved while the dominant basin went from half weight to full. If you want to
detect saturation, look at the spread between the largest and smallest weight, or
count basins sitting at the ceiling. Do not build an alarm on entropy.

### Trajectory

Computed from the most recent step of each basin, not a longer trend — so it
describes the last update rather than a long-run direction. That is a known
limitation, stated here so nobody reads more into the label than is there.

### Keywords

Each basin carries a capped set of keywords, deduplicated case-insensitively.
When the slots fill repeatedly, the basin is **consolidated**: its keywords are
rewritten as a smaller number of more general ones.

Consolidation exists because the per-conversation update never prunes —
abstraction does not emerge from asking a local question, so it gets its own
call. Consolidation is itself capped, because uncapped it becomes a ratchet: the
update prompt shows the model each basin's current keywords, so every ingest
imitates whatever register the last consolidation set, and the next consolidation
raises it again. Left to run, every basin ends up described in language too
general to tell it from any other.

**Seed keywords set the register.** Because the model imitates the vocabulary it
is shown, whatever you seed with anchors the whole history. Write seeds at the
level of abstraction you want the basins to still have after a hundred
conversations.

---

## Watch it move

A worked example, seeding three basins and applying three updates by hand:

```
seed          Basin A  50%  Basin B  50%  Basin C  50%   H=1.000  stable
architecture  Basin A  49%  Basin B  70%  Basin C  49%   H=0.986  converging
arch + method Basin A  59%  Basin B  85%  Basin C  48%   H=0.974  converging
architecture  Basin A  58%  Basin B 100%  Basin C  47%   H=0.951  converging

Untouched basin decayed 0.500 -> 0.471 (drifting toward dormancy, never deleted)
```

Three things to notice. `Basin B` climbs to saturation while `Basin C`, never
mentioned, slides quietly toward dormancy. A connection forms on the second
update, when one conversation touched both basins. And entropy barely moves —
1.000 to 0.951 — even as one basin goes from half to full weight. Worth knowing
before you read anything into that number.

---

## Two ways to run it

| Mode | Engine | State | You need |
|---|---|---|---|
| **Local** | the Claude Code CLI | a local state file | Claude Code |
| **Hosted** | the Anthropic API | Cloudflare KV | A Worker + an API key |

Local needs no API key and no Cloudflare account, because the CLI runs against
whatever login Claude Code already has. Hosted is what you deploy when you want
the attractor reachable from anything, not just the machine it lives on.

Both modes share one model. The safeguards — the delta clamps, the weight bounds,
the decay — apply identically either way, because the model is pure functions
over plain state and doesn't know where that state lives. Storage and inference
are the two seams; everything else is plumbing.

---

## Comparing models

Because the model is a parameter and the prompt is built in one place, "do
different models read a conversation differently?" becomes a measurable question
rather than a vague one. The readout is basin deltas, not prose.

Two differences have shown up consistently, and both are structural rather than
stylistic:

- **A cheaper model moves the attractor faster.** The prompt asks every model to
  be conservative and reserve large deltas for conversations deeply about a
  topic. A stronger model does that; a cheaper one treats the ceiling as the
  target. The same code gives you a memory that settles at two different speeds.
- **A cheaper model surfaces no emerging patterns; a stronger one surfaces
  several.** That has consequences, because emerging patterns are how new basins
  are born. Under the cheaper model the attractor can only redistribute weight
  among the basins you seeded; under the stronger one it stays open-ended.

Neither is wrong. They're different instruments, and which you want depends on
whether you're modelling a settled set of interests or looking for new ones.

Running the same model through two different transports is the control: identical
prompt, different path, so they should agree. If they don't, the two engines
aren't sending equivalent requests.

<!-- Making that control meaningful took more than sharing the prompt text: the
     two engines had been placing the same text in *different roles*, so a
     comparison at that point would have measured the asymmetry, not the
     transport. -->

---

## A privacy note

Attractor's run log stores conversation *summaries* and a short preview — not
full transcripts, but still content. It is written outside any repository on
purpose. Don't commit it, and think before sharing it.

---

## Status

Working, deployed, and in daily use. Known rough edges are listed in
[TECHNICAL.md](TECHNICAL.md).

---

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
