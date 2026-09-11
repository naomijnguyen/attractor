#!/usr/bin/env node
/**
 * Local attractor CLI.
 *
 * Runs the whole loop on your machine: state in a JSON file, updates generated
 * by `claude -p` using the login Claude Code already has. No API key, no
 * Cloudflare account.
 *
 *   attractor seed <file.json>   initialize basins
 *   attractor ingest <file>      feed a transcript (or - for stdin)
 *   attractor                    show current state
 *   attractor history            show weight evolution
 *   attractor context            print the system-prompt block
 */
import { readFile } from "node:fs/promises";
import { applyUpdate, buildAttractorContext, createInitialState } from "./model";
import { ClaudeCliEngine, SUMMARY_MODEL, type Engine } from "./engine";
import { renderHistory, renderState } from "./render";
import { FileStore } from "./store";
import type { BasinSeed } from "./types";

const SUMMARY_PROMPT = `Analyze this conversation and return a JSON object with exactly two fields:
1. "summary": A concise 1-2 sentence summary of what was discussed and accomplished.
2. "vibes": An array of 1-4 vibe tags describing the conversational energy. Choose from: playful, serious, technical, philosophical, creative, nerdy, focused, casual, witty, warm, chaotic, chill, intense, curious, supportive, sarcastic, brainstormy, deep.

Return ONLY valid JSON, no markdown formatting, no explanation.

Conversation:
`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function requireState(store: FileStore) {
  const state = await store.load();
  if (!state) fail("No attractor yet. Seed one first:\n  attractor seed basins.json");
  return state;
}

async function summarize(engine: Engine, transcript: string) {
  const capped = transcript.length > 40000 ? transcript.slice(-40000) : transcript;
  const raw = await engine.complete(SUMMARY_PROMPT + capped, SUMMARY_MODEL);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(clean) as { summary: string; vibes?: string[] };
    return { summary: parsed.summary, vibes: parsed.vibes ?? [] };
  } catch {
    fail(`Could not parse a summary from the model's reply:\n${clean.slice(0, 300)}`);
  }
}

async function main() {
  const [command = "show", arg] = process.argv.slice(2);
  const store = new FileStore(process.env.ATTRACTOR_STATE || FileStore.defaultPath());
  const subject = process.env.ATTRACTOR_SUBJECT || "the user";

  switch (command) {
    case "seed": {
      if (!arg) fail("Usage: attractor seed <basins.json>\nA JSON array of { label, description, keywords }.");
      const seeds = JSON.parse(await readFile(arg, "utf8")) as BasinSeed[];
      if (!Array.isArray(seeds) || seeds.length === 0) fail("Expected a non-empty JSON array of basins.");
      if (await store.load()) fail("Already seeded. Delete the state file to start over.");
      const state = createInitialState(seeds);
      await store.save(state);
      console.log(`Seeded ${state.basins.length} basins.`);
      console.log(renderState(state));
      break;
    }

    case "ingest": {
      if (!arg) fail("Usage: attractor ingest <transcript.txt>   (or - for stdin)");
      if (!(await ClaudeCliEngine.available())) {
        fail("`claude` not found on PATH. Local mode drives the Claude Code CLI —\ninstall it, or use the hosted Worker with an API key.");
      }
      const state = await requireState(store);
      const transcript =
        arg === "-"
          ? await new Response(process.stdin as unknown as ReadableStream).text()
          : await readFile(arg, "utf8");
      if (!transcript.trim()) fail("Transcript is empty.");

      const engine = new ClaudeCliEngine(subject);
      process.stderr.write("Summarizing... ");
      const { summary, vibes } = await summarize(engine, transcript);
      process.stderr.write("generating update... ");
      const update = await engine.generateUpdate(state, summary, vibes);
      const next = applyUpdate(state, update);
      await store.save(next);
      process.stderr.write("done.\n\n");

      console.log(`  ${summary}`);
      console.log(`  vibes: ${vibes.join(", ") || "none"}`);
      console.log(`  basins touched: ${update.basin_updates.length}, new connections: ${update.new_connections.length}`);
      if (update.new_basin) console.log(`  new basin: ${update.new_basin.label}`);
      console.log(renderState(next));
      break;
    }

    case "history":
      console.log(renderHistory(await store.history()));
      break;

    case "context":
      console.log(buildAttractorContext(await requireState(store), subject));
      break;

    case "show":
      console.log(renderState(await requireState(store)));
      break;

    default:
      fail(`Unknown command "${command}". Try: seed, ingest, show, history, context`);
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
