import type { Env } from "./types";
import { error } from "./utils";
import { handleAttractorRoutes } from "./routes";

/**
 * Worker entry point.
 *
 * Every /api/attractor/* route requires a bearer token. Set the expected value
 * with `wrangler secret put ATTRACTOR_TOKEN`, or replace this with whatever
 * auth your deployment already uses.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const path = url.pathname;

    if (!path.startsWith("/api/attractor")) {
      return error("Not found", 404);
    }

    const response = await handleAttractorRoutes(method, path, url, request, env);
    return response ?? error("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
