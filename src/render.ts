import type { SessionInfo } from "./sessions";
import type { AttractorState, AttractorUpdate, HistorySnapshot } from "./types";

/**
 * Terminal rendering. Matches the output of the bash `cli/attractor` viewer so
 * local and hosted runs look identical.
 */

const BAR_WIDTH = 30;
const HISTORY_BAR = 10;
/** 4-char percentage + "% " + bar + 2-char gutter. */
const HISTORY_COL = HISTORY_BAR + 8;

function bar(weight: number, width = BAR_WIDTH): string {
  const filled = Math.max(0, Math.min(width, Math.round(weight * width)));
  return "#".repeat(filled) + ".".repeat(width - filled);
}

function trendArrow(trajectory: number[]): string {
  if (trajectory.length < 2) return "";
  const diff = trajectory[trajectory.length - 1] - trajectory[trajectory.length - 2];
  if (diff > 0.05) return "^^";
  if (diff > 0) return "^";
  if (diff < -0.05) return "v";
  if (diff < 0) return "~";
  return "=";
}

export function renderState(state: AttractorState): string {
  const basins = [...state.basins].sort((a, b) => b.weight - a.weight);
  if (basins.length === 0) return "  Attractor has no basins yet.";

  const w = Math.max(...basins.map((b) => b.label.length));
  const out: string[] = [
    "",
    "  Attractor",
    "  " + "=".repeat(40),
    `  Phase ${state.phase} | Entropy: ${state.entropy.toFixed(3)} | ${state.meta.recentTrajectory.toUpperCase()}`,
    `  Updates: ${state.updateCount} | Dominant: ${state.meta.dominantBasin}`,
    "",
  ];

  for (const b of basins) {
    const pct = (b.weight * 100).toFixed(1).padStart(5);
    const arrow = trendArrow(b.trajectory).padEnd(3);
    const plural = b.conversationCount === 1 ? "convo" : "convos";
    out.push(`  ${b.label.padEnd(w)} ${pct}% ${arrow}[${bar(b.weight)}]  (${b.conversationCount} ${plural})`);
    if (b.connections.length > 0) {
      out.push(`  ${" ".repeat(w)} -> ${b.connections.join(", ")}`);
    }
  }

  if (state.emerging.length > 0) {
    out.push("", "  Emerging patterns:");
    for (const e of state.emerging) out.push(`    * ${e}`);
  }

  const top = basins[0];
  if (top.keywords.length > 0) {
    out.push("", `  Top keywords (${top.label}):`, `    ${top.keywords.slice(0, 6).join(", ")}`);
  }
  out.push("");
  return out.join("\n");
}

export function renderHistory(history: HistorySnapshot[]): string {
  if (history.length === 0) return "No history yet.";

  const ids = history[0].basins.map((b) => b.id);
  const head = ids
    .map((id) => {
      let label = id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      if (label.length > HISTORY_COL - 1) label = label.slice(0, HISTORY_COL - 2) + ".";
      return label.padStart(HISTORY_COL);
    })
    .join("");

  const out = ["Timestamp".padEnd(18) + head, "-".repeat(18 + HISTORY_COL * ids.length)];

  for (const snap of history) {
    const ts = snap.timestamp.slice(0, 16).replace("T", " ");
    const weights = new Map(snap.basins.map((b) => [b.id, b.weight]));
    const row = ids
      .map((id) => {
        const weight = weights.get(id) ?? 0;
        return `${(weight * 100).toFixed(0).padStart(4)}% ${bar(weight, HISTORY_BAR)}  `;
      })
      .join("");
    out.push(ts.padEnd(18) + row);
  }
  return out.join("\n");
}

// === Claude Code sessions ===


export function renderSessions(sessions: SessionInfo[]): string {
  const w = Math.min(40, Math.max(...sessions.map((s) => s.project.length)));
  const out = ["", `  ${sessions.length} session(s), newest first`, ""];
  for (const s of sessions.slice(0, 25)) {
    const project = (s.project.length > w ? s.project.slice(0, w - 1) + "." : s.project).padEnd(w);
    const when = s.modified.toISOString().slice(0, 16).replace("T", " ");
    out.push(`  ${when}  ${project}  ${String(s.messages).padStart(4)} msgs  ${s.id.slice(0, 8)}`);
  }
  if (sessions.length > 25) out.push(`  ... and ${sessions.length - 25} more`);
  out.push("");
  return out.join("\n");
}

// === Model comparison ===

export interface ComparisonResult {
  model: string;
  summary?: string;
  vibes?: string[];
  update?: AttractorUpdate;
  next?: AttractorState;
  error?: string;
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

/**
 * Side-by-side view of what each model would do to the same state.
 * Read-only: nothing here is saved.
 */
export function renderComparison(before: AttractorState, results: ComparisonResult[]): string {
  const out = [
    "",
    `  Same conversation, ${results.length} model(s). Nothing saved.`,
    `  Starting entropy ${before.entropy.toFixed(3)}, ${before.meta.recentTrajectory}`,
    "",
  ];

  for (const r of results) {
    out.push(`  ${"─".repeat(70)}`, `  ${r.model}`, "");
    if (r.error || !r.update || !r.next) {
      out.push(`    failed: ${r.error ?? "no update returned"}`, "");
      continue;
    }

    out.push(wrap(r.summary ?? "", 66, "    "), "");
    out.push(`    vibes: ${r.vibes?.join(", ") || "none"}`, "");

    const deltas = r.update.basin_updates
      .map((bu) => {
        const label = before.basins.find((b) => b.id === bu.id)?.label ?? bu.id;
        const sign = bu.weight_delta >= 0 ? "+" : "";
        return `      ${label.padEnd(22)} ${sign}${bu.weight_delta.toFixed(2)}`;
      })
      .join("\n");
    out.push(`    basin deltas (${r.update.basin_updates.length}):`, deltas || "      none", "");

    if (r.update.new_connections.length > 0) {
      out.push("    connections proposed:");
      for (const c of r.update.new_connections) out.push(`      ${c.from} <-> ${c.to}`);
      out.push("");
    }
    if (r.update.emerging_patterns.length > 0) {
      out.push("    emerging:", ...r.update.emerging_patterns.map((e) => `      * ${e}`), "");
    }
    if (r.update.new_basin) out.push(`    new basin proposed: ${r.update.new_basin.label}`, "");

    out.push(
      `    result: entropy ${r.next.entropy.toFixed(3)} ` +
        `(${(r.next.entropy - before.entropy >= 0 ? "+" : "")}${(r.next.entropy - before.entropy).toFixed(3)}), ` +
        `${r.next.meta.recentTrajectory}, dominant ${r.next.meta.dominantBasin}`,
      "",
    );
  }
  return out.join("\n");
}
