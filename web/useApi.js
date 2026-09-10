// Minimal standalone client for the attractor endpoints.
//
// The original component pulled this from the parent app's hooks/useApi.js;
// vendored here so <AttractorView /> can be dropped into any React app.

const API_BASE = import.meta?.env?.VITE_ATTRACTOR_API ?? "/api";
const TOKEN_KEY = "attractor-token";

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function request(path) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  /** GET /api/attractor -> { initialized, state } */
  getAttractor: async () => {
    const data = await request("/attractor");
    return data.initialized ? data.state : null;
  },
  /** GET /api/attractor/history -> { history } */
  getAttractorHistory: async () => {
    const data = await request("/attractor/history");
    return data.history ?? [];
  },
};
