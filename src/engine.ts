import { buildUpdatePrompt, parseUpdate } from "./model";
import type { AttractorState, AttractorUpdate, Env } from "./types";

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
  generateUpdate(
    state: AttractorState,
    summary: string,
    vibes: string[],
  ): Promise<AttractorUpdate>;
  /** Free-form call, used for summarizing a raw transcript. */
  complete(prompt: string, maxTokens?: number): Promise<string>;
}

const UPDATE_MODEL = "claude-opus-4-6";
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

// === Anthropic HTTP API ===

export class ApiEngine implements Engine {
  constructor(
    private apiKey: string,
    private subject = "the user",
  ) {}

  private async call(system: string, user: string, model: string, maxTokens: number): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.3,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
    const result = (await response.json()) as { content: Array<{ text: string }> };
    return result.content[0]?.text ?? "";
  }

  async complete(prompt: string, maxTokens = 300): Promise<string> {
    return this.call("", prompt, SUMMARY_MODEL, maxTokens);
  }

  async generateUpdate(state: AttractorState, summary: string, vibes: string[]): Promise<AttractorUpdate> {
    const text = await this.call(
      buildUpdatePrompt(state, summary, vibes, this.subject),
      "Generate the attractor update for this conversation.",
      UPDATE_MODEL,
      800,
    );
    return parseUpdate(text);
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

  async complete(prompt: string): Promise<string> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      const proc = spawn(this.bin, ["-p"], { stdio: ["pipe", "pipe", "pipe"] });
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
      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async generateUpdate(state: AttractorState, summary: string, vibes: string[]): Promise<AttractorUpdate> {
    // No system/user split in print mode -- the prompt already ends with its
    // own instruction to return only JSON.
    const prompt =
      buildUpdatePrompt(state, summary, vibes, this.subject) +
      "\n\nGenerate the attractor update for this conversation.";
    return parseUpdate(await this.complete(prompt));
  }
}

/** Signature the Worker routes already call. */
export function generateAttractorUpdate(
  env: Env,
  state: AttractorState,
  summary: string,
  vibes: string[],
): Promise<AttractorUpdate> {
  return new ApiEngine(env.ANTHROPIC_API_KEY, env.ATTRACTOR_SUBJECT).generateUpdate(state, summary, vibes);
}
