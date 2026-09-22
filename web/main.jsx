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
import { clearToken, hasToken, setToken } from "./useApi";

// Injected by vite.config.js. True for `npm run web`, false for `web:live`.
const DEMO = __ATTRACTOR_DEMO__;

// How live mode gets its bearer token, in three steps, cheapest first.
//
// Chosen for the case that actually happens: one person, on localhost, looking
// at their own Worker. A proper login form would be more polished and would be
// the wrong tool — this is a dev-server demo, not a deployed app, and nothing
// here should imply it is safe to expose.
function ensureLiveToken() {
  // 1. #reset escape hatch. A token the Worker rejects otherwise sits in
  //    localStorage forever: the view renders its 401 state, which has no way
  //    to clear it, so the only exit is devtools. Cheap to add, awful to lack.
  if (window.location.hash === "#reset") {
    clearToken();
    window.location.hash = "";
  }

  // 2. VITE_ATTRACTOR_TOKEN from .env.local, which .gitignore already covers
  //    via `.env.*`. Preferred because it survives reloads and hard refreshes,
  //    and because a token typed once into a prompt is a token retyped all
  //    afternoon. Re-stored every load so editing .env.local actually wins
  //    over a stale value in localStorage.
  const fromEnv = import.meta.env.VITE_ATTRACTOR_TOKEN;
  if (fromEnv) {
    setToken(fromEnv);
    return true;
  }

  // 3. Already stored from a previous visit.
  if (hasToken()) return true;

  // 4. Last resort. `prompt` is blockable and shows the token as you type, so
  //    it is the fallback rather than the path — but it means a clone with no
  //    setup still reaches the view in one step instead of erroring.
  const typed = window.prompt("ATTRACTOR_TOKEN (or cancel to see setup instructions)");
  if (typed?.trim()) {
    setToken(typed.trim());
    return true;
  }
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
          Put <code className="text-slate-200">VITE_ATTRACTOR_TOKEN=...</code> in{" "}
          <code className="text-slate-200">.env.local</code> and reload, or run{" "}
          <code className="text-slate-200">npm run web</code> for the offline demo.
          <br />
          <span className="text-slate-500">
            A rejected token can be cleared with{" "}
            <code className="text-slate-300">#reset</code>.
          </span>
        </p>
      </div>
    )}
  </StrictMode>
);
