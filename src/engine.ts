import { buildConsolidatePrompt, buildUpdatePrompt, parseConsolidation, parseUpdate } from "./model";
import type { AttractorState, AttractorUpdate, Basin, Env } from "./types";

/**
 * What generates an attractor update.
 *
 * Two implementations: the Anthropic HTTP API (needs a pay-as-you-go key), and
 * the local `claude -p` binary (uses whatever Claude Code is signed in as, so
 * a Pro/Team/Max subscription works). Both send the identical prompt from
 * `buildUpdatePrompt` and run the reply through the identical `parseUpdate`,
 * so neither path can quietly drift from the other.
 */
export interface Engine {
  /**
   * The single primitive. Both engines must place `system` and `user` in the
   * same roles, or any comparison between them measures the asymmetry rather
   * than the transport.
   */
  call(system: string, user: string, model: string, maxTokens: number): Promise<string>;
  /** Summarize or otherwise analyze text. Shares ANALYSIS_SYSTEM across engines. */
  complete(prompt: string, model?: string, maxTokens?: number): Promise<string>;
  generateUpdate(state: AttractorState, summary: string, vibes: string[]): Promise<AttractorUpdate>;
}

/** System prompt for analysis calls. Identical on both engines. */
export const ANALYSIS_SYSTEM =
  "You are a text analysis tool. Follow the user's instructions exactly and " +
  "return only what is asked, with no preamble and no commentary.";

/** User message for update generation. The instructions live in the system prompt. */
const UPDATE_INSTRUCTION = "Generate the attractor update for this conversation.";

/**
 * Deadline for one `claude -p` call. Generous: a process start plus a reasoning
 * model on a long transcript is slow, and a false timeout is worse than a wait.
 */
const CLI_TIMEOUT_MS = 120_000;

/**
 * Update generation, defined once and shared.
 *
 * Both engines route through `Engine.call` with the attractor prompt as the
 * system prompt and a fixed short user turn — so the request is equivalent
 * whichever transport carries it.
 */
async function generateVia(
  engine: Engine,
  model: string,
  subject: string,
  state: AttractorState,
  summary: string,
  vibes: string[],
): Promise<AttractorUpdate> {
  const system = buildUpdatePrompt(state, summary, vibes, subject);
  // Generous. Reasoning models spend this budget on a thinking block before
  // emitting any JSON, so 800 truncated Opus 5 mid-string while the CLI path
  // succeeded — `claude -p` has no max-tokens flag and ignores the argument.
  // That asymmetry is exactly what the cli-vs-api comparison exists to catch,
  // and it caught it.
  return parseUpdate(await engine.call(system, UPDATE_INSTRUCTION, model, 4000));
}

/**
 * Which model does which job.
 *
 * Generating an update needs judgement about what a conversation meant;
 * summarizing a transcript does not, so that goes somewhere cheap. Both are
 * overridable — pinned ids age badly, and you may want to try others.
 */
export interface ModelConfig {
  summary: string;
  update: string;
}

export const DEFAULT_MODELS: ModelConfig = {
  summary: "claude-haiku-4-5-20251001",
  update: "claude-opus-5",
};

/** @deprecated Prefer DEFAULT_MODELS; kept so existing callers still resolve. */
export const SUMMARY_MODEL = DEFAULT_MODELS.summary;
export const UPDATE_MODEL = DEFAULT_MODELS.update;

// === Anthropic HTTP API ===

export class ApiEngine implements Engine {
  constructor(
    private apiKey: string,
    private subject = "the user",
    private models: ModelConfig = DEFAULT_MODELS,
  ) {}

  async call(system: string, user: string, model: string, maxTokens: number): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      // No temperature. Two reasons, and the second is the important one:
      // newer models reject it outright (400 "`temperature` is deprecated for
      // this model"), and `claude -p` never exposed it — so sending it here
      // made the two engines diverge on sampling, which is precisely what the
      // cli-vs-api comparison is meant to detect.
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!response.ok) {
      // Surface the API's own message. A bare status code turns a one-line
      // fix into a guessing game.
      let detail = "";
      try {
        const body = (await response.json()) as { error?: { type?: string; message?: string } };
        detail = body.error?.message ? ` — ${body.error.type}: ${body.error.message}` : "";
      } catch {
        detail = "";
      }
      throw new Error(`Claude API error: ${response.status}${detail}`);
    }
    const result = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    // Not content[0]: reasoning models return a thinking block first, which has
    // no `text` field. Take the first actual text block.
    const text = result.content.find((b) => b.type === "text")?.text;
    if (text === undefined) {
      throw new Error(
        `No text block in response (blocks: ${result.content.map((b) => b.type).join(", ") || "none"})`,
      );
    }
    return text;
  }

  async complete(prompt: string, model?: string, maxTokens = 300): Promise<string> {
    return this.call(ANALYSIS_SYSTEM, prompt, model ?? this.models.summary, maxTokens);
  }

  generateUpdate(state: AttractorState, summary: string, vibes: string[]): Promise<AttractorUpdate> {
    return generateVia(this, this.models.update, this.subject, state, summary, vibes);
  }
}

// === Local `claude -p` ===

/**
 * Drives the Claude Code CLI in print mode. No API key: `claude -p` uses the
 * login Claude Code already has, which is the whole point -- a Pro/Team/Max
 * subscriber can run the attractor without pay-as-you-go billing.
 *
 * Slower than the HTTP path (process startup per call), which is fine for a
 * handful of conversations and wrong for hundreds.
 */
export class ClaudeCliEngine implements Engine {
  constructor(
    private subject = "the user",
    private bin = "claude",
    /** Overrides per-call model selection. Used by `attractor compare`. */
    private forceModel?: string,
    private models: ModelConfig = DEFAULT_MODELS,
  ) {}

  /** True if the CLI is on PATH. */
  static async available(bin = "claude"): Promise<boolean> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      const proc = spawn(bin, ["--version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    });
  }

  async complete(prompt: string, model?: string): Promise<string> {
    return this.call(ANALYSIS_SYSTEM, prompt, model ?? this.models.summary, 0);
  }

  /**
   * `maxTokens` is ignored: `claude -p` has no equivalent flag. That is a real
   * difference from the API engine and the only one left.
   */
  async call(system: string, user: string, model: string, _maxTokens: number): Promise<string> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      // Without --model, `claude -p` inherits whatever model the user's Claude
      // Code session is set to -- so summarizing would run on Opus and the two
      // engines would behave differently for the same work.
      // `claude -p` is an agent, not a completion endpoint. Left alone it
      // carries Claude Code's own system prompt, the built-in tools, the
      // working directory, any MCP servers, and the user's CLAUDE.md -- so a
      // capable model may go read your files instead of answering, and two
      // people running this would get summaries shaped by their own notes.
      //
      // Each flag removes one of those, leaving something equivalent to the
      // HTTP API call the hosted engine makes:
      const args = [
        "-p",
        "--model", this.forceModel ?? model,
        "--tools", "",                 // no tools: the only output is text
        "--strict-mcp-config",         // no MCP servers
        "--setting-sources", "",       // no CLAUDE.md, user or project
        "--system-prompt", system,
      ];
      // Without a deadline a hung `claude -p` leaves this Promise unsettled
      // forever, and `ingest` waits with no way to tell slow from dead. Node
      // kills the process on timeout and fires `close` with a non-zero code,
      // which the handler below already reports.
      const proc = spawn(this.bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
        timeout: CLI_TIMEOUT_MS,
      });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => (out += d));
      proc.stderr.on("data", (d) => (err += d));
      proc.on("error", (e) =>
        reject(new Error(`Could not run \`${this.bin} -p\`: ${e.message}. Is Claude Code installed?`)),
      );
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`\`${this.bin} -p\` exited ${code}: ${err.trim()}`));
        resolve(out.trim());
      });
      proc.stdin.write(user);
      proc.stdin.end();
    });
  }

  generateUpdate(state: AttractorState, summary: string, vibes: string[]): Promise<AttractorUpdate> {
    return generateVia(this, this.forceModel ?? this.models.update, this.subject, state, summary, vibes);
  }
}

/**
 * Abstract a basin's keywords. Uses the same `call` primitive as everything
 * else, so both engines behave identically here too.
 */
export async function consolidateBasin(engine: Engine, basin: Basin, model: string): Promise<string[]> {
  const text = await engine.call(ANALYSIS_SYSTEM, buildConsolidatePrompt(basin), model, 500);
  return parseConsolidation(text, basin.keywords);
}

/** Read model overrides from Worker bindings, falling back to defaults. */
export function modelsFromEnv(env: Env): ModelConfig {
  return {
    summary: env.ATTRACTOR_SUMMARY_MODEL || DEFAULT_MODELS.summary,
    update: env.ATTRACTOR_UPDATE_MODEL || DEFAULT_MODELS.update,
  };
}

/** Signature the Worker routes already call. */
export function generateAttractorUpdate(
  env: Env,
  state: AttractorState,
  summary: string,
  vibes: string[],
): Promise<AttractorUpdate> {
  return new ApiEngine(env.ANTHROPIC_API_KEY, env.ATTRACTOR_SUBJECT, modelsFromEnv(env)).generateUpdate(
    state,
    summary,
    vibes,
  );
}
