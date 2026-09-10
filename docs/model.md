# The Model

How the attractor works: state, metrics, update cycle, and every tuning
constant. For setup and API usage see the [README](../README.md).


---

## Origin

The idea came first. Before implementation, before KV cache, before the worker existed.

The question was: what happens when a consistent user interacts with AI instances over time? Not what the AI remembers — it doesn't, not across sessions. But something converges anyway. The responses get closer to something. The interaction develops a shape. That shape is the attractor.

The basin was worked out over a long time. Not as a topic tracker — as a model of energy states. Each basin represents a mode of engagement, a way of thinking that conversations orbit. The insight was that this is topological, not categorical. Conversations don't belong to basins. They pull basins toward them and get pulled in return.

Implementation became possible with KV storage in Cloudflare Workers. A persistence layer that survives across requests. Lightweight, fast, key-value. The attractor state could live there — updated after every conversation, injected into every system prompt. A living structure that evolves with the relationship.

---

## What It Is

A persistent topological memory structure tracking how modes of engagement evolve across conversations.

Each basin is an energy state — not a topic, but a way of thinking. "Research methodology" and "creative writing" are not just subjects; they are different computational postures, different patterns of attention and generation. The attractor models which postures are active, which are dormant, how they connect, and how they shift.

The system is self-organizing. Basins emerge when patterns repeatedly don't fit existing ones. Connections form when conversations bridge two modes of engagement. Basins decay when they stop being activated. The whole structure breathes.

---

## State Structure

Stored at `attractor:state` in KV:

```
{
  basins: [{
    id:                 // slug derived from label
    label:              // human-readable name
    description:        // what this mode of engagement is
    weight:             // 0.05 - 1.0 (how active/relevant)
    keywords:           // max 10, evolve over time
    connections:        // IDs of connected basins
    trajectory:         // rolling 20-point weight history
    lastActive:         // ISO timestamp
    conversationCount:  // how many conversations activated this
  }],
  phase:                // increments on fundamental direction changes
  entropy:              // 0 = focused on one basin, 1 = evenly spread
  emerging:             // patterns not yet fitting any basin
  lastUpdated:          // ISO timestamp
  updateCount:          // total updates applied
  meta: {
    totalConversations: // lifetime count
    dominantBasin:      // current highest-weight basin ID
    recentTrajectory:   // stable | converging | diverging | restructuring
  }
}
```

**Entropy** is normalized Shannon entropy over basin weights. When one basin dominates, entropy approaches 0. When engagement is spread evenly, entropy approaches 1.

**Trajectory** is computed from recent weight changes across all basins:
- **stable** — average change < 0.05
- **converging** — top basin growing, others stable
- **diverging** — average change > 0.05
- **restructuring** — average change > 0.15

---

## Update Cycle

After every conversation:

1. **Extract signal** — conversation summary and vibes are captured
2. **Evaluate** — `generateAttractorUpdate()` sends current attractor state + conversation summary to Claude (Opus, temperature 0.3, max 800 tokens)
3. **Claude returns** a structured update:
   - `basin_updates`: weight deltas + keyword changes for relevant basins
   - `new_connections`: bridges discovered between basins
   - `emerging_patterns`: concepts not fitting any basin
   - `new_basin`: null unless something genuinely new emerged (rare)
   - `phase_shift`: true only for fundamental direction changes (very rare)
4. **Apply** — `applyUpdate()` modifies state with safeguards:
   - Weight deltas clamped to +/-0.3
   - Untouched basins drift toward 0.3 (gentle decay)
   - Trajectories capped at 20 points
   - Keywords capped at 10
   - New basins start at 0.4 (below neutral)
5. **Persist** — state saved to `attractor:state`, snapshot appended to `attractor:history` (max 10 snapshots)

The update prompt instructs Claude to be conservative. The attractor should evolve slowly and organically. Weight deltas of +/-0.1 are typical. Large shifts are reserved for conversations deeply about a topic. Phase shifts are almost never triggered.

---

## Design Principles

**Conservative evolution.** The attractor is not reactive. It does not swing with every conversation. It drifts. It settles. Like a physical system finding equilibrium.

**Self-organizing connections.** Basins connect when a conversation genuinely bridges two modes of engagement. Not because they are topically related — because the thinking moved between them.

**Emergent basins.** When a pattern keeps showing up in `emerging_patterns` across multiple updates but never fits an existing basin, it may become a new basin. This is rare by design.

**Gentle decay.** Untouched basins drift toward 0.3 over time. They don't disappear — they become dormant. A dormant basin can reactivate. Nothing is deleted.

**Entropy as signal.** Low entropy means deep focus. High entropy means broad exploration. Neither is better. The trajectory (converging vs. diverging) tells you which direction the system is moving.

---

## System Prompt Integration

`buildAttractorContext()` generates a text block injected into the system prompt of every conversation:

```
[Attractor -- Persistent Memory (Phase N, TRAJECTORY)
This is a living map of <subject>'s modes of engagement across conversations.
Each basin is an energy state -- not just a topic, but a way of thinking.
They evolve dynamically through conversation. Use this to maintain continuity
and awareness of the ongoing relationship, but integrate it naturally --
don't announce it.

Active basins:
- Label [75% ^]: Description (connects to: other-basin)
- Label [62% ~]: Description

Dormant: label1, label2

Emerging patterns: concept1, concept2
]
```

Active basins are those with weight > 0.4. Trend arrows show recent direction. Connections show which basins bridge to each other. The instruction is explicit: integrate naturally, don't announce it. The attractor provides awareness, not script.

---

## API

See the [endpoint table in the README](../README.md#api). All routes require a bearer token.

---

## CLI

The `attractor` shell script provides terminal visualization:

```bash
attractor            # current state with visual bars + trends
attractor history    # evolution table over time
```

Current state shows:
- Phase, entropy, trajectory, dominant basin
- Each basin with weight percentage, trend arrow, visual bar, conversation count
- Connections between basins
- Emerging patterns
- Top basin keywords

History shows a table of basin weights over time with mini-bars.

Requires token at `~/.claude/attractor-token`.

---

## KV Schema

Same namespace as model detection (`MODEL_KV`), different keys:

| Key | Contents |
|-----|----------|
| `attractor:state` | Full current state (JSON) |
| `attractor:history` | Last 10 snapshots: `[{ timestamp, basins: [{ id, weight }] }]` |

Model detection keys (`model:current`, `model:counts`, `model:gossip`) coexist in the same namespace. The features are independent.

---

## Relationship to Other Concepts

**Interaction patterns as forces** — The attractor is shaped by *how* someone
engages, not just what about: threading several ideas at once, holding
alternatives open rather than collapsing them early, bridging between domains.
Those habits are the forces that pull basins into position. The attractor is
the record of those forces accumulated over time.

**Immune-to-transformer mapping** — Tertiary lymphoid structure (TLS) formation
maps onto basin formation. TLS are organized lymphoid tissues that arise in
non-lymphoid sites after repeated inflammatory stimulation — persistent
structure emerging from transient signals, at a location the body never
planned for. Basins form the same way: repeated activation in a region of
concept space eventually produces a durable structure there. The parallel is
not decorative; both are self-organizing systems where the *history* of
stimulation is what builds the architecture.

**Episodic vs. structural memory** — A companion system preserves what this
architecture deliberately drops: episodic detail, texture, specific moments.
The attractor preserves what the architecture naturally *does* — convergence
patterns, the energy landscape, the shape of a working relationship over time.
They are complementary, and neither substitutes for the other.

---

## Status

Implemented in this repository as clean TypeScript:

| Concern | File |
|---------|------|
| Model (entropy, trajectory, decay, update application) | `src/model.ts` |
| REST API | `src/routes.ts` |
| Worker entry | `src/index.ts` |
| Terminal view | `cli/attractor` |
| Canvas view | `web/AttractorView.jsx` |

The earlier version lived in `njarm23/oo` as bundled JavaScript; this is that
logic recovered and rewritten with types, named constants, and the reasoning
behind each threshold documented inline.
