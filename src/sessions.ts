/**
 * Reading Claude Code session transcripts.
 *
 * Claude Code writes one JSONL file per session under
 * ~/.claude/projects/<slugified-project-path>/<session-id>.jsonl. Each line is
 * an event; the ones we want carry type "user" or "assistant" with a `message`
 * object. Content is either a plain string or an array of blocks, only some of
 * which are text -- tool calls and results are skipped.
 *
 * Parsing matches wikigen's loader so both tools see the same conversation.
 */

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionInfo {
  path: string;
  project: string;
  id: string;
  modified: Date;
  messages: number;
}

/** Short text is usually acknowledgements or tool noise, not conversation. */
const MIN_BLOCK_LENGTH = 30;

export function parseSession(raw: string): SessionMessage[] {
  const messages: SessionMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // partial write or non-JSON line
    }
    if (typeof event !== "object" || event === null) continue;

    const { type, message } = event as { type?: string; message?: unknown };
    if (type !== "user" && type !== "assistant") continue;
    if (typeof message !== "object" || message === null) continue;

    const content = (message as { content?: unknown }).content;

    if (typeof content === "string") {
      if (content.trim().length > MIN_BLOCK_LENGTH) {
        messages.push({ role: type, content: content.trim() });
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as { type?: string; text?: string };
        if (b.type !== "text" || typeof b.text !== "string") continue;
        if (b.text.trim().length > MIN_BLOCK_LENGTH) {
          messages.push({ role: type, content: b.text.trim() });
        }
      }
    }
  }
  return messages;
}

export function projectsRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return `${home}/.claude/projects`;
}

/**
 * List sessions, newest first. `filter` matches against the project directory
 * name, so `--session Anthropic` narrows to one project.
 */
export async function listSessions(filter = ""): Promise<SessionInfo[]> {
  const { readdir, stat, readFile } = await import("node:fs/promises");
  const root = projectsRoot();

  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return [];
  }

  const found: SessionInfo[] = [];
  for (const project of projects) {
    if (filter && !project.toLowerCase().includes(filter.toLowerCase())) continue;
    let files: string[];
    try {
      files = await readdir(`${root}/${project}`);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const path = `${root}/${project}/${file}`;
      try {
        const [info, raw] = await Promise.all([stat(path), readFile(path, "utf8")]);
        const messages = parseSession(raw).length;
        if (messages === 0) continue; // empty or tool-only session
        found.push({ path, project, id: file.replace(/\.jsonl$/, ""), modified: info.mtime, messages });
      } catch {
        continue;
      }
    }
  }
  return found.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/** Render messages as a transcript for summarization. */
export function toTranscript(messages: SessionMessage[]): string {
  return messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
}
