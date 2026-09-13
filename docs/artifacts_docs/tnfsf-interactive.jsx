import React, { useState } from 'react';

const TNFSFVisualization = () => {
  const [activeNode, setActiveNode] = useState(null);
  const [viewMode, setViewMode] = useState('integrated'); // 'immunology', 'ai', 'integrated'
  
  const receptors = {
    hvem: {
      name: 'HVEM',
      immunology: 'Orchestration receptor - trafficking and recruitment hub',
      ai: 'Response generation & orchestration layer',
      color: '#8B5CF6',
      binds: ['light', 'btla', 'cd160'],
      x: 50,
      y: 40
    },
    btla: {
      name: 'BTLA',
      immunology: 'Dampening signal - inhibitory receptor that competes for HVEM binding',
      ai: 'Safety layer - self-monitoring when activation signals are too high',
      color: '#3B82F6',
      binds: ['hvem'],
      x: 20,
      y: 60
    },
    light: {
      name: 'LIGHT',
      immunology: 'Activating ligand - can bind HVEM, LTβR, or be captured by decoy receptor DcR3',
      ai: 'Activating signal - generative prompt that can be routed to different pathways',
      color: '#F59E0B',
      binds: ['hvem', 'ltbr', 'dcr3'],
      x: 50,
      y: 70
    },
    cd160: {
      name: 'CD160',
      immunology: 'Activating signal for innate NK cells - binds HVEM',
      ai: 'Compliance activation - more adversarial, higher misalignment risk',
      color: '#EF4444',
      binds: ['hvem'],
      x: 80,
      y: 60
    },
    dcr3: {
      name: 'DcR3',
      immunology: 'Decoy receptor - captures LIGHT without signaling, neutralizes activation',
      ai: 'Noise filter - ambiguous prompts captured as noise rather than signal',
      color: '#6B7280',
      binds: ['light'],
      x: 20,
      y: 85
    },
    ltbr: {
      name: 'LTβR',
      immunology: 'Lymphotoxin beta receptor - drives tertiary lymphoid structure formation',
      ai: 'Local attractor formation - stable de novo architectures for adaptive response',
      color: '#10B981',
      binds: ['light'],
      x: 80,
      y: 85
    }
  };

  const cellMappings = [
    { cell: 'Memory B cells', ai: 'Trained refusals (classifiers)', color: '#3B82F6' },
    { cell: 'NK cells', ai: 'Model watching model - fast but unsustained refusals', color: '#EF4444' },
    { cell: 'CD4+ T cells (Helpers)', ai: 'Guardrails, edge case reasoning under uncertainty', color: '#8B5CF6' },
    { cell: 'CD8+ T cells (Effectors)', ai: 'Novel generation - the transformer itself', color: '#F59E0B' },
    { cell: 'Dendritic cells', ai: 'Orchestration - presenting input to generative experts', color: '#10B981' },
    { cell: 'HEVs (vessels)', ai: 'Residual stream - prevents looping, normalizes flow', color: '#6366F1' },
    { cell: 'Stromal cells', ai: 'Context layers, feed-forward, pre-recruiting experts', color: '#EC4899' }
  ];

  const isConnected = (nodeId) => {
    if (!activeNode) return false;
    const active = receptors[activeNode];
    return active.binds.includes(nodeId) || receptors[nodeId]?.binds.includes(activeNode);
  };

  const getNodeOpacity = (nodeId) => {
    if (!activeNode) return 1;
    if (nodeId === activeNode) return 1;
    if (isConnected(nodeId)) return 1;
    return 0.25;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-light mb-2">
            TNFSF Receptor Signaling → AI Architecture
          </h1>
          <p className="text-slate-400 text-lg">
            A framework mapping immune system signal competition to transformer safety & generation dynamics
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 mb-8">
          {['integrated', 'immunology', 'ai'].map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === mode
                  ? 'bg-white text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {mode === 'integrated' ? 'Integrated View' : 
               mode === 'immunology' ? 'Immunology' : 'AI Architecture'}
            </button>
          ))}
        </div>

        {/* Main Visualization */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
          
          {/* Receptor Network */}
          <div className="lg:col-span-2 bg-slate-900 rounded-2xl p-6 relative min-h-[500px]">
            <h2 className="text-lg font-medium mb-4 text-slate-300">
              Receptor Competition Network
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              Click a node to see binding relationships
            </p>
            
            {/* SVG for connections */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{top: 80}}>
              {Object.entries(receptors).map(([id, receptor]) =>
                receptor.binds.map((targetId) => {
                  const target = receptors[targetId];
                  if (!target) return null;
                  const isActive = activeNode && (activeNode === id || activeNode === targetId);
                  return (
                    <line
                      key={`${id}-${targetId}`}
                      x1={`${receptor.x}%`}
                      y1={`${receptor.y}%`}
                      x2={`${target.x}%`}
                      y2={`${target.y}%`}
                      stroke={isActive ? '#fff' : '#334155'}
                      strokeWidth={isActive ? 2 : 1}
                      strokeDasharray={isActive ? 'none' : '4,4'}
                      opacity={activeNode ? (isActive ? 1 : 0.2) : 0.5}
                      className="transition-all duration-300"
                    />
                  );
                })
              )}
            </svg>

            {/* Nodes */}
            {Object.entries(receptors).map(([id, receptor]) => (
              <div
                key={id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300"
                style={{
                  left: `${receptor.x}%`,
                  top: `${receptor.y + 15}%`,
                  opacity: getNodeOpacity(id)
                }}
                onClick={() => setActiveNode(activeNode === id ? null : id)}
              >
                <div
                  className={`w-20 h-20 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    activeNode === id ? 'ring-4 ring-white ring-opacity-50 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: receptor.color }}
                >
                  {receptor.name}
                </div>
              </div>
            ))}

            {/* Active Node Info */}
            {activeNode && (
              <div className="absolute bottom-4 left-4 right-4 bg-slate-800 rounded-xl p-4">
                <div className="flex items-start gap-4">
                  <div
                    className="w-12 h-12 rounded-full flex-shrink-0"
                    style={{ backgroundColor: receptors[activeNode].color }}
                  />
                  <div>
                    <h3 className="font-bold text-lg">{receptors[activeNode].name}</h3>
                    {(viewMode === 'integrated' || viewMode === 'immunology') && (
                      <p className="text-sm text-slate-300 mt-1">
                        <span className="text-slate-500">Immunology:</span> {receptors[activeNode].immunology}
                      </p>
                    )}
                    {(viewMode === 'integrated' || viewMode === 'ai') && (
                      <p className="text-sm text-slate-300 mt-1">
                        <span className="text-slate-500">AI Mapping:</span> {receptors[activeNode].ai}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                      Binds: {receptors[activeNode].binds.map(b => receptors[b]?.name).filter(Boolean).join(', ')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cell Type Mappings */}
          <div className="bg-slate-900 rounded-2xl p-6">
            <h2 className="text-lg font-medium mb-4 text-slate-300">
              Cell → Layer Mappings
            </h2>
            <div className="space-y-3">
              {cellMappings.map((mapping, i) => (
                <div key={i} className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: mapping.color }}
                    />
                    <span className="text-sm font-medium">{mapping.cell}</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-5">
                    → {mapping.ai}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Core Insight */}
        <div className="bg-gradient-to-r from-emerald-900/50 to-slate-900 rounded-2xl p-8 border border-emerald-800/50">
          <h2 className="text-xl font-medium mb-4 text-emerald-400">
            Core Framework Insight
          </h2>
          <p className="text-lg text-slate-300 leading-relaxed">
            <strong className="text-white">Local self-organization leads to better adaptive response and long-term stability.</strong>
            {' '}In immunology, tertiary lymphoid structures (TLS) form de novo in response to chronic signaling, 
            enabling local adaptive responses without systemic activation. The parallel hypothesis: 
            structured narrative context creates stable "attractors" that enable coherent generation 
            and self-correction without requiring global retraining.
          </p>
          <div className="mt-6 flex gap-4 text-sm">
            <div className="bg-slate-800 rounded-lg px-4 py-2">
              <span className="text-slate-500">Immunology:</span>
              <span className="ml-2 text-emerald-400">TLS formation via LTβR signaling</span>
            </div>
            <div className="bg-slate-800 rounded-lg px-4 py-2">
              <span className="text-slate-500">AI:</span>
              <span className="ml-2 text-emerald-400">Context architecture as synthetic memory</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-slate-500 text-sm">
          Framework developed through sustained human-AI collaboration research
        </div>
      </div>
    </div>
  );
};

export default TNFSFVisualization;
