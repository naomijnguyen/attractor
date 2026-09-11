#!/usr/bin/env node
/**
 * Local attractor CLI.
 *
 * Runs the whole loop on your machine: state in a JSON file, updates generated
 * by `claude -p` using the login Claude Code already has. No API key, no
 * Cloudflare account.
 *
 *   attractor seed <file.json>     initialize basins
 *   attractor ingest <file>        feed a transcript (or - for stdin)
 *   attractor ingest --session     feed your latest Claude Code session
 *   attractor sessions [filter]    list Claude Code sessions
 *   attractor compare <file>       same conversation, several models, no writes
 *   attractor                      show current state
 *   attractor history              show weight evolution
 *   attractor context              print the system-prompt block
 */
import { readFile } from "node:fs/promises";
import { applyUpdate, buildAttractorContext, createInitialState } from "./model";
import { ClaudeCliEngine, DEFAULT_MODELS, type Engine, type ModelConfig } from "./engine";
import { renderComparison, renderHistory, renderSessions, renderState } from "./render";
import { listSessions, parseSession, toTranscript } from "./sessions";
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

async function summarize(engine: Engine, transcript: string, model: string) {
  const capped = transcript.length > 40000 ? transcript.slice(-40000) : transcript;
  const raw = await engine.complete(SUMMARY_PROMPT + capped, model);
  const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  try {
    const parsed = JSON.parse(clean) as { summary: string; vibes?: string[] };
    return { summary: parsed.summary, vibes: parsed.vibes ?? [] };
  } catch {
    fail(`Could not parse a summary from the model's reply:\n${clean.slice(0, 300)}`);
  }
}

/**
 * Resolve a transcript from a file, stdin, or a Claude Code session.
 * `--session` alone takes the most recent; `--session <filter>` takes the most
 * recent whose project directory matches.
 */
async function resolveTranscript(arg: string | undefined, extra: string | undefined): Promise<string> {
  if (!arg) fail("Need a transcript: a file path, - for stdin, or --session");

  if (arg === "--session") {
    const sessions = await listSessions(extra ?? "");
    if (sessions.length === 0) {
      fail(extra ? `No Claude Code sessions matching "${extra}".` : "No Claude Code sessions found.");
    }
    const pick = sessions[0];
    const { readFile } = await import("node:fs/promises");
    process.stderr.write(`Using ${pick.project}/${pick.id} (${pick.messages} messages)\n`);
    return toTranscript(parseSession(await readFile(pick.path, "utf8")));
  }

  if (arg === "-") return new Response(process.stdin as unknown as ReadableStream).text();

  const raw = await readFile(arg, "utf8");
  // A .jsonl path is a session file, not prose.
  return arg.endsWith(".jsonl") ? toTranscript(parseSession(raw)) : raw;
}

async function main() {
  const [command = "show", arg, extra] = process.argv.slice(2);
  const store = new FileStore(process.env.ATTRACTOR_STATE || FileStore.defaultPath());
  const subject = process.env.ATTRACTOR_SUBJECT || "the user";
  const models: ModelConfig = {
    summary: process.env.ATTRACTOR_SUMMARY_MODEL || DEFAULT_MODELS.summary,
    update: process.env.ATTRACTOR_UPDATE_MODEL || DEFAULT_MODELS.update,
  };

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
      if (!arg) fail("Usage: attractor ingest <transcript.txt | --session [filter] | ->");
      if (!(await ClaudeCliEngine.available())) {
        fail("`claude` not found on PATH. Local mode drives the Claude Code CLI —\ninstall it, or use the hosted Worker with an API key.");
      }
      const state = await requireState(store);
      const transcript = await resolveTranscript(arg, extra);
      if (!transcript.trim()) fail("Transcript is empty.");

      const engine = new ClaudeCliEngine(subject, "claude", undefined, models);
      process.stderr.write("Summarizing... ");
      const { summary, vibes } = await summarize(engine, transcript, models.summary);
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

    case "sessions": {
      const sessions = await listSessions(arg ?? "");
      if (sessions.length === 0) fail(arg ? `No sessions matching "${arg}".` : "No Claude Code sessions found.");
      console.log(renderSessions(sessions));
      break;
    }

    case "compare": {
      if (!(await ClaudeCliEngine.available())) {
        fail("`claude` not found on PATH. compare drives the Claude Code CLI.");
      }
      const state = await requireState(store);
      const transcript = await resolveTranscript(arg, extra);
      if (!transcript.trim()) fail("Transcript is empty.");

      const compareModels = (
        process.env.ATTRACTOR_COMPARE_MODELS || `${models.summary},${models.update}`
      )
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);

      const results = [];
      for (const model of compareModels) {
        process.stderr.write(`${model}... `);
        const engine = new ClaudeCliEngine(subject, "claude", model);
        try {
          const { summary, vibes } = await summarize(engine, transcript, model);
          const update = await engine.generateUpdate(state, summary, vibes);
          results.push({ model, summary, vibes, update, next: applyUpdate(state, update) });
        } catch (err) {
          results.push({ model, error: err instanceof Error ? err.message : String(err) });
        }
      }
      process.stderr.write("done.\n");
      // Read-only by design: compare shows what each model *would* do.
      console.log(renderComparison(state, results));
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
      fail(`Unknown command "${command}". Try: seed, ingest, sessions, compare, show, history, context`);
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
