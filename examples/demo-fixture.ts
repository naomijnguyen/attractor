/**
 * Title        Demo fixture generator for the web visualization
 * Purpose      Drives the real engine offline and writes web/demo-data.json, so
 *              `npm run web` can show the visualization with no KV namespace,
 *              no API key and no network. Generated rather than hand-written so
 *              the fixture cannot drift from the types.
 * Author       Jennifer Naomi Nguyen
 * Canonical    /Users/jennifer/Bootwitch/Projects/attractor/examples/demo-fixture.ts
 * Updated      2026-09-19
 * Dependencies none at runtime; run via `npm run web:fixture`
 */
import { writeFileSync } from "node:fs";
import { applyUpdate, createInitialState } from "../src/model";
import type { AttractorUpdate, HistorySnapshot } from "../src/types";

let state = createInitialState([
  { label: "Research methodology", description: "Study design and controls", keywords: ["assay", "controls"] },
  { label: "Systems architecture", description: "How components fit together", keywords: ["api", "workers"] },
  { label: "Creative writing", description: "Prose and voice", keywords: ["draft", "voice"] },
]);

const updates: AttractorUpdate[] = [
  {
    basin_updates: [{ id: "systems-architecture", weight_delta: 0.2, new_keywords: ["kv", "queues"] }],
    new_connections: [],
    emerging_patterns: [],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [
      { id: "systems-architecture", weight_delta: 0.15 },
      { id: "research-methodology", weight_delta: 0.1, new_keywords: ["reproducibility"] },
    ],
    new_connections: [{ from: "systems-architecture", to: "research-methodology", reason: "designing for reproducibility" }],
    emerging_patterns: ["reproducibility"],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [{ id: "systems-architecture", weight_delta: 0.2 }],
    new_connections: [],
    emerging_patterns: ["provenance"],
    new_basin: null,
    phase_shift: false,
  },
];

// Back-date the snapshots so the history panel shows a plausible span rather
// than four timestamps one millisecond apart.
const DAY = 24 * 60 * 60 * 1000;
const start = Date.now() - updates.length * DAY;
const snap = (i: number): HistorySnapshot => ({
  timestamp: new Date(start + i * DAY).toISOString(),
  basins: state.basins.map((b) => ({ id: b.id, weight: b.weight })),
  model: "claude-opus-5",
  engine: "cli",
});

const history: HistorySnapshot[] = [snap(0)];
updates.forEach((u, i) => {
  state = applyUpdate(state, u);
  history.push(snap(i + 1));
});

writeFileSync(
  new URL("../web/demo-data.json", import.meta.url),
  JSON.stringify({ state, history }, null, 2) + "\n"
);
console.log(`demo fixture written: ${state.basins.length} basins, ${history.length} snapshots`);
