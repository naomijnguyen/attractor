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
 *   attractor runs [filter]        every update ever generated, by conversation
 *   attractor                      show current state
 *   attractor history              show weight evolution
 *   attractor context              print the system-prompt block
 */
import { readFile } from "node:fs/promises";
import {
  applyConsolidation,
  applyUpdate,
  basinsNeedingConsolidation,
  buildAttractorContext,
  buildSummaryPrompt,
  createInitialState,
  parseSummary,
} from "./model";
import { ApiEngine, ClaudeCliEngine, consolidateBasin, DEFAULT_MODELS, type Engine, type ModelConfig } from "./engine";
import { renderComparison, renderHistory, renderRuns, renderSessions, renderState } from "./render";
import { listSessions, parseSession, toTranscript } from "./sessions";
import { FileStore } from "./store";
import { RunLog } from "./runs";
import { describeDiff, isNoop, publishable, publishableHistory } from "./publish";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { BasinSeed, RunRecord } from "./types";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function requireState(store: FileStore) {
  const state = await store.load();
  if (!state) fail("No attractor yet. Seed one first:\n  attractor seed basins.json");
  return state;
}

// Throws rather than exits: `compare` needs one leg's failure to be one leg's
// failure, not the end of the run. The prompt, the cap and the parser are all
// shared with the hosted path so the two cannot drift.
async function summarize(engine: Engine, transcript: string, model: string) {
  return parseSummary(await engine.complete(buildSummaryPrompt(transcript), model));
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
  const runs = new RunLog(process.env.ATTRACTOR_RUNS || RunLog.defaultPath());
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
      const consolidations: Array<{ basin: string; before: string[]; after: string[] }> = [];
      process.stderr.write("Summarizing... ");
      const { summary, vibes } = await summarize(engine, transcript, models.summary).catch((e: unknown) =>
        fail(e instanceof Error ? e.message : String(e)),
      );
      process.stderr.write("generating update... ");
      const update = await engine.generateUpdate(state, summary, vibes);
      let next = applyUpdate(state, update);

      // Abstract any basin that has repeatedly filled its keyword slots.
      // Separate from the update call on purpose: that one answers a local
      // question and never prunes, so eviction by recency was quietly deciding
      // what a basin remembered.
      const due = basinsNeedingConsolidation(next);
      for (const basin of due) {
        process.stderr.write(`consolidating ${basin.label}... `);
        const before = [...basin.keywords];
        const keywords = await consolidateBasin(engine, basin, models.update);
        next = applyConsolidation(next, basin.id, keywords);
        consolidations.push({ basin: basin.label, before, after: keywords });
      }

      await store.save(next, { engine: "cli", model: models.update });
      await runs.append({
        ts: new Date().toISOString(),
        engine: "cli",
        model: models.update,
        transcript: await RunLog.hashTranscript(transcript),
        transcriptChars: transcript.length,
        preview: RunLog.preview(transcript),
        summary,
        vibes,
        update,
        entropyBefore: state.entropy,
        entropyAfter: next.entropy,
        trajectoryAfter: next.meta.recentTrajectory,
        applied: true,
      });
      process.stderr.write("done.\n\n");

      console.log(`  ${summary}`);
      console.log(`  vibes: ${vibes.join(", ") || "none"}`);
      console.log(`  basins touched: ${update.basin_updates.length}, new connections: ${update.new_connections.length}`);
      for (const c of consolidations) {
        console.log(`  consolidated ${c.basin}: ${c.before.length} -> ${c.after.length} keywords`);
        console.log(`    before: ${c.before.join(", ")}`);
        console.log(`    after:  ${c.after.join(", ")}`);
      }
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

      // Legs are "engine:model" pairs. A bare "model" means the local CLI, so
      // the simple case stays simple. With a key present the default also runs
      // each model through the HTTP API -- same prompt, different transport --
      // which is the control for whether the two engines actually agree.
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const defaultLegs = [`cli:${models.summary}`, `cli:${models.update}`].concat(
        apiKey ? [`api:${models.summary}`, `api:${models.update}`] : [],
      );
      const legs = (process.env.ATTRACTOR_COMPARE_MODELS || defaultLegs.join(","))
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((spec) => {
          const [head, ...rest] = spec.split(":");
          return rest.length > 0
            ? { kind: head.toLowerCase(), model: rest.join(":") }
            : { kind: "cli", model: head };
        });

      const transcriptHash = await RunLog.hashTranscript(transcript);
      const results = [];
      for (const { kind, model } of legs) {
        const label = `${kind}:${model}`;
        process.stderr.write(`${label}... `);
        try {
          if (kind !== "cli" && kind !== "api") throw new Error(`Unknown engine "${kind}". Use cli: or api:.`);
          if (kind === "api" && !apiKey) throw new Error("ANTHROPIC_API_KEY is not set, so the api leg cannot run.");

          const one: ModelConfig = { summary: model, update: model };
          const engine: Engine =
            kind === "api"
              ? new ApiEngine(apiKey as string, subject, one)
              : new ClaudeCliEngine(subject, "claude", model, one);

          const { summary, vibes } = await summarize(engine, transcript, model);
          const update = await engine.generateUpdate(state, summary, vibes);
          const next = applyUpdate(state, update);
          results.push({ model: label, summary, vibes, update, next });
          await runs.append({
            ts: new Date().toISOString(),
            engine: kind,
            model,
            transcript: transcriptHash,
            transcriptChars: transcript.length,
            preview: RunLog.preview(transcript),
            summary,
            vibes,
            update,
            entropyBefore: state.entropy,
            entropyAfter: next.entropy,
            trajectoryAfter: next.meta.recentTrajectory,
            applied: false,
          });
        } catch (err) {
          results.push({ model: label, error: err instanceof Error ? err.message : String(err) });
        }
      }
      process.stderr.write("done.\n");
      // Read-only by design: compare shows what each model *would* do.
      console.log(renderComparison(state, results));
      break;
    }

    case "runs": {
      const grouped = await runs.byTranscript(arg ?? "");
      if (grouped.size === 0) {
        fail(arg ? `No runs matching "${arg}".` : "No runs logged yet. Run ingest or compare first.");
      }
      console.log(renderRuns(grouped));
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

    case "push": {
      // Two separate Cloudflare accounts hold the attractor Worker and the
      // portfolio Worker, so a shared KV binding is not available. The state
      // is copied across instead -- which is why there is a review step.
      const namespace = process.env.ATTRACTOR_PUBLISH_NAMESPACE_ID;
      const config = process.env.ATTRACTOR_PUBLISH_CONFIG;
      const site = process.env.ATTRACTOR_PUBLISH_SITE ?? "https://naomijnguyen.com";
      if (!namespace || !config) {
        fail([
          "Set both before pushing:",
          "  ATTRACTOR_PUBLISH_NAMESPACE_ID   the portfolio's ATTRACTOR_KV id",
          "  ATTRACTOR_PUBLISH_CONFIG         path to wrangler.portfolio.local.jsonc",
        ].join("\n"));
      }

      const next = publishable(await requireState(store));
      const live = await fetchLive(site);
      const diff = describeDiff(live, next);
      console.log(`Publishing to ${site}\n`);
      console.log(diff);

      if (isNoop(live, next)) break;
      // --yes is opt-in rather than a prompt so this stays scriptable, but the
      // diff always prints first: you never push something you have not seen.
      if (!process.argv.includes("--yes")) {
        console.log("\nDry run. Re-run with --yes to publish.");
        break;
      }

      const history = publishableHistory(await store.history());
      kvPut(config, namespace, "attractor:state", JSON.stringify(next));
      kvPut(config, namespace, "attractor:history", JSON.stringify(history));
      console.log(`\nPublished. ${site} now serves this state.`);
      break;
    }

    default:
      fail(`Unknown command "${command}". Try: seed, ingest, sessions, compare, runs, show, history, context, push`);
  }
}

/** What the portfolio currently serves, or null if it has never been pushed. */
async function fetchLive(site: string) {
  try {
    const res = await fetch(`${site}/api/attractor`);
    if (!res.ok) return null;
    const body = (await res.json()) as { initialized?: boolean; state?: unknown };
    return body.initialized ? (body.state as Awaited<ReturnType<typeof requireState>>) : null;
  } catch {
    // An unreachable site should not block the diff -- it just means every
    // basin reads as new, which is honest about what the push would do.
    return null;
  }
}

/**
 * Write one KV key through wrangler.
 *
 * Shelling out rather than adding a write endpoint to the portfolio: the site
 * stays read-only in public, and auth is whatever `wrangler login` already
 * granted, so no token has to exist anywhere.
 */
function kvPut(config: string, namespaceId: string, key: string, value: string) {
  // `--remote` exists only from wrangler 4. This repo resolves `npx wrangler`
  // to 3.x, where remote IS the default and passing the flag is a hard yargs
  // error -- which wrangler reports by printing its options list, so it reads
  // like a usage mistake rather than a version mismatch. website-private has
  // 4.x, so the same code path works there and fails here; detect instead of
  // pinning, since the two repos are not going to be upgraded together.
  const version = spawnSync("npx", ["wrangler", "--version"], { encoding: "utf8" }).stdout ?? "";
  const major = Number(/(\d+)\./.exec(version)?.[1] ?? 0);
  const remoteFlag = major >= 4 ? ["--remote"] : [];

  // Via a temp file and --path rather than as a positional argv value: argv is
  // readable by anything that can run `ps`, and the whole attractor state
  // would otherwise sit there for the life of the call. This is not what was
  // breaking the push -- that was the flag above -- it is just the safer form.
  const file = join(tmpdir(), `attractor-${key.replace(/[^a-z0-9]/gi, "-")}-${process.pid}.json`);
  writeFileSync(file, value, { mode: 0o600 });
  try {
    const result = spawnSync(
      "npx",
      ["wrangler", "kv", "key", "put", key, "--path", file, "--namespace-id", namespaceId, "--config", config, ...remoteFlag],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (result.status !== 0) fail(`wrangler failed writing ${key} (wrangler ${version.trim() || "unknown"})`);
  } finally {
    // Runs even when fail() throws -- the state should not outlive the push in
    // a world-readable temp directory.
    rmSync(file, { force: true });
  }
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
