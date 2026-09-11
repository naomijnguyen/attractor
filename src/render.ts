import type { AttractorState, HistorySnapshot } from "./types";

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
