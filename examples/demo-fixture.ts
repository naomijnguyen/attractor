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
  {
    label: "Systems architecture",
    description: "How components fit together, and where the trust boundary goes",
    keywords: ["workers", "kv", "queues"],
  },
  {
    label: "Context and memory",
    description: "State that outlives a single conversation",
    keywords: ["persistence", "summaries"],
  },
  {
    label: "Developer tooling",
    description: "CLIs and scaffolds that make the next project cheaper",
    keywords: ["cli", "bash"],
  },
  {
    label: "Provenance and documentation",
    description: "Which copy is authoritative, and why a decision was made",
    keywords: ["canonical", "headers"],
  },
]);

// These mirror a real week rather than a tidy demo. The shape matters more
// than the numbers: one basin has to run away with it, one has to fade, and
// the rest sit in between -- otherwise every node renders the same size and
// the same colour, and a visualization of divergence shows no divergence.
// Context and memory is never updated on purpose, so its decay toward 0.3 is
// visible rather than described.
const updates: AttractorUpdate[] = [
  {
    basin_updates: [
      { id: "provenance-and-documentation", weight_delta: 0.25, new_keywords: ["superseded", "duplicates"] },
      { id: "developer-tooling", weight_delta: -0.1 },
    ],
    new_connections: [],
    emerging_patterns: ["which copy is live"],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [
      { id: "systems-architecture", weight_delta: 0.3, new_keywords: ["cors", "same-origin"] },
      { id: "provenance-and-documentation", weight_delta: -0.15 },
    ],
    new_connections: [
      { from: "systems-architecture", to: "provenance-and-documentation", reason: "documenting why CORS was designed out" },
    ],
    emerging_patterns: ["constraints as information"],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [
      { id: "systems-architecture", weight_delta: 0.3, new_keywords: ["proxy", "secrets"] },
      { id: "provenance-and-documentation", weight_delta: -0.1 },
    ],
    new_connections: [],
    emerging_patterns: [],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [
      { id: "developer-tooling", weight_delta: 0.25, new_keywords: ["vite", "fixtures"] },
      { id: "systems-architecture", weight_delta: 0.15 },
    ],
    new_connections: [
      { from: "developer-tooling", to: "systems-architecture", reason: "the demo mirrors the deployment on purpose" },
    ],
    emerging_patterns: ["make it runnable"],
    new_basin: null,
    phase_shift: false,
  },
  {
    basin_updates: [
      { id: "developer-tooling", weight_delta: 0.1 },
      { id: "systems-architecture", weight_delta: 0.1 },
    ],
    new_connections: [],
    emerging_patterns: ["make it runnable", "provenance"],
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
