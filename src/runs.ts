import type { RunRecord } from "./types";

/**
 * An append-only log of every update the attractor has generated.
 *
 * JSON Lines, one record per line, because it needs no dependency, survives a
 * partial write, and can be read with `grep` or `jq` when this tool isn't the
 * right thing to reach for.
 *
 * Transcript text is never written here -- only a hash and a short preview.
 * The hash is the join key: it is what lets you ask "what did every model make
 * of *this* conversation", including models that did not exist when it happened.
 */
export class RunLog {
  constructor(private path: string) {}

  static defaultPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ".";
    return `${home}/.attractor/runs.jsonl`;
  }

  /** Stable id for a conversation, so runs of it can be lined up later. */
  static async hashTranscript(text: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(text).digest("hex").slice(0, 12);
  }

  static preview(text: string, length = 120): string {
    return text.replace(/\s+/g, " ").trim().slice(0, length);
  }

  async append(record: RunRecord): Promise<void> {
    const { mkdir, appendFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(record) + "\n", "utf8");
  }

  async all(): Promise<RunRecord[]> {
    const { readFile } = await import("node:fs/promises");
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch {
      return [];
    }
    const records: RunRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as RunRecord);
      } catch {
        continue; // tolerate a torn final line
      }
    }
    return records;
  }

  /** Runs grouped by conversation, newest conversation first. */
  async byTranscript(filter = ""): Promise<Map<string, RunRecord[]>> {
    const grouped = new Map<string, RunRecord[]>();
    for (const r of await this.all()) {
      if (filter && !r.transcript.startsWith(filter) && !r.model.includes(filter)) continue;
      const existing = grouped.get(r.transcript);
      if (existing) existing.push(r);
      else grouped.set(r.transcript, [r]);
    }
    return grouped;
  }
}
