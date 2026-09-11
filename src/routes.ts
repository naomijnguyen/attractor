import type { BasinSeed, Env } from "./types";
import { json, error, matchRoute } from "./utils";
import { applyUpdate, createInitialState, toBasinId } from "./model";
import { getAttractorState, saveAttractorState } from "./store";
import { generateAttractorUpdate } from "./engine";

// === Attractor API Routes ===

export async function handleAttractorRoutes(
  method: string,
  path: string,
  url: URL,
  request: Request,
  env: Env
): Promise<Response | null> {
  let params;

  // --- GET /api/attractor — View current attractor state ---
  if (method === "GET" && path === "/api/attractor") {
    const state = await getAttractorState(env.MODEL_KV);
    if (!state) {
      return json({ initialized: false, message: "Attractor not yet seeded. POST /api/attractor/seed to initialize." });
    }
    return json({ initialized: true, state });
  }

  // --- POST /api/attractor/seed — Initialize the attractor with basins ---
  if (method === "POST" && path === "/api/attractor/seed") {
    const body = (await request.json()) as {
      basins: BasinSeed[];
      force?: boolean;
    };

    if (!body.basins || !Array.isArray(body.basins) || body.basins.length === 0) {
      return error("basins array is required with at least one basin");
    }

    // Check for existing state
    const existing = await getAttractorState(env.MODEL_KV);
    if (existing && !body.force) {
      return error("Attractor already initialized. Use force: true to re-seed (this will reset all history).", 409);
    }

    const state = createInitialState(body.basins);
    await saveAttractorState(env.MODEL_KV, state);

    return json({ success: true, message: `Attractor initialized with ${state.basins.length} basins`, state });
  }

  // --- POST /api/attractor/basins — Add a new basin to existing attractor ---
  if (method === "POST" && path === "/api/attractor/basins") {
    const body = (await request.json()) as {
      label: string;
      description: string;
      keywords: string[];
    };

    if (!body.label || !body.description) {
      return error("label and description are required");
    }

    const state = await getAttractorState(env.MODEL_KV);
    if (!state) {
      return error("Attractor not initialized. POST /api/attractor/seed first.", 400);
    }

    const newId = toBasinId(body.label);
    if (state.basins.find(b => b.id === newId)) {
      return error(`Basin "${body.label}" already exists`, 409);
    }

    const now = new Date().toISOString();
    state.basins.push({
      id: newId,
      label: body.label,
      description: body.description,
      weight: 0.5,
      keywords: (body.keywords || []).slice(0, 10),
      connections: [],
      trajectory: [0.5],
      lastActive: now,
      conversationCount: 0,
    });
    state.lastUpdated = now;

    await saveAttractorState(env.MODEL_KV, state);
    return json({ success: true, basin_id: newId, total_basins: state.basins.length });
  }

  // --- DELETE /api/attractor/basins/:id — Remove a basin ---
  params = matchRoute(method, path, "DELETE", "/api/attractor/basins/:id");
  if (params) {
    const state = await getAttractorState(env.MODEL_KV);
    if (!state) return error("Attractor not initialized", 400);

    const basinId = params.id;
    const basinIndex = state.basins.findIndex(b => b.id === basinId);
    if (basinIndex === -1) return error("Basin not found", 404);

    // Remove basin and clean up connections
    const removedLabel = state.basins[basinIndex].label;
    state.basins.splice(basinIndex, 1);
    for (const b of state.basins) {
      b.connections = b.connections.filter(c => c !== basinId);
    }
    state.lastUpdated = new Date().toISOString();

    await saveAttractorState(env.MODEL_KV, state);
    return json({ success: true, removed: removedLabel, remaining_basins: state.basins.length });
  }

  // --- GET /api/attractor/history — View attractor evolution over time ---
  if (method === "GET" && path === "/api/attractor/history") {
    const historyRaw = await env.MODEL_KV.get("attractor:history");
    if (!historyRaw) return json({ history: [] });

    try {
      const history = JSON.parse(historyRaw);
      return json({ history });
    } catch {
      return json({ history: [] });
    }
  }

  // --- POST /api/attractor/trigger — Manually trigger an attractor update for a conversation ---
  if (method === "POST" && path === "/api/attractor/trigger") {
    const body = (await request.json()) as { conversation_id: string };
    if (!body.conversation_id) return error("conversation_id is required");

    // Enqueue attractor update job
    await env.JOBS.send({
      type: "attractor_update",
      conversationId: body.conversation_id,
    });

    return json({ success: true, message: "Attractor update enqueued" });
  }

  // --- POST /api/attractor/ingest-transcript — Accept raw messages, summarize, and ingest ---
  // Used by the Claude Code SessionEnd hook to auto-feed conversations.
  if (method === "POST" && path === "/api/attractor/ingest-transcript") {
    const body = (await request.json()) as {
      messages: Array<{ role: string; content: string }>;
      source?: string;
    };

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length < 2) {
      return error("messages array with at least 2 messages is required");
    }

    const state = await getAttractorState(env.MODEL_KV);
    if (!state) {
      return error("Attractor not initialized.", 400);
    }

    // Truncate messages for summarization (same pattern as summarize.ts)
    const truncated = body.messages.slice(-30).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content.length > 500 ? m.content.slice(0, 500) + "..." : m.content,
    }));

    // Summarize using Haiku
    const summaryPrompt = `Analyze this conversation and return a JSON object with exactly two fields:
1. "summary": A concise 1-2 sentence summary of what was discussed and accomplished.
2. "vibes": An array of 1-4 vibe tags that describe the conversational energy. Choose from: playful, serious, technical, philosophical, creative, adorable, nerdy, focused, casual, witty, warm, chaotic, chill, intense, curious, supportive, sarcastic, wholesome, brainstormy, deep.

Return ONLY valid JSON, no markdown formatting, no explanation.`;

    const summaryResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        temperature: 0.3,
        system: summaryPrompt,
        messages: truncated,
      }),
    });

    if (!summaryResponse.ok) {
      return error(`Summary generation failed: ${summaryResponse.status}`, 500);
    }

    const summaryResult = (await summaryResponse.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    let summary: string;
    let vibes: string[];
    try {
      const text = summaryResult.content[0]?.text || "";
      const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean);
      summary = parsed.summary;
      vibes = parsed.vibes || [];
    } catch {
      return error("Failed to parse summary from conversation", 500);
    }

    // Now feed into attractor
    try {
      const update = await generateAttractorUpdate(env, state, summary, vibes);
      const newState = applyUpdate(state, update);
      await saveAttractorState(env.MODEL_KV, newState);

      return json({
        success: true,
        source: body.source || "claude-code",
        summary,
        vibes,
        basins_touched: update.basin_updates.length,
        new_connections: update.new_connections.length,
        emerging_patterns: update.emerging_patterns,
        new_basin: update.new_basin?.label || null,
        entropy: newState.entropy,
        trajectory: newState.meta.recentTrajectory,
      });
    } catch (err) {
      return error(`Attractor update failed: ${err instanceof Error ? err.message : "unknown"}`, 500);
    }
  }

  // --- POST /api/attractor/ingest — Feed a raw summary directly into the attractor ---
  // This allows external sources (Claude Code, Claude.ai, notes) to influence
  // the attractor without needing a conversation stored in D1.
  if (method === "POST" && path === "/api/attractor/ingest") {
    const body = (await request.json()) as {
      summary: string;
      vibes?: string[];
      source?: string;  // e.g. "claude-code", "claude-ai", "manual"
    };

    if (!body.summary || !body.summary.trim()) {
      return error("summary is required");
    }

    const state = await getAttractorState(env.MODEL_KV);
    if (!state) {
      return error("Attractor not initialized. POST /api/attractor/seed first.", 400);
    }

    const vibes = body.vibes || [];
    const source = body.source || "external";

    try {
      // Generate and apply the update directly (no queue — immediate feedback)
      const update = await generateAttractorUpdate(env, state, body.summary, vibes);
      const newState = applyUpdate(state, update);
      await saveAttractorState(env.MODEL_KV, newState);

      return json({
        success: true,
        source,
        basins_touched: update.basin_updates.length,
        new_connections: update.new_connections.length,
        emerging_patterns: update.emerging_patterns,
        new_basin: update.new_basin?.label || null,
        entropy: newState.entropy,
        trajectory: newState.meta.recentTrajectory,
      });
    } catch (err) {
      return error(`Attractor update failed: ${err instanceof Error ? err.message : "unknown error"}`, 500);
    }
  }

  return null;
}
