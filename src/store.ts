import type { AttractorState, HistorySnapshot, Provenance } from "./types";

/**
 * Where attractor state lives.
 *
 * Two implementations ship: a JSON file for local runs, and Cloudflare KV for
 * the hosted Worker. The model doesn't know or care which -- `applyUpdate` is
 * a pure function over plain state, so the safeguards travel with it.
 */
export interface Store {
  load(): Promise<AttractorState | null>;
  /** `by` records which engine and model produced this state, when known. */
  save(state: AttractorState, by?: Provenance): Promise<void>;
  history(): Promise<HistorySnapshot[]>;
}

const KV_STATE = "attractor:state";
const KV_HISTORY = "attractor:history";

/** Snapshots kept. This is a trend line, not an archive. */
const MAX_HISTORY = 10;

function snapshot(state: AttractorState, by?: Provenance): HistorySnapshot {
  return {
    timestamp: state.lastUpdated,
    basins: state.basins.map((b) => ({ id: b.id, weight: b.weight })),
    ...(by ? { model: by.model, engine: by.engine } : {}),
  };
}

// === Cloudflare KV ===

export class KvStore implements Store {
  constructor(private kv: KVNamespace) {}

  async load(): Promise<AttractorState | null> {
    const raw = await this.kv.get(KV_STATE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AttractorState;
    } catch {
      return null;
    }
  }

  async history(): Promise<HistorySnapshot[]> {
    const raw = await this.kv.get(KV_HISTORY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as HistorySnapshot[];
    } catch {
      return [];
    }
  }

  async save(state: AttractorState, by?: Provenance): Promise<void> {
    await this.kv.put(KV_STATE, JSON.stringify(state));
    const history = await this.history();
    history.push(snapshot(state, by));
    await this.kv.put(KV_HISTORY, JSON.stringify(history.slice(-MAX_HISTORY)));
  }
}

// Convenience wrappers so the Worker routes read the same as before.
export const getAttractorState = (kv: KVNamespace) => new KvStore(kv).load();
export const saveAttractorState = (kv: KVNamespace, state: AttractorState) =>
  new KvStore(kv).save(state);

// === Local JSON file ===

/**
 * State and history in one file, default ~/.attractor/state.json.
 *
 * Node-only: imports are dynamic so this module stays loadable in the Worker,
 * where `node:fs` doesn't exist and this class is never constructed.
 */
export class FileStore implements Store {
  constructor(private path: string) {}

  static defaultPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ".";
    return `${home}/.attractor/state.json`;
  }

  private async read(): Promise<{ state: AttractorState | null; history: HistorySnapshot[] }> {
    const { readFile } = await import("node:fs/promises");

    // Absent and damaged are different facts with different remedies: one means
    // "seed it", the other means "look at this file before you overwrite it".
    // Collapsing them into `null` invites the CLI to offer a fresh seed on top
    // of recoverable data.
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { state: null, history: [] };
      }
      throw new Error(`Could not read ${this.path}: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const parsed = JSON.parse(raw) as { state: AttractorState; history?: HistorySnapshot[] };
      return { state: parsed.state ?? null, history: parsed.history ?? [] };
    } catch {
      throw new Error(
        `${this.path} exists but is not valid JSON. It has not been modified — ` +
          `inspect or move it before seeding, or a fresh seed will overwrite it.`,
      );
    }
  }

  async load(): Promise<AttractorState | null> {
    return (await this.read()).state;
  }

  async history(): Promise<HistorySnapshot[]> {
    return (await this.read()).history;
  }

  async save(state: AttractorState, by?: Provenance): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { history } = await this.read();
    history.push(snapshot(state, by));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      JSON.stringify({ state, history: history.slice(-MAX_HISTORY) }, null, 2),
      "utf8",
    );
  }
}
