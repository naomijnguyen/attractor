/*
 * Title        Vite config for the standalone attractor demo
 * Purpose      Serves web/index.html locally in one of two modes. Demo mode
 *              (default) answers /api from a generated fixture so the
 *              visualization runs with no KV namespace, no key and no network.
 *              Live mode forwards /api to a running `wrangler dev`.
 * Author       Jennifer Naomi Nguyen
 * Canonical    /Users/jennifer/Bootwitch/Projects/attractor/web/vite.config.js
 * Updated      2026-09-19
 * Dependencies live mode needs `wrangler dev` on :8787 and an ATTRACTOR_TOKEN
 */
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Live mode is opt-in: requiring a KV namespace just to look at the graph
// would turn a one-command demo into a three-step setup.
const LIVE = process.env.ATTRACTOR_LIVE === "1";
const WORKER = process.env.ATTRACTOR_WORKER_URL ?? "http://localhost:8787";

/**
 * Serves the two read routes from web/demo-data.json.
 *
 * This runs as dev-server middleware rather than client-side mocking on
 * purpose: AttractorView and useApi.js stay untouched, and the browser makes
 * the same same-origin relative request it makes against the real Worker. The
 * component genuinely cannot tell the difference.
 */
function demoApi() {
  return {
    name: "attractor-demo-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/attractor")) return next();
        // Re-read per request so `npm run web:fixture` shows up on refresh.
        const data = JSON.parse(readFileSync(new URL("./demo-data.json", import.meta.url), "utf8"));
        const path = req.url.split("?")[0];
        const body =
          path === "/api/attractor/history"
            ? { history: data.history }
            : { initialized: true, state: data.state };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig({
  root: "web",
  // envDir follows `root` by default, which would hide .env.local inside web/.
  envDir: process.cwd(),
  plugins: [react(), ...(LIVE ? [] : [demoApi()])],
  // Demo mode is read-only and unauthenticated by design, so the client skips
  // its token check. In live mode every route is token-guarded as usual.
  define: { __ATTRACTOR_DEMO__: JSON.stringify(!LIVE) },
  server: {
    port: 5173,
    // Only crosses to the Worker in live mode; still same-origin to the browser.
    proxy: LIVE ? { "/api": { target: WORKER, changeOrigin: false } } : undefined,
  },
});
