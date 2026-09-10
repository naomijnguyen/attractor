import type {
  AttractorState,
  AttractorUpdate,
  Basin,
  BasinSeed,
  Env,
  HistorySnapshot,
  Trajectory,
} from "./types";

// === Tuning constants ===
// These are the rules of the system. Changing them changes how it remembers.

const KV_STATE = "attractor:state";
const KV_HISTORY = "attractor:history";

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
const MAX_HISTORY = 10;
/** Above this weight a basin is "active" and appears in the system prompt. */
const ACTIVE_THRESHOLD = 0.4;

const MODEL = "claude-opus-4-6";

/** Slugify a label into a stable basin id. */
export function toBasinId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// === Persistence ===

export async function getAttractorState(kv: KVNamespace): Promise<AttractorState | null> {
  const raw = await kv.get(KV_STATE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AttractorState;
  } catch {
    return null;
  }
}

/**
 * Persist state and append a weight snapshot to the rolling history.
 * History is capped at MAX_HISTORY -- this is a trend line, not an archive.
 */
export async function saveAttractorState(kv: KVNamespace, state: AttractorState): Promise<void> {
  await kv.put(KV_STATE, JSON.stringify(state));

  let history: HistorySnapshot[] = [];
  const historyRaw = await kv.get(KV_HISTORY);
  if (historyRaw) {
    try {
      history = JSON.parse(historyRaw) as HistorySnapshot[];
    } catch {
      history = [];
    }
  }

  history.push({
    timestamp: state.lastUpdated,
    basins: state.basins.map((b) => ({ id: b.id, weight: b.weight })),
  });

  await kv.put(KV_HISTORY, JSON.stringify(history.slice(-MAX_HISTORY)));
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
      for (const kw of bu.new_keywords) {
        if (!basin.keywords.includes(kw)) basin.keywords.push(kw);
      }
      basin.keywords = basin.keywords.slice(-MAX_KEYWORDS);
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

// === Model-driven update generation ===

/**
 * Ask Claude how this conversation should move the attractor.
 *
 * The prompt is deliberately conservative: the attractor should drift, not
 * swing. Whatever comes back is clamped by `applyUpdate` regardless.
 */
export async function generateAttractorUpdate(
  env: Env,
  state: AttractorState,
  conversationSummary: string,
  conversationVibes: string[],
): Promise<AttractorUpdate> {
  const subject = env.ATTRACTOR_SUBJECT || "the user";

  const basinDescriptions = state.basins
    .map(
      (b) =>
        `- **${b.label}** (id: "${b.id}", weight: ${b.weight.toFixed(2)}, ` +
        `keywords: [${b.keywords.join(", ")}], connections: [${b.connections.join(", ")}])`,
    )
    .join("\n");

  const prompt = `You are maintaining an attractor — a persistent topological memory structure that tracks how ${subject}'s interests, projects, and modes of engagement evolve across conversations. Each "basin" represents a mode of thinking/engagement with a weight indicating how active/relevant it currently is. Basins are not just topics — they're energy states that conversations orbit.

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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      temperature: 0.3,
      system: prompt,
      messages: [{ role: "user", content: "Generate the attractor update for this conversation." }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const result = (await response.json()) as { content: Array<{ type: string; text: string }> };
  const text = result.content[0]?.text ?? "";
  const clean = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const parsed = JSON.parse(clean) as AttractorUpdate;

  // Defensive normalization -- the model is not trusted to return well-formed shapes.
  if (!Array.isArray(parsed.basin_updates)) parsed.basin_updates = [];
  if (!Array.isArray(parsed.new_connections)) parsed.new_connections = [];
  if (!Array.isArray(parsed.emerging_patterns)) parsed.emerging_patterns = [];
  if (typeof parsed.phase_shift !== "boolean") parsed.phase_shift = false;
  for (const bu of parsed.basin_updates) {
    bu.weight_delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, bu.weight_delta));
  }

  return parsed;
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

  const arrowFor = (b: Basin): string => {
    const t = b.trajectory;
    if (t.length < 2) return "→";
    const [prev, last] = [t[t.length - 2], t[t.length - 1]];
    if (last > prev) return "↑";
    if (last < prev) return "↓";
    return "→";
  };

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
