import type {
  AttractorState,
  AttractorUpdate,
  Basin,
  BasinSeed,
  Trajectory,
} from "./types";

// === Tuning constants ===
// These are the rules of the system. Changing them changes how it remembers.

/** Basins start neutral; nothing is favoured at seed time. */
const SEED_WEIGHT = 0.5;
/** New basins that emerge later start below neutral -- they must earn weight. */
const NEW_BASIN_WEIGHT = 0.4;
/** A basin never dies. It only goes dormant. */
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 1;
/** Untouched basins drift toward this value... */
const DECAY_TARGET = 0.3;
/** ...at this fraction per update. Gentle: ~14 updates to close half the gap. */
const DECAY_RATE = 0.05;
/** Hard clamp on model-proposed deltas, regardless of what it asks for. */
const MAX_DELTA = 0.3;
const MAX_KEYWORDS = 10;
const MAX_TRAJECTORY = 20;
/** Above this weight a basin is "active" and appears in the system prompt. */
const ACTIVE_THRESHOLD = 0.4;


/** Slugify a label into a stable basin id. */
export function toBasinId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createInitialState(seeds: BasinSeed[]): AttractorState {
  const now = new Date().toISOString();
  const basins: Basin[] = seeds.map((b) => ({
    id: toBasinId(b.label),
    label: b.label,
    description: b.description,
    weight: SEED_WEIGHT,
    keywords: b.keywords.slice(0, MAX_KEYWORDS),
    connections: [], // populated by the first update
    trajectory: [SEED_WEIGHT],
    lastActive: now,
    conversationCount: 0,
  }));

  return {
    basins,
    phase: 1,
    entropy: 1, // maximum entropy: everything is equal at start
    emerging: [],
    lastUpdated: now,
    updateCount: 0,
    meta: {
      totalConversations: 0,
      dominantBasin: basins[0]?.id ?? "",
      recentTrajectory: "stable",
    },
  };
}

// === Metrics ===

/**
 * Normalized Shannon entropy over basin weights.
 *
 * Weights are independent values in [0.05, 1], not a probability distribution,
 * so they are normalized by their sum before the entropy is taken. The result
 * measures how evenly attention is spread, not how uncertain it is.
 *
 * 0 = one basin dominates completely. 1 = perfectly even spread.
 */
export function computeEntropy(basins: Basin[]): number {
  const totalWeight = basins.reduce((sum, b) => sum + b.weight, 0);
  if (totalWeight === 0) return 1;

  const n = basins.length;
  if (n <= 1) return 0;

  let entropy = 0;
  for (const basin of basins) {
    const p = basin.weight / totalWeight;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  const maxEntropy = Math.log2(n);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * Classify the system's recent motion from per-basin weight deltas.
 *
 * Note this reads the *last step only* of each trajectory, so it describes
 * the most recent update rather than a longer-run trend.
 */
export function computeTrajectory(basins: Basin[]): Trajectory {
  const changes: number[] = [];
  for (const basin of basins) {
    const t = basin.trajectory;
    if (t.length >= 2) changes.push(Math.abs(t[t.length - 1] - t[t.length - 2]));
  }
  if (changes.length === 0) return "stable";

  const avgChange = changes.reduce((s, c) => s + c, 0) / changes.length;
  const sorted = [...basins].sort((a, b) => b.weight - a.weight);

  if (sorted.length >= 2) {
    const top = sorted[0].trajectory;
    const topGrowing = top.length >= 2 && top[top.length - 1] > top[top.length - 2];
    const othersStable = avgChange < 0.1;
    if (topGrowing && othersStable) return "converging";
  }

  if (avgChange > 0.15) return "restructuring";
  if (avgChange > 0.05) return "diverging";
  return "stable";
}

// === Update application ===

/**
 * Apply a model-proposed update to state. Pure: returns a new state.
 *
 * Every proposed change passes through a safeguard here -- deltas are clamped,
 * weights are bounded, and untouched basins decay on their own. The model
 * proposes; this function decides.
 */
export function applyUpdate(state: AttractorState, update: AttractorUpdate): AttractorState {
  const now = new Date().toISOString();
  const basins: Basin[] = state.basins.map((b) => ({
    ...b,
    keywords: [...b.keywords],
    connections: [...b.connections],
    trajectory: [...b.trajectory],
  }));

  const pushTrajectory = (basin: Basin) => {
    basin.trajectory.push(basin.weight);
    if (basin.trajectory.length > MAX_TRAJECTORY) {
      basin.trajectory = basin.trajectory.slice(-MAX_TRAJECTORY);
    }
  };

  // --- Touched basins: apply deltas and keyword changes ---
  for (const bu of update.basin_updates) {
    const basin = basins.find((b) => b.id === bu.id);
    if (!basin) continue;

    basin.weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, basin.weight + bu.weight_delta));

    if (bu.new_keywords) {
      // Case-insensitive: a model call should not be spent noticing that
      // "Claude CLI session" and "claude CLI session" are the same thing.
      // Deterministic dedup first, semantic merging later.
      const seen = new Set(basin.keywords.map((k) => k.toLowerCase().trim()));
      for (const kw of bu.new_keywords) {
        const norm = kw.toLowerCase().trim();
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          basin.keywords.push(kw.trim());
        }
      }
      if (basin.keywords.length > MAX_KEYWORDS) {
        // Record that the basin is out of room. The caller decides whether to
        // consolidate; applyUpdate stays pure and synchronous, because it is
        // the safeguard layer and a model call does not belong in it.
        basin.capHits = (basin.capHits ?? 0) + 1;
        basin.keywords = basin.keywords.slice(-MAX_KEYWORDS);
      }
    }
    if (bu.remove_keywords) {
      const removing = bu.remove_keywords;
      basin.keywords = basin.keywords.filter((k) => !removing.includes(k));
    }

    // Only positive activation counts as the basin having been "used".
    if (bu.weight_delta > 0) {
      basin.lastActive = now;
      basin.conversationCount++;
    }

    pushTrajectory(basin);
  }

  // --- Untouched basins: gentle decay toward dormancy ---
  const touched = new Set(update.basin_updates.map((bu) => bu.id));
  for (const basin of basins) {
    if (touched.has(basin.id)) continue;
    basin.weight += (DECAY_TARGET - basin.weight) * DECAY_RATE;
    pushTrajectory(basin);
  }

  // --- Connections are symmetric ---
  for (const conn of update.new_connections) {
    const from = basins.find((b) => b.id === conn.from);
    const to = basins.find((b) => b.id === conn.to);
    if (!from || !to) continue;
    if (!from.connections.includes(conn.to)) from.connections.push(conn.to);
    if (!to.connections.includes(conn.from)) to.connections.push(conn.from);
  }

  // --- A genuinely new mode of engagement ---
  if (update.new_basin) {
    const newId = toBasinId(update.new_basin.label);
    if (!basins.find((b) => b.id === newId)) {
      basins.push({
        id: newId,
        label: update.new_basin.label,
        description: update.new_basin.description,
        weight: NEW_BASIN_WEIGHT,
        keywords: update.new_basin.keywords.slice(0, MAX_KEYWORDS),
        connections: [],
        trajectory: [NEW_BASIN_WEIGHT],
        lastActive: now,
        conversationCount: 1,
      });
    }
  }

  const dominant = basins.reduce((max, b) => (b.weight > max.weight ? b : max), basins[0]);

  return {
    basins,
    phase: update.phase_shift ? state.phase + 1 : state.phase,
    entropy: computeEntropy(basins),
    emerging: update.emerging_patterns.slice(0, 5),
    lastUpdated: now,
    updateCount: state.updateCount + 1,
    meta: {
      totalConversations: state.meta.totalConversations + 1,
      dominantBasin: dominant?.id ?? "",
      recentTrajectory: computeTrajectory(basins),
    },
  };
}

// === Update generation: prompt in, update out ===

/**
 * Build the prompt that asks a model how this conversation should move the
 * attractor. Engine-agnostic -- the same text goes to the HTTP API or to
 * `claude -p`, so both paths stay in step.
 *
 * Deliberately conservative: the attractor should drift, not swing. Whatever
 * comes back is clamped by `applyUpdate` regardless.
 */
export function buildUpdatePrompt(
  state: AttractorState,
  conversationSummary: string,
  conversationVibes: string[],
  subject = "the user",
): string {
  const basinDescriptions = state.basins
    .map(
      (b) =>
        `- **${b.label}** (id: "${b.id}", weight: ${b.weight.toFixed(2)}, ` +
        `keywords: [${b.keywords.join(", ")}], connections: [${b.connections.join(", ")}])`,
    )
    .join("\n");

  return `You are maintaining an attractor — a persistent topological memory structure that tracks how ${subject}'s interests, projects, and modes of engagement evolve across conversations. Each "basin" represents a mode of thinking/engagement with a weight indicating how active/relevant it currently is. Basins are not just topics — they're energy states that conversations orbit.

Current attractor state:
- Phase: ${state.phase}
- Entropy: ${state.entropy.toFixed(3)} (0 = focused on one topic, 1 = evenly spread)
- Trajectory: ${state.meta.recentTrajectory}
- Dominant basin: ${state.meta.dominantBasin}
- Total conversations processed: ${state.meta.totalConversations}
- Emerging patterns: ${state.emerging.length > 0 ? state.emerging.join(", ") : "none"}

Basins:
${basinDescriptions}

---

A new conversation just happened:
Summary: "${conversationSummary}"
Vibes: [${conversationVibes.join(", ")}]

---

Based on this conversation, generate an attractor update. Return ONLY valid JSON with this structure:
{
  "basin_updates": [
    { "id": "basin-id", "weight_delta": 0.1, "new_keywords": ["new", "concepts"], "remove_keywords": [] }
  ],
  "new_connections": [
    { "from": "basin-id-1", "to": "basin-id-2", "reason": "why they're connected" }
  ],
  "emerging_patterns": ["concept not fitting any basin"],
  "new_basin": null,
  "phase_shift": false
}

Rules:
- weight_delta should be between -0.2 and +0.2. Use larger deltas only for conversations deeply about a topic.
- Only include basins that are actually relevant to this conversation in basin_updates.
- new_connections should only be added when a conversation genuinely bridges two topics.
- emerging_patterns captures concepts that don't fit existing basins — if one keeps appearing, it might become a new basin.
- new_basin should be null unless a genuinely new topic area has emerged that doesn't fit any existing basin. This should be rare.
- phase_shift should be true only if the collaboration has fundamentally changed direction (very rare).
- Be conservative. The attractor should evolve slowly and organically.

Return ONLY the JSON object, no markdown formatting.`;
}

// === Summarization: one policy, both paths ===

/**
 * How much transcript reaches the summarizer.
 *
 * The two paths had drifted: the CLI capped the assembled transcript at 40,000
 * characters, while the Worker kept the last 30 messages and cut each at 500 --
 * so the same conversation produced different summaries depending on which door
 * it came in, and therefore moved the attractor differently. One constant now.
 */
export const MAX_TRANSCRIPT_CHARS = 40_000;

/** Keep the most recent text; the end of a conversation carries the outcome. */
export function capTranscript(transcript: string): string {
  return transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(-MAX_TRANSCRIPT_CHARS)
    : transcript;
}

/** The summarization prompt, defined once so neither path can drift. */
export function buildSummaryPrompt(transcript: string): string {
  return `Analyze this conversation and return a JSON object with exactly two fields:
1. "summary": A concise 1-2 sentence summary of what was discussed and accomplished.
2. "vibes": An array of 1-4 vibe tags describing the conversational energy. Choose from: playful, serious, technical, philosophical, creative, nerdy, focused, casual, witty, warm, chaotic, chill, intense, curious, supportive, sarcastic, brainstormy, deep.

Return ONLY valid JSON, no markdown formatting, no explanation.

Conversation:
${capTranscript(transcript)}`;
}

/** Parse a summarization reply. Throws with the reply text, so callers can report it. */
export function parseSummary(text: string): { summary: string; vibes: string[] } {
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(clean) as { summary?: string; vibes?: string[] };
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      throw new Error("no summary field");
    }
    return { summary: parsed.summary, vibes: Array.isArray(parsed.vibes) ? parsed.vibes : [] };
  } catch {
    throw new Error(`Could not parse a summary from the reply: ${clean.slice(0, 200) || "(empty)"}`);
  }
}

/**
 * Parse and normalize a model's response into an AttractorUpdate.
 * The model is not trusted to return well-formed shapes, or honest numbers.
 */
export function parseUpdate(text: string): AttractorUpdate {
  const clean = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const parsed = JSON.parse(clean) as AttractorUpdate;

  if (!Array.isArray(parsed.basin_updates)) parsed.basin_updates = [];
  if (!Array.isArray(parsed.new_connections)) parsed.new_connections = [];
  if (!Array.isArray(parsed.emerging_patterns)) parsed.emerging_patterns = [];
  if (typeof parsed.phase_shift !== "boolean") parsed.phase_shift = false;
  for (const bu of parsed.basin_updates) {
    // Validate the domain, not just the shape. A non-numeric delta would make
    // both Math.min and Math.max return NaN, and NaN is contagious: it poisons
    // the weight, then entropy, and every comparison against it is false -- so
    // the dominant-basin search silently picks the wrong basin. And it
    // persists, because the state is saved.
    const delta = Number(bu.weight_delta);
    bu.weight_delta = Number.isFinite(delta)
      ? Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta))
      : 0;
  }
  return parsed;
}

// === Keyword consolidation ===

/** Consolidate after this many times filling the keyword slots, not the first. */
export const CONSOLIDATE_AFTER_CAP_HITS = 2;

/** Target size after abstraction, leaving room to accumulate again. */
const CONSOLIDATED_SIZE = 5;

/** Basins whose keywords are due to be abstracted. */
export function basinsNeedingConsolidation(state: AttractorState): Basin[] {
  return state.basins.filter((b) => (b.capHits ?? 0) >= CONSOLIDATE_AFTER_CAP_HITS);
}

/**
 * Ask for a basin's keywords to be abstracted rather than evicted.
 *
 * Eviction by recency means a basin's keyword list describes its last few
 * conversations instead of its identity — the concepts that founded it get
 * pushed out by whatever arrived most recently. Abstraction keeps the shape
 * and drops the specifics, which is what a mode of engagement *is* as opposed
 * to a topic.
 *
 * Deliberately a separate call from the per-conversation update. That update
 * answers a local question ("what did this conversation do?") and is purely
 * additive in practice — across 40 logged updates it proposed 115 keyword
 * additions and zero removals. Abstraction is a global question about the
 * whole basin, and asking one call to do both gets neither done well.
 */
export function buildConsolidatePrompt(basin: Basin): string {
  return `You are abstracting the keyword list of one basin in a topological memory structure.

A basin is a mode of engagement — a way of thinking that conversations orbit — not a topic. Its keywords have accumulated to the point of crowding out the concepts that defined it.

Basin: ${basin.label}
Description: ${basin.description}
Current keywords: ${basin.keywords.join(", ")}

Produce a smaller, more general set of at most ${CONSOLIDATED_SIZE} keywords that preserves what this basin *is* while dropping incidental specifics. Merge near-synonyms. Prefer the shape of the work over the instances of it: several keywords naming particular bugs might become one naming the class of bug.

Do not invent themes that are not present. If the keywords are already general and distinct, return them unchanged.

Return ONLY a JSON array of strings. No explanation, no markdown.`;
}

/** Parse a consolidation reply, falling back to the existing keywords. */
export function parseConsolidation(text: string, fallback: string[]): string[] {
  try {
    const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) return fallback;
    const out = parsed.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim())
      .slice(0, CONSOLIDATED_SIZE);
    return out.length > 0 ? out : fallback;
  } catch {
    return fallback;
  }
}

/** Apply a consolidation result. Pure; resets the cap counter. */
export function applyConsolidation(state: AttractorState, basinId: string, keywords: string[]): AttractorState {
  return {
    ...state,
    basins: state.basins.map((b) =>
      b.id === basinId
        ? { ...b, keywords, capHits: 0, consolidationCount: (b.consolidationCount ?? 0) + 1 }
        : b,
    ),
  };
}

/**
 * Which way a basin moved on its last step, as a classification rather than a
 * symbol.
 *
 * Two places render this — the terminal (ASCII) and the injected context block
 * (Unicode) — and they had drifted to different thresholds and a different
 * number of states. One function decides; each caller keeps its own alphabet.
 */
export type Trend = "up-fast" | "up" | "flat" | "down" | "down-fast" | "unknown";

/** Fast movement is a step of more than this in one update. */
const TREND_FAST = 0.05;

export function classifyTrend(trajectory: number[]): Trend {
  if (trajectory.length < 2) return "unknown";
  const diff = trajectory[trajectory.length - 1] - trajectory[trajectory.length - 2];
  if (diff > TREND_FAST) return "up-fast";
  if (diff > 0) return "up";
  if (diff < -TREND_FAST) return "down-fast";
  if (diff < 0) return "down";
  return "flat";
}

// === System prompt integration ===

/**
 * Render the attractor as a text block for injection into a system prompt.
 *
 * Active basins are listed with weight, trend arrow and connections; dormant
 * ones are named only. The instruction to integrate silently is deliberate:
 * the attractor supplies awareness, not a script.
 */
export function buildAttractorContext(state: AttractorState, subject = "the user"): string {
  const sorted = [...state.basins].sort((a, b) => b.weight - a.weight);
  const active = sorted.filter((b) => b.weight > ACTIVE_THRESHOLD);
  const dormant = sorted.filter((b) => b.weight <= ACTIVE_THRESHOLD);

  const ARROWS: Record<Trend, string> = {
    "up-fast": "↑",
    up: "↑",
    flat: "→",
    down: "↓",
    "down-fast": "↓",
    unknown: "→",
  };
  const arrowFor = (b: Basin): string => ARROWS[classifyTrend(b.trajectory)];

  const activeLines = active
    .map((b) => {
      const connected = b.connections.length > 0 ? ` (connects to: ${b.connections.join(", ")})` : "";
      return `- ${b.label} [${(b.weight * 100).toFixed(0)}%${arrowFor(b)}]: ${b.description}${connected}`;
    })
    .join("\n");

  const dormantLine = dormant.length > 0 ? `\nDormant: ${dormant.map((b) => b.label).join(", ")}` : "";
  const emergingLine = state.emerging.length > 0 ? `\nEmerging patterns: ${state.emerging.join(", ")}` : "";

  return `[Attractor — Persistent Memory (Phase ${state.phase}, ${state.meta.recentTrajectory})
This is a living map of ${subject}'s modes of engagement across conversations. Each basin is an energy state — not just a topic, but a way of thinking. They evolve dynamically through conversation. Use this to maintain continuity and awareness of the ongoing relationship, but integrate it naturally — don't announce it.

Active basins:
${activeLines}${dormantLine}${emergingLine}
]`;
}
