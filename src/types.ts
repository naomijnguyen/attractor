// === Attractor types ===

/** Cloudflare Worker bindings. See wrangler.toml. */
export interface Env {
  /** KV namespace holding `attractor:state` and `attractor:history`. */
  MODEL_KV: KVNamespace;
  /** Queue for background attractor updates. */
  JOBS: Queue<AttractorJob>;
  /** Anthropic API key. Set via `wrangler secret put ANTHROPIC_API_KEY`. */
  ANTHROPIC_API_KEY: string;
  /**
   * Shared bearer token guarding every route.
   * Set via `wrangler secret put ATTRACTOR_TOKEN`. Requests fail closed if unset.
   */
  ATTRACTOR_TOKEN: string;
  /** Override the model used to summarize transcripts. */
  ATTRACTOR_SUMMARY_MODEL?: string;
  /** Override the model used to generate attractor updates. */
  ATTRACTOR_UPDATE_MODEL?: string;
  /**
   * Whose engagement this attractor models. Injected into the update prompt
   * and the system-prompt context block. Defaults to "the user".
   */
  ATTRACTOR_SUBJECT?: string;
}

export interface AttractorJob {
  type: "attractor_update";
  conversationId: string;
}

/**
 * A basin is an energy state -- a mode of engagement, not a topic.
 * Conversations orbit basins; they don't belong to them.
 */
export interface Basin {
  /** Slug derived from `label`. */
  id: string;
  label: string;
  /** What this mode of engagement is. */
  description: string;
  /** How active this basin currently is. Clamped to [0.05, 1]. */
  weight: number;
  /** Max 10, evolving over time. */
  keywords: string[];
  /** IDs of basins this one bridges to. Symmetric. */
  connections: string[];
  /** Rolling weight history, max 20 points. */
  trajectory: number[];
  lastActive: string;
  conversationCount: number;
}

export type Trajectory = "stable" | "converging" | "diverging" | "restructuring";

export interface AttractorState {
  basins: Basin[];
  /** Increments only on fundamental changes of direction. Rare. */
  phase: number;
  /** Normalized Shannon entropy. 0 = one basin dominates, 1 = evenly spread. */
  entropy: number;
  /** Concepts that don't yet fit any basin. */
  emerging: string[];
  lastUpdated: string;
  updateCount: number;
  meta: {
    totalConversations: number;
    dominantBasin: string;
    recentTrajectory: Trajectory;
  };
}

export interface BasinSeed {
  label: string;
  description: string;
  keywords: string[];
}

export interface BasinUpdate {
  id: string;
  /** Clamped to [-0.3, 0.3] on ingest. */
  weight_delta: number;
  new_keywords?: string[];
  remove_keywords?: string[];
}

export interface AttractorUpdate {
  basin_updates: BasinUpdate[];
  new_connections: Array<{ from: string; to: string; reason?: string }>;
  emerging_patterns: string[];
  new_basin: BasinSeed | null;
  phase_shift: boolean;
}

export interface HistorySnapshot {
  timestamp: string;
  basins: Array<{ id: string; weight: number }>;
  /** Which model produced the update that led here, when known. */
  model?: string;
  /** "cli" or "api". */
  engine?: string;
}

/** What produced an update. Recorded so runs can be attributed later. */
export interface Provenance {
  engine: string;
  model: string;
}

/**
 * One generated update, appended to the run log.
 *
 * The transcript itself is never stored -- only a hash and a short preview.
 * The hash is what lets you line up runs of the same conversation across
 * models and across time, which is the point: when a model changes underneath
 * you, replaying a known transcript shows whether its behaviour moved.
 */
export interface RunRecord {
  ts: string;
  engine: string;
  model: string;
  /** SHA-256 of the transcript, truncated. Identifies the conversation. */
  transcript: string;
  transcriptChars: number;
  preview: string;
  summary: string;
  vibes: string[];
  update: AttractorUpdate;
  entropyBefore: number;
  entropyAfter: number;
  trajectoryAfter: Trajectory;
  /** false for `compare` legs, which are dry runs. */
  applied: boolean;
}
