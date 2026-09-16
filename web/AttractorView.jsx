import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./useApi";

// --- Color helpers ---
function weightToColor(weight) {
  // Cool blue (dormant) → warm amber (active) → hot purple (dominant)
  if (weight < 0.3) return { r: 80, g: 120, b: 180 };   // steel blue
  if (weight < 0.5) return { r: 100, g: 160, b: 180 };  // teal
  if (weight < 0.7) return { r: 200, g: 170, b: 80 };   // warm amber
  if (weight < 0.85) return { r: 220, g: 130, b: 90 };   // coral
  return { r: 180, g: 120, b: 220 };                      // violet
}

function colorStr({ r, g, b }, alpha = 1) {
  return `rgba(${r},${g},${b},${alpha})`;
}

function lerpColor(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

// --- Simple force simulation ---
class ForceSimulation {
  constructor(nodes, edges, width, height) {
    this.width = width;
    this.height = height;
    this.nodes = nodes.map((n, i) => ({
      ...n,
      x: width / 2 + Math.cos(i * 2 * Math.PI / nodes.length) * Math.min(width, height) * 0.3,
      y: height / 2 + Math.sin(i * 2 * Math.PI / nodes.length) * Math.min(width, height) * 0.3,
      vx: 0,
      vy: 0,
    }));
    this.edges = edges;
    this.alpha = 1;
  }

  /**
   * Adopt new dimensions without discarding the layout.
   *
   * Rebuilding on resize threw every node back to the starting circle, so
   * dragging a window edge detonated the graph instead of reflowing it. Scale
   * positions with the container and warm alpha back up so the existing layout
   * settles into the new bounds.
   */
  resize(width, height) {
    const sx = width / this.width;
    const sy = height / this.height;
    this.width = width;
    this.height = height;
    for (const node of this.nodes) {
      node.x *= sx;
      node.y *= sy;
    }
    this.alpha = Math.max(this.alpha, 0.3);
  }

  tick() {
    if (this.alpha < 0.001) return false;

    const nodes = this.nodes;
    const cx = this.width / 2;
    const cy = this.height / 2;

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const minDist = (nodes[i].radius + nodes[j].radius) * 2.5;
        const force = Math.max(0, (minDist - dist) / dist) * 2 + 150 / (dist * dist);
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        nodes[i].vx -= fx;
        nodes[i].vy -= fy;
        nodes[j].vx += fx;
        nodes[j].vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of this.edges) {
      const a = nodes.find(n => n.id === edge.from);
      const b = nodes.find(n => n.id === edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = (a.radius + b.radius) * 3;
      const force = (dist - targetDist) * 0.02;
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.005;
      node.vy += (cy - node.y) * 0.005;
    }

    // Apply velocity with damping
    for (const node of nodes) {
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x += node.vx * this.alpha;
      node.y += node.vy * this.alpha;
      // Keep nodes in bounds
      const pad = node.radius + 10;
      node.x = Math.max(pad, Math.min(this.width - pad, node.x));
      node.y = Math.max(pad, Math.min(this.height - pad, node.y));
    }

    this.alpha *= 0.995;
    return true;
  }
}

// --- Sparkline component ---
function Sparkline({ data, width = 120, height = 32, color = "#e0b878" }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data) - 0.05;
  const max = Math.max(...data) + 0.05;
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(" ");
  const lastY = height - ((data[data.length - 1] - min) / range) * height;

  return (
    <svg width={width} height={height} className="block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      <circle cx={width} cy={lastY} r="2.5" fill={color} opacity="0.9" />
    </svg>
  );
}

// --- Main Component ---
export default function AttractorView({ onOpenSidebar }) {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  // null | "unauthorized" | "unreachable". Without this, a 401 rendered as
  // "no attractor initialized yet" -- telling the user their data was gone
  // when the token was simply wrong.
  const [loadError, setLoadError] = useState(null);
  const [selectedBasin, setSelectedBasin] = useState(null);
  const [hoveredBasin, setHoveredBasin] = useState(null);
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animFrameRef = useRef(null);
  const containerRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const timeRef = useRef(0);

  // Fetch attractor data
  useEffect(() => {
    Promise.all([
      api.getAttractor(),
      api.getAttractorHistory(),
    ]).then(([s, h]) => {
      setState(s);
      setHistory(h);
      setLoading(false);
    }).catch((err) => {
      console.error("Failed to load attractor:", err);
      setLoadError(err?.status === 401 ? "unauthorized" : "unreachable");
      setLoading(false);
    });
  }, []);

  // Initialize simulation when state loads
  const initSimulation = useCallback(() => {
    if (!state || !canvasRef.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    const nodes = state.basins.map(b => ({
      id: b.id,
      label: b.label,
      weight: b.weight,
      radius: 15 + b.weight * 35,
      connections: b.connections,
      keywords: b.keywords,
      trajectory: b.trajectory,
      conversationCount: b.conversationCount,
      lastActive: b.lastActive,
      description: b.description,
    }));

    // Build edges from connections
    const edgeSet = new Set();
    const edges = [];
    for (const node of nodes) {
      for (const connId of node.connections) {
        const key = [node.id, connId].sort().join(":");
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: node.id, to: connId });
        }
      }
    }

    simRef.current = new ForceSimulation(nodes, edges, width, height);
    timeRef.current = 0;
  }, [state]);

  useEffect(() => {
    initSimulation();
  }, [initSimulation]);

  // Handle resize. Debounced, because `resize` fires continuously while a
  // window edge is dragged -- undebounced this ran dozens of times a second.
  useEffect(() => {
    let timer = null;

    const apply = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";

      // Reflow if there is a layout to keep; only build from scratch if there
      // isn't one yet.
      if (simRef.current) simRef.current.resize(width, height);
      else initSimulation();
    };

    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 150);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, [initSimulation]);

  // Animation loop
  useEffect(() => {
    if (!simRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    function draw() {
      const sim = simRef.current;
      if (!sim) return;
      timeRef.current += 0.016;
      sim.tick();

      const w = canvas.width;
      const h = canvas.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Background subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.02)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w / dpr; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h / dpr);
        ctx.stroke();
      }
      for (let y = 0; y < h / dpr; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w / dpr, y);
        ctx.stroke();
      }

      // Draw edges
      for (const edge of sim.edges) {
        const a = sim.nodes.find(n => n.id === edge.from);
        const b = sim.nodes.find(n => n.id === edge.to);
        if (!a || !b) continue;
        const avgWeight = (a.weight + b.weight) / 2;
        const cA = weightToColor(a.weight);
        const cB = weightToColor(b.weight);
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, colorStr(cA, avgWeight * 0.4));
        gradient.addColorStop(1, colorStr(cB, avgWeight * 0.4));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1 + avgWeight * 2;
        ctx.stroke();
      }

      // Draw nodes
      for (const node of sim.nodes) {
        const color = weightToColor(node.weight);
        const isHovered = hoveredBasin === node.id;
        const isSelected = selectedBasin === node.id;
        const isDominant = state?.meta?.dominantBasin === node.id;

        // Pulse for dominant basin
        const pulse = isDominant ? 1 + Math.sin(timeRef.current * 2) * 0.08 : 1;
        const r = node.radius * pulse;

        // Outer glow
        if (node.weight > 0.4 || isHovered || isSelected) {
          const glowR = r * (isHovered || isSelected ? 2.5 : 2);
          const glow = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, glowR);
          glow.addColorStop(0, colorStr(color, isHovered || isSelected ? 0.2 : 0.1));
          glow.addColorStop(1, colorStr(color, 0));
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node circle
        const grad = ctx.createRadialGradient(
          node.x - r * 0.3, node.y - r * 0.3, 0,
          node.x, node.y, r
        );
        grad.addColorStop(0, colorStr(lerpColor(color, { r: 255, g: 255, b: 255 }, 0.3), 0.9));
        grad.addColorStop(0.7, colorStr(color, 0.8));
        grad.addColorStop(1, colorStr(color, 0.5));
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Ring for selected/hovered
        if (isHovered || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = colorStr(color, 0.6);
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = isHovered || isSelected ? "#fff" : "rgba(230,230,240,0.85)";
        ctx.font = `${isHovered || isSelected ? "bold " : ""}${Math.max(10, Math.min(13, r * 0.6))}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Text with shadow for readability
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 4;
        ctx.fillText(node.label, node.x, node.y);
        ctx.shadowBlur = 0;

        // Weight percentage below
        ctx.fillStyle = "rgba(180,180,200,0.5)";
        ctx.font = "9px -apple-system, sans-serif";
        ctx.fillText(`${(node.weight * 100).toFixed(0)}%`, node.x, node.y + r + 12);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [state, hoveredBasin, selectedBasin]);

  // Mouse interaction
  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current || !simRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y };

    // Hit test
    let hit = null;
    for (const node of simRef.current.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < (node.radius + 5) * (node.radius + 5)) {
        hit = node.id;
        break;
      }
    }
    setHoveredBasin(hit);
  }, []);

  const handleClick = useCallback((e) => {
    if (!containerRef.current || !simRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let hit = null;
    for (const node of simRef.current.nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < (node.radius + 5) * (node.radius + 5)) {
        hit = node;
        break;
      }
    }
    setSelectedBasin(hit ? (selectedBasin === hit.id ? null : hit.id) : null);
  }, [selectedBasin]);

  const selectedData = state?.basins?.find(b => b.id === selectedBasin);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900">
        <div className="text-gray-500 text-sm">Loading attractor...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 gap-4">
        <div className="text-gray-400 text-sm">
          {loadError === "unauthorized"
            ? "Not authorized."
            : "Could not reach the attractor API."}
        </div>
        <div className="text-gray-600 text-xs max-w-sm text-center leading-relaxed">
          {loadError === "unauthorized"
            ? "The API rejected this token. Your attractor is unchanged — check the token and reload."
            : "The request failed before it reached the attractor. Check the API URL and that the Worker is deployed."}
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-900 gap-4">
        <div className="text-gray-400 text-sm">No attractor initialized yet.</div>
        <div className="text-gray-600 text-xs max-w-sm text-center leading-relaxed">
          The attractor forms as conversations are summarized. It evolves through a feedback loop:
          conversation → summary → attractor update → system prompt → conversation.
        </div>
      </div>
    );
  }

  const trajectoryIcon = {
    converging: "↗",
    diverging: "↔",
    stable: "→",
    restructuring: "⟲",
  }[state.meta.recentTrajectory] || "→";

  return (
    <div className="flex-1 flex flex-col bg-gray-900 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onOpenSidebar} className="lg:hidden text-gray-400 hover:text-gray-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-bold text-gray-200 tracking-wide">attractor</span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[11px] text-gray-500">
          <span title="Phase / era">
            Phase <span className="text-gray-300 font-semibold">{state.phase}</span>
          </span>
          <span title="Shannon entropy (0 = focused, 1 = uniform)">
            Entropy{" "}
            <span className="font-mono text-gray-300">{state.entropy.toFixed(2)}</span>
          </span>
          <span title="Recent trajectory direction" className="flex items-center gap-1">
            <span className="text-base">{trajectoryIcon}</span>
            <span className="text-gray-400">{state.meta.recentTrajectory}</span>
          </span>
          <span title="Total attractor updates">
            <span className="text-gray-300">{state.updateCount}</span> updates
          </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 relative cursor-crosshair"
          onMouseMove={handleMouseMove}
          onClick={handleClick}
        >
          <canvas ref={canvasRef} className="absolute inset-0" />

          {/* Emerging patterns overlay */}
          {state.emerging.length > 0 && (
            <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-1.5">
              <span className="text-[9px] text-gray-600 font-semibold uppercase tracking-wider mr-1 self-center">
                Emerging
              </span>
              {state.emerging.map((p, i) => (
                <span
                  key={i}
                  className="text-[10px] px-2 py-1 rounded-full bg-purple-500/10 text-purple-300/70 border border-purple-500/20"
                  style={{ animation: `pulse 3s ease-in-out ${i * 0.5}s infinite` }}
                >
                  {p}
                </span>
              ))}
            </div>
          )}

          {/* Hover tooltip */}
          {hoveredBasin && !selectedBasin && (() => {
            const node = simRef.current?.nodes?.find(n => n.id === hoveredBasin);
            if (!node) return null;
            return (
              <div
                className="absolute pointer-events-none bg-gray-800/95 backdrop-blur-sm rounded-lg px-3 py-2 border border-gray-700 shadow-xl max-w-xs"
                style={{
                  left: Math.min(node.x + node.radius + 10, (containerRef.current?.getBoundingClientRect().width || 400) - 200),
                  top: node.y - 20,
                }}
              >
                <div className="text-xs font-semibold text-gray-200">{node.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{node.description}</div>
                <div className="text-[10px] text-gray-500 mt-1">
                  {node.conversationCount} conversations · Weight: {(node.weight * 100).toFixed(0)}%
                </div>
              </div>
            );
          })()}
        </div>

        {/* Detail panel */}
        {selectedData && (
          <div className="w-72 border-l border-gray-800 p-4 overflow-y-auto bg-gray-950/50 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-gray-200">{selectedData.label}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {selectedData.conversationCount} conversations
                </div>
              </div>
              <button
                onClick={() => setSelectedBasin(null)}
                className="text-gray-500 hover:text-gray-300 text-xs p-1"
              >
                ✕
              </button>
            </div>

            <div className="text-[11px] text-gray-400 leading-relaxed mb-4">
              {selectedData.description}
            </div>

            {/* Weight bar */}
            <div className="mb-4">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>Weight</span>
                <span className="font-mono">{(selectedData.weight * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${selectedData.weight * 100}%`,
                    background: colorStr(weightToColor(selectedData.weight)),
                  }}
                />
              </div>
            </div>

            {/* Trajectory sparkline */}
            {selectedData.trajectory.length >= 2 && (
              <div className="mb-4">
                <div className="text-[10px] text-gray-500 mb-1.5">Weight trajectory</div>
                <div className="bg-gray-800/50 rounded-lg p-2">
                  <Sparkline
                    data={selectedData.trajectory}
                    width={220}
                    height={40}
                    color={colorStr(weightToColor(selectedData.weight))}
                  />
                </div>
              </div>
            )}

            {/* Keywords */}
            {selectedData.keywords.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-gray-500 mb-1.5">Keywords</div>
                <div className="flex flex-wrap gap-1">
                  {selectedData.keywords.map((kw) => (
                    <span
                      key={kw}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700"
                    >
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Connections */}
            {selectedData.connections.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-gray-500 mb-1.5">Connected basins</div>
                <div className="space-y-1">
                  {selectedData.connections.map((connId) => {
                    const conn = state.basins.find(b => b.id === connId);
                    return conn ? (
                      <button
                        key={connId}
                        onClick={() => setSelectedBasin(connId)}
                        className="block w-full text-left text-[11px] px-2 py-1.5 rounded bg-gray-800/50 hover:bg-gray-800 text-gray-300 transition-colors"
                      >
                        <span className="font-medium">{conn.label}</span>
                        <span className="text-gray-600 ml-1.5">{(conn.weight * 100).toFixed(0)}%</span>
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            {/* Last active */}
            <div className="text-[10px] text-gray-600">
              Last active: {new Date(selectedData.lastActive).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })}
            </div>
          </div>
        )}

        {/* History panel (shown when no basin selected) */}
        {!selectedData && history.length > 0 && (
          <div className="w-72 border-l border-gray-800 p-4 overflow-y-auto bg-gray-950/50 flex-shrink-0">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4">
              Evolution History
            </div>

            {/* All basins mini list */}
            <div className="space-y-3 mb-6">
              {[...state.basins].sort((a, b) => b.weight - a.weight).map((basin) => {
                const color = weightToColor(basin.weight);
                return (
                  <button
                    key={basin.id}
                    onClick={() => setSelectedBasin(basin.id)}
                    className="block w-full text-left rounded-lg p-2.5 bg-gray-900/40 hover:bg-gray-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-300">{basin.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background: colorStr(color, 0.15),
                          color: colorStr(color, 0.9),
                        }}>
                        {(basin.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                    {basin.trajectory.length >= 2 && (
                      <Sparkline
                        data={basin.trajectory}
                        width={200}
                        height={20}
                        color={colorStr(color)}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Snapshot timeline */}
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
              Snapshots
            </div>
            <div className="space-y-2">
              {[...history].reverse().map((snap, i) => (
                <div key={i} className="text-[10px] p-2 rounded bg-gray-900/40">
                  <div className="text-gray-500 mb-1">
                    {new Date(snap.timestamp).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[...snap.basins]
                      .sort((a, b) => b.weight - a.weight)
                      .slice(0, 5)
                      .map((b) => {
                        const basin = state.basins.find(sb => sb.id === b.id);
                        return (
                          <span key={b.id} className="px-1 py-0.5 rounded text-[9px]"
                            style={{
                              background: colorStr(weightToColor(b.weight), 0.15),
                              color: colorStr(weightToColor(b.weight), 0.8),
                            }}>
                            {basin?.label || b.id} {(b.weight * 100).toFixed(0)}%
                          </span>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
