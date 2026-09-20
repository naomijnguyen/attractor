/**
 * A worked example, with no network calls.
 *
 * Seeds three basins, then applies three hand-written updates of the kind the
 * model returns -- so you can watch weights move, connections form, and an
 * untouched basin decay, without an API key.
 *
 *   npm run example
 */
import {
  applyUpdate,
  buildAttractorContext,
  createInitialState,
} from "../src/model";
import type { AttractorUpdate } from "../src/types";

// Seed keywords are not just a starting point -- the update prompt shows the
// model each basin's current keywords, so it imitates their register from the
// first conversation onward. Seeding with single words ("assay", "api") anchors
// the whole history low. These are written at the level of abstraction the
// basins should still be using after a hundred conversations.
let state = createInitialState([
  {
    label: "Research methodology",
    description: "Study design and controls",
    keywords: ["measurement-design", "control-and-comparison"],
  },
  {
    label: "Systems architecture",
    description: "How components fit together",
    keywords: ["where-state-lives", "trust-boundary-placement"],
  },
  {
    label: "Creative writing",
    description: "Prose and voice",
    keywords: ["voice-and-register", "revision-as-selection"],
  },
]);

const row = (label: string) =>
  `${label.padEnd(14)}` +
  state.basins
    .map((b) => `${b.label.split(" ")[0].slice(0, 8).padEnd(9)}${(b.weight * 100).toFixed(0).padStart(3)}%`)
    .join("  ") +
  `   H=${state.entropy.toFixed(3)}  ${state.meta.recentTrajectory}`;

const updates: Array<[string, AttractorUpdate]> = [
  [
    "architecture",
    {
      basin_updates: [{ id: "systems-architecture", weight_delta: 0.2, new_keywords: ["kv", "workers"] }],
      new_connections: [],
      emerging_patterns: [],
      new_basin: null,
      phase_shift: false,
    },
  ],
  [
    "arch + method",
    {
      basin_updates: [
        { id: "systems-architecture", weight_delta: 0.15 },
        { id: "research-methodology", weight_delta: 0.1 },
      ],
      new_connections: [{ from: "systems-architecture", to: "research-methodology", reason: "designing for reproducibility" }],
      emerging_patterns: ["reproducibility"],
      new_basin: null,
      phase_shift: false,
    },
  ],
  [
    "architecture",
    {
      basin_updates: [{ id: "systems-architecture", weight_delta: 0.2 }],
      new_connections: [],
      emerging_patterns: [],
      new_basin: null,
      phase_shift: false,
    },
  ],
];

console.log(row("seed"));
for (const [label, update] of updates) {
  state = applyUpdate(state, update);
  console.log(row(label));
}

const untouched = state.basins.find((b) => b.id === "creative-writing")!;
console.log(
  `\nUntouched basin decayed 0.500 -> ${untouched.weight.toFixed(3)} ` +
    `(drifting toward 0.300, never deleted)`,
);
console.log(`\n${buildAttractorContext(state, "the user")}`);
