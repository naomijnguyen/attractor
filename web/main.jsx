/*
 * Title        Entry point for the standalone attractor demo
 * Purpose      Mounts <AttractorView />. In demo mode the dev server answers
 *              /api from a fixture and no auth is involved; in live mode every
 *              Worker route is token-guarded and fails closed, so a bearer
 *              token has to reach localStorage before the view mounts.
 * Author       Jennifer Naomi Nguyen
 * Canonical    /Users/jennifer/Bootwitch/Projects/attractor/web/main.jsx
 * Updated      2026-09-19
 * Dependencies react, react-dom; live mode needs `wrangler dev` on :8787
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AttractorView from "./AttractorView";
import { setToken } from "./useApi";

// Injected by vite.config.js. True for `npm run web`, false for `web:live`.
const DEMO = __ATTRACTOR_DEMO__;

// TODO(human): decide how LIVE mode obtains the ATTRACTOR_TOKEN.
//
// Only reached by `npm run web:live`. AttractorView reads the token from
// localStorage via useApi.js; with none, every request 401s and the view shows
// its "token rejected" state with no way to recover. Return true once a token
// is stored (call `setToken(value)`), or false to render the notice instead.
//
// Directions, with trade-offs:
//   - `prompt()` on first load: three lines, no UI, but browsers can suppress
//     it and the value is visible as you type.
//   - `import.meta.env.VITE_ATTRACTOR_TOKEN` from .env.local: nothing to type
//     and survives reloads, but it is a token in a file you must gitignore.
//   - A small inline form: the most work, and the only option that can show an
//     error and let someone retry without editing files.
//   - URL hash (#token=...), stripped immediately: easy to send yourself, but
//     it lands in browser history.
//
// Returning true unconditionally is legitimate too, if you would rather let
// AttractorView surface its own 401.
function ensureLiveToken() {
  return false;
}

const ready = DEMO || ensureLiveToken();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {ready ? (
      <AttractorView />
    ) : (
      <div className="flex h-full items-center justify-center p-8 text-center text-slate-400">
        <p className="max-w-sm text-sm leading-relaxed">
          Live mode needs an attractor token.
          <br />
          Implement <code className="text-slate-200">ensureLiveToken()</code> in{" "}
          <code className="text-slate-200">web/main.jsx</code>, or run{" "}
          <code className="text-slate-200">npm run web</code> for the offline demo.
        </p>
      </div>
    )}
  </StrictMode>
);
