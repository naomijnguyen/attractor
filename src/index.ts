import type { Env } from "./types";
import { error } from "./utils";
import { handleAttractorRoutes } from "./routes";

/**
 * Constant-time string comparison, so token checking doesn't leak length or
 * prefix information through timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Worker entry point.
 *
 * Every /api/attractor/* route requires `Authorization: Bearer <token>`
 * matching the ATTRACTOR_TOKEN secret. Set it with:
 *
 *   wrangler secret put ATTRACTOR_TOKEN
 *
 * If the secret is unset the Worker refuses all requests rather than serving
 * them openly -- `seed` can wipe state and `ingest` spends your Anthropic key,
 * so failing closed is the only safe default.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (!path.startsWith("/api/attractor")) {
      return error("Not found", 404);
    }

    if (!env.ATTRACTOR_TOKEN) {
      return error("Server misconfigured: ATTRACTOR_TOKEN is not set", 500);
    }

    const auth = request.headers.get("Authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!presented || !timingSafeEqual(presented, env.ATTRACTOR_TOKEN)) {
      return error("Unauthorized", 401);
    }

    const response = await handleAttractorRoutes(request.method, path, new URL(request.url), request, env);
    return response ?? error("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
