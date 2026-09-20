/*
 * Title        publish.ts
 * Purpose      Decides what part of the local attractor state is safe to make
 *              public, and renders the diff you approve before it ships.
 * Author       Jennifer Naomi Nguyen
 * Canonical    this file
 * Updated      2026-09-20
 * Dependencies none (the write itself happens in cli.ts via wrangler)
 */
import type { AttractorState, Basin, HistorySnapshot } from "./types";

/**
 * The publish filter.
 *
 * The local state is derived from real conversations; the published state goes
 * on a portfolio anyone can read. Those are different audiences, so the gap
 * between them is a deliberate decision rather than an accident of what the
 * renderer happens to display.
 *
 * Must return a value the site's <AttractorView /> can still render: basins
 * with `id`, `label`, `weight`, `trajectory` and `connections` are load-bearing
 * for the force layout. Anything else is yours to keep or drop.
 */
export function publishable(state: AttractorState): AttractorState {
  // Everything ships, and that is a decision rather than a default.
  //
  // Checked against the real state on 2026-09-20: the update model never sees a
  // transcript -- only the 1-2 sentence summary Haiku produces -- so keywords
  // arrive abstract by construction. Four to five consolidation passes then
  // ground out what specifics remained. Nothing in the 44 live keywords names a
  // client, a person, or a private topic; they are all technique-level
  // ("canonical-source-of-record", "keyword-set-distillation").
  //
  // The one thing genuinely disclosed is volume -- conversationCount per basin
  // and meta.totalConversations. Accepted knowingly: on a portfolio, evidence
  // of sustained use is the point.
  //
  // Revisit if a basin ever picks up a concrete proper noun. The diff printed
  // by `attractor push` is where that would surface, which is why the push path
  // shows keyword additions individually instead of summarising them.
  return state;
}

/** History is only weights per basin -- no text -- so it travels as-is. */
export function publishableHistory(history: HistorySnapshot[]): HistorySnapshot[] {
  return history;
}

// === Diff rendering ===

function basinMap(state: AttractorState | null): Map<string, Basin> {
  return new Map((state?.basins ?? []).map((b) => [b.id, b]));
}

function setDiff(before: string[] = [], after: string[] = []) {
  const had = new Set(before);
  const has = new Set(after);
  return {
    added: after.filter((k) => !had.has(k)),
    removed: before.filter((k) => !has.has(k)),
  };
}

/**
 * What this push would change on the live site.
 *
 * Compares against what is actually published right now rather than against
 * the previous local state: those drift apart the moment a push is skipped,
 * and the number that matters is what the public would see change.
 */
export function describeDiff(live: AttractorState | null, next: AttractorState): string {
  const lines: string[] = [];
  if (!live) lines.push("Nothing published yet -- this is the first push.");

  const before = basinMap(live);
  const seen = new Set<string>();

  for (const basin of next.basins) {
    seen.add(basin.id);
    const old = before.get(basin.id);
    if (!old) {
      lines.push(`+ ${basin.label}  (new basin, weight ${basin.weight.toFixed(2)})`);
      if (basin.keywords.length) lines.push(`    keywords: ${basin.keywords.join(", ")}`);
      continue;
    }
    const parts: string[] = [];
    // 0.005 because weights render to two decimals -- anything smaller is a
    // change nobody can see, and listing it would bury the real movement.
    if (Math.abs(basin.weight - old.weight) > 0.005) {
      const arrow = basin.weight > old.weight ? "^" : "v";
      parts.push(`weight ${old.weight.toFixed(2)} ${arrow} ${basin.weight.toFixed(2)}`);
    }
    const kw = setDiff(old.keywords, basin.keywords);
    if (kw.added.length) parts.push(`+kw ${kw.added.join(", ")}`);
    if (kw.removed.length) parts.push(`-kw ${kw.removed.join(", ")}`);
    const conn = setDiff(old.connections, basin.connections);
    if (conn.added.length) parts.push(`+link ${conn.added.join(", ")}`);
    if (old.description !== basin.description) parts.push("description changed");
    if (parts.length) lines.push(`~ ${basin.label}  ${parts.join("  ")}`);
  }

  for (const [id, basin] of before) {
    if (!seen.has(id)) lines.push(`- ${basin.label}  (removed)`);
  }

  const meta: string[] = [];
  if (live && live.phase !== next.phase) meta.push(`phase ${live.phase} -> ${next.phase}`);
  if (!live || Math.abs(live.entropy - next.entropy) > 0.005) {
    meta.push(`entropy ${live ? live.entropy.toFixed(3) + " -> " : ""}${next.entropy.toFixed(3)}`);
  }
  const em = setDiff(live?.emerging, next.emerging);
  if (em.added.length) meta.push(`+emerging ${em.added.join(", ")}`);
  if (em.removed.length) meta.push(`-emerging ${em.removed.join(", ")}`);
  if (meta.length) lines.push(`  ${meta.join("   ")}`);

  return lines.length ? lines.join("\n") : "No visible change. Nothing to push.";
}

/** True when describeDiff found nothing worth shipping. */
export function isNoop(live: AttractorState | null, next: AttractorState): boolean {
  return describeDiff(live, next).startsWith("No visible change");
}
