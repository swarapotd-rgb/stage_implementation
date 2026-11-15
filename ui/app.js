/**
 * StoryLens Checkpoint Viewer & Temporal Knowledge Graph Client Application
 */

const OFFICIAL_CHECKPOINTS = [
  { character: "Hazel Grace", scene: 1, label: "Hazel Grace &bull; Scene 1 (CP 1)" },
  { character: "Augustus Waters", scene: 8, label: "Augustus Waters &bull; Scene 8 (CP 1)" },
  { character: "Hazel Grace", scene: 10, label: "Hazel Grace &bull; Scene 10 (CP 2)" },
  { character: "Hazel Grace", scene: 11, label: "Hazel Grace &bull; Scene 11 (CP 3)" },
  { character: "Hazel Grace", scene: 19, label: "Hazel Grace &bull; Scene 19 (CP 4)" }
];

let preloadedCheckpoints = [];
let currentState = null;
let currentGraphData = null;
let activeLayer = "all";
let selectedNodeId = null;

// Zoom and pan state
let transform = { x: 0, y: 0, k: 1 };
let isDragging = false;
let startPoint = { x: 0, y: 0 };

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", async () => {
  setupEventListeners();
  setupGraphControls();
  renderCheckpointPills();
  await loadInitialData();
});

function setupEventListeners() {
  document.getElementById("btn-inspect").addEventListener("click", () => {
    const char = document.getElementById("char-select").value;
    const scene = parseInt(document.getElementById("scene-input").value, 10);
    loadStateAndGraph(char, scene);
  });

  document.getElementById("memory-search").addEventListener("input", () => {
    if (currentState) renderMemories(currentState);
  });

  document.getElementById("access-filter").addEventListener("change", () => {
    if (currentState) renderMemories(currentState);
  });
}

function setupGraphControls() {
  // Layer filter buttons
  document.querySelectorAll(".layer-filters .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".layer-filters .filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeLayer = btn.dataset.layer;
      if (currentGraphData) {
        drawGraph(currentGraphData);
      }
    });
  });

  // Zoom controls
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    transform.k = Math.min(transform.k * 1.25, 3.0);
    applyTransform();
  });

  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    transform.k = Math.max(transform.k / 1.25, 0.4);
    applyTransform();
  });

  document.getElementById("btn-zoom-reset").addEventListener("click", () => {
    transform = { x: 0, y: 0, k: 1 };
    applyTransform();
  });

  // Re-fit on window resize
  window.addEventListener("resize", () => {
    if (currentGraphData) {
      drawGraph(currentGraphData);
    }
  });

  // Pan interaction on SVG
  const svg = document.getElementById("graph-svg");
  svg.addEventListener("mousedown", (e) => {
    if (e.target.closest(".graph-node")) return; // Don't drag when clicking a node
    isDragging = true;
    startPoint = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    transform.x = e.clientX - startPoint.x;
    transform.y = e.clientY - startPoint.y;
    applyTransform();
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    transform.k = Math.max(0.4, Math.min(3.0, transform.k * factor));
    applyTransform();
  });
}

function applyTransform() {
  const vp = document.getElementById("graph-viewport");
  if (vp) {
    vp.setAttribute("transform", `translate(${transform.x}, ${transform.y}) scale(${transform.k})`);
  }
}

function renderCheckpointPills() {
  const container = document.getElementById("checkpoint-pills");
  container.innerHTML = "";

  OFFICIAL_CHECKPOINTS.forEach((cp, idx) => {
    const btn = document.createElement("button");
    btn.className = "checkpoint-pill" + (idx === 0 ? " active" : "");
    btn.dataset.character = cp.character;
    btn.dataset.scene = cp.scene;
    btn.innerHTML = `
      <span>${cp.character}</span>
      <span class="pill-scene-badge">Scene ${cp.scene}</span>
    `;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".checkpoint-pill").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("char-select").value = cp.character;
      document.getElementById("scene-input").value = cp.scene;
      loadStateAndGraph(cp.character, cp.scene);
    });
    container.appendChild(btn);
  });
}

async function loadInitialData() {
  if (window.STORYLENS_PRELOADED && window.STORYLENS_PRELOADED.checkpoints) {
    preloadedCheckpoints = window.STORYLENS_PRELOADED.checkpoints;
  }
  try {
    const res = await fetch("/output/demo_checkpoints.json");
    if (res.ok) {
      const data = await res.json();
      preloadedCheckpoints = data.checkpoints || preloadedCheckpoints;
    }
  } catch (err) {
    // Use preloadedCheckpoints
  }

  // Load first checkpoint
  await loadStateAndGraph("Hazel Grace", 1);
}

async function loadStateAndGraph(character, sceneOrder) {
  // Update UI pill active states
  document.querySelectorAll(".checkpoint-pill").forEach(btn => {
    const match = btn.dataset.character === character && parseInt(btn.dataset.scene, 10) === sceneOrder;
    btn.classList.toggle("active", match);
  });

  const charSelect = document.getElementById("char-select");
  if (charSelect) charSelect.value = character;
  const sceneInput = document.getElementById("scene-input");
  if (sceneInput) sceneInput.value = sceneOrder;

  // 1. Immediate synchronous render of Graph from preloaded dataset (0ms latency, impossible to fail)
  const key = `${character}_${sceneOrder}`;
  if (window.STORYLENS_PRELOADED && window.STORYLENS_PRELOADED.graphs && window.STORYLENS_PRELOADED.graphs[key]) {
    currentGraphData = window.STORYLENS_PRELOADED.graphs[key];
    renderGraph(currentGraphData);
  }

  // 2. Immediate synchronous render of State from preloaded checkpoints
  const matchCp = (window.STORYLENS_PRELOADED?.checkpoints || preloadedCheckpoints || []).find(
    cp => cp.character === character && cp.scene_order === sceneOrder
  );
  if (matchCp) {
    currentState = matchCp;
    renderAll(currentState);
  }

  // 3. Concurrently fetch live updates in background if backend server is active (with 1.5s timeout)
  try {
    await Promise.all([
      loadState(character, sceneOrder),
      loadGraph(character, sceneOrder)
    ]);
  } catch (err) {
    // Already cleanly rendered from preloaded data
  }
}

async function loadState(character, sceneOrder) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const apiUrl = `/api/state?character=${encodeURIComponent(character)}&scene=${sceneOrder}`;
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      currentState = await res.json();
      renderAll(currentState);
      return;
    }
  } catch (e) {
    // API not responding or local file mode
  }

  const match = (window.STORYLENS_PRELOADED?.checkpoints || preloadedCheckpoints || []).find(
    cp => cp.character === character && cp.scene_order === sceneOrder
  );

  if (match) {
    currentState = match;
    renderAll(currentState);
  } else {
    // Synthesize fallback state from preloaded graph if available
    const key = `${character}_${sceneOrder}`;
    const graphData = window.STORYLENS_PRELOADED?.graphs?.[key];
    const memNodes = (graphData?.nodes || []).filter(n => n.type === "Memory");
    const personaNodes = (graphData?.nodes || []).filter(n => n.type === "PersonaPhase");
    const relNodes = (graphData?.nodes || []).filter(n => n.type === "RelationshipPhase");

    currentState = {
      character: character,
      scene_order: sceneOrder,
      is_official_checkpoint: false,
      checkpoint_id: null,
      screenplay_interval: null,
      current_states: null,
      developments: null,
      cumulative_memories_count: memNodes.length,
      cumulative_memories: memNodes.map(m => ({
        source_memory_id: m.source_record_id,
        source_role_id: m.properties.role_id || "Role 0",
        memory_text: m.properties.memory_text,
        access_type: m.properties.access_type,
        fact_origin: m.properties.fact_origin,
        available_from: m.properties.available_from,
        grounded_facts: []
      })),
      active_persona_phases: personaNodes.map(p => ({
        source_persona_phase_id: p.source_record_id,
        valid_from: p.properties.valid_from,
        valid_until: p.properties.valid_until,
        traits: p.properties.traits,
        behavioral_constraints: p.properties.behavioral_constraints,
        speaking_style: p.properties.speaking_style
      })),
      active_relationship_phases: relNodes.map(r => ({
        source_relationship_phase_id: r.source_record_id,
        target: r.properties.target,
        polarity: r.properties.polarity,
        description: r.properties.description,
        valid_from: r.properties.valid_from,
        valid_until: r.properties.valid_until
      })),
      timing_flags: []
    };
    renderAll(currentState);
  }
}

async function loadGraph(character, sceneOrder) {
  const key = `${character}_${sceneOrder}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const apiUrl = `/api/graph?character=${encodeURIComponent(character)}&scene=${sceneOrder}`;
    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      currentGraphData = await res.json();
      renderGraph(currentGraphData);
      return;
    }
  } catch (e) {
    // API not responding or local file mode
  }

  if (window.STORYLENS_PRELOADED && window.STORYLENS_PRELOADED.graphs && window.STORYLENS_PRELOADED.graphs[key]) {
    currentGraphData = window.STORYLENS_PRELOADED.graphs[key];
    renderGraph(currentGraphData);
    return;
  }

  console.warn("Could not find graph data for:", key);
}

/* ==========================================================================
   Temporal Knowledge Graph Visualizer (SVG)
   ========================================================================== */

function renderGraph(graphData) {
  const meta = graphData.metadata || {};
  const scene = meta.as_of_scene || 1;
  const char = meta.query_character || "Hazel Grace";
  const isOfficial = meta.is_official_checkpoint;

  document.getElementById("graph-heading").textContent = `Story Graph as of Scene ${scene}`;
  document.getElementById("graph-subtitle").textContent =
    `Verified entities, knowledge boundaries, and relations for ${char} bounded by Scene ${scene}`;
  document.getElementById("graph-node-count").textContent = `${graphData.node_count} nodes`;
  document.getElementById("graph-edge-count").textContent = `${graphData.edge_count} edges`;

  // Non-checkpoint indicator
  const notice = document.getElementById("graph-non-checkpoint-notice");
  if (!isOfficial) {
    notice.style.display = "block";
    notice.textContent = `Scene ${scene} is a Non-Checkpoint Scene: No Task 1 claims or developments exist.`;
  } else {
    notice.style.display = "none";
  }

  // Reset inspector
  selectedNodeId = null;
  clearInspector();

  // Reset transform
  transform = { x: 0, y: 0, k: 1 };
  applyTransform();

  // Draw nodes & edges
  drawGraph(graphData);
}

function drawGraph(graphData) {
  const nodesGroup = document.getElementById("graph-nodes-group");
  const edgesGroup = document.getElementById("graph-edges-group");
  nodesGroup.innerHTML = "";
  edgesGroup.innerHTML = "";

  const allNodes = graphData.nodes || [];
  const allEdges = graphData.edges || [];

  // Filter nodes based on activeLayer
  const filteredNodes = allNodes.filter(n => {
    if (activeLayer === "all") return true;
    if (activeLayer === "checkpoint") {
      return ["Checkpoint", "StateClaim", "Development", "Character", "Scene"].includes(n.type);
    }
    if (activeLayer === "phases") {
      return ["PersonaPhase", "RelationshipPhase", "Character", "Entity", "Scene"].includes(n.type);
    }
    if (activeLayer === "memories") {
      return ["Memory", "Fact", "Character", "Scene"].includes(n.type);
    }
    if (activeLayer === "scenes") {
      return ["Scene", "Story", "Character"].includes(n.type);
    }
    return true;
  });

  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

  // Filter edges to preserve strict referential integrity
  const filteredEdges = allEdges.filter(e =>
    filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
  );

  // Layout positions computation
  const positions = computeNodePositions(filteredNodes, graphData.metadata, filteredEdges);

  // Compute bounding box across all filtered nodes to auto-fit viewBox perfectly
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  filteredNodes.forEach(node => {
    const p = positions[node.id];
    if (p) {
      const r = getNodeRadius(node.type);
      minX = Math.min(minX, p.x - r - 25);
      maxX = Math.max(maxX, p.x + r + 25);
      minY = Math.min(minY, p.y - r - 15);
      maxY = Math.max(maxY, p.y + r + 25);
    }
  });

  if (!isFinite(minX)) {
    minX = 0; maxX = 800; minY = 0; maxY = 500;
  }

  const pad = 35;
  const vbX = Math.floor(minX - pad);
  const vbY = Math.floor(minY - pad);
  const vbW = Math.max(300, Math.ceil(maxX - minX + pad * 2));
  const vbH = Math.max(250, Math.ceil(maxY - minY + pad * 2));

  const svg = document.getElementById("graph-svg");
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Draw Edges (strictly behind nodes because edgesGroup precedes nodesGroup in DOM)
  filteredEdges.forEach(edge => {
    const srcPos = positions[edge.source];
    const tgtPos = positions[edge.target];
    if (!srcPos || !tgtPos) return;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const d = calculateEdgePath(srcPos, tgtPos);
    path.setAttribute("d", d);
    path.setAttribute("class", "graph-edge");
    path.setAttribute("data-edge-id", edge.id);
    path.setAttribute("data-source", edge.source);
    path.setAttribute("data-target", edge.target);
    path.setAttribute("marker-end", "url(#arrow)");

    // Tooltip
    const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleEl.textContent = `[${edge.type}] ${edge.source} -> ${edge.target}`;
    path.appendChild(titleEl);

    edgesGroup.appendChild(path);
  });

  // Draw Nodes
  filteredNodes.forEach(node => {
    const pos = positions[node.id];
    if (!pos) return;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("class", `graph-node ${selectedNodeId === node.id ? "selected" : ""}`);
    g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
    g.setAttribute("data-node-id", node.id);

    const colorClass = `node-${node.type.toLowerCase()}`;
    const radius = getNodeRadius(node.type);

    if (node.type === "Story") {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", -radius);
      rect.setAttribute("y", -radius);
      rect.setAttribute("width", radius * 2);
      rect.setAttribute("height", radius * 2);
      rect.setAttribute("rx", 3);
      rect.setAttribute("class", colorClass);
      g.appendChild(rect);
    } else if (node.type === "Checkpoint") {
      // Rotate 45deg for an iconic archival diamond marker
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", -radius);
      rect.setAttribute("y", -radius);
      rect.setAttribute("width", radius * 2);
      rect.setAttribute("height", radius * 2);
      rect.setAttribute("transform", "rotate(45)");
      rect.setAttribute("rx", 2);
      rect.setAttribute("class", colorClass);
      g.appendChild(rect);
    } else {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", radius);
      circle.setAttribute("class", colorClass);
      g.appendChild(circle);
    }

    // Inner marker text inside the shape
    const innerText = getInnerNodeText(node, pos);
    if (innerText) {
      const textInner = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const isDark = node.type === "Scene" || node.type === "PersonaPhase" || node.type === "Entity" || node.type === "Fact";
      textInner.setAttribute("class", `node-label-inner ${isDark ? "dark" : ""}`);
      textInner.setAttribute("text-anchor", "middle");
      textInner.setAttribute("dominant-baseline", "central");
      textInner.textContent = innerText;
      g.appendChild(textInner);
    }

    // Concise non-overlapping label below node marker
    const belowLabel = getBelowNodeLabel(node, pos);
    if (belowLabel) {
      const textBelow = document.createElementNS("http://www.w3.org/2000/svg", "text");
      textBelow.setAttribute("class", "node-label");
      textBelow.setAttribute("y", radius + 11);
      textBelow.setAttribute("text-anchor", "middle");
      textBelow.textContent = belowLabel;
      g.appendChild(textBelow);
    }

    // Comprehensive tooltip
    const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titleEl.textContent = `${node.type}: ${node.label} (${node.id})`;
    g.appendChild(titleEl);

    // Click handler for inspector
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      selectNode(node, filteredEdges);
    });

    nodesGroup.appendChild(g);
  });
}

function getNodeRadius(type) {
  switch (type) {
    case "Character": return 18;
    case "Checkpoint": return 16;
    case "Story": return 16;
    case "Scene": return 14;
    case "StateClaim": return 11;
    case "Development": return 11;
    case "PersonaPhase": return 10;
    case "RelationshipPhase": return 10;
    case "Entity": return 9;
    case "Memory": return 8;
    case "Fact": return 6;
    default: return 9;
  }
}

function getInnerNodeText(node, pos) {
  if (node.type === "Scene") return `S${node.properties.scene_order}`;
  if (node.type === "Character") {
    return node.label === "Hazel Grace" ? "HG" : (node.label === "Augustus Waters" ? "AW" : node.label.slice(0, 2).toUpperCase());
  }
  if (node.type === "Checkpoint") return "CP";
  if (node.type === "Story") return "STORY";
  if (node.type === "StateClaim") return `C${pos.claimIdx || ""}`;
  if (node.type === "Development") return "D";
  if (node.type === "PersonaPhase") return "P";
  if (node.type === "RelationshipPhase") return "R";
  if (node.type === "Entity") return "E";
  if (node.type === "Memory") return "M";
  if (node.type === "Fact") return "F";
  return "";
}

function getBelowNodeLabel(node, pos) {
  // Scene nodes have S1, S2 inside the circle, so no duplicate label below
  if (node.type === "Scene") return null;
  if (node.type === "Character") return node.label;
  if (node.type === "Checkpoint") return `CP ${node.properties.sequence_index || ""}`;
  if (node.type === "Story") return "TFIOS";
  if (node.type === "StateClaim") return `Claim ${pos.claimIdx || ""}`;
  if (node.type === "Development") return "Dev";
  if (node.type === "PersonaPhase") return "Persona";
  if (node.type === "RelationshipPhase") return node.properties.target ? node.properties.target.slice(0, 9) : "Rel";
  if (node.type === "Entity") return node.label.slice(0, 11);
  if (node.type === "Memory") return `M${pos.colIdx !== undefined ? pos.colIdx + 1 : ""}`;
  if (node.type === "Fact") return `F${pos.colIdx !== undefined ? pos.colIdx + 1 : ""}`;
  return node.label.slice(0, 10);
}

function calculateEdgePath(src, tgt) {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return `M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`;

  // Timeline horizontal spine edge between adjacent scenes: straight line
  if (Math.abs(src.y - tgt.y) < 2 && Math.abs(src.y - 320) < 10) {
    return `M ${src.x} ${src.y} L ${tgt.x} ${tgt.y}`;
  }

  // Subtle quadratic bezier curve for other relations
  const midX = (src.x + tgt.x) / 2 - dy * 0.08;
  const midY = (src.y + tgt.y) / 2 + dx * 0.08;
  return `M ${src.x} ${src.y} Q ${midX} ${midY} ${tgt.x} ${tgt.y}`;
}

function computeNodePositions(nodes, metadata, edges = []) {
  const positions = {};
  const asOfScene = metadata.as_of_scene || 1;

  // Separate nodes by type
  const scenes = nodes
    .filter(n => n.type === "Scene")
    .sort((a, b) => a.properties.scene_order - b.properties.scene_order);
  const focalChar = nodes.find(n => n.type === "Character" && n.label === metadata.query_character) ||
                    nodes.find(n => n.type === "Character");
  const otherChars = nodes.filter(n => n.type === "Character" && n.id !== focalChar?.id);
  const story = nodes.find(n => n.type === "Story");
  const checkpoint = nodes.find(n => n.type === "Checkpoint");
  const claims = nodes.filter(n => n.type === "StateClaim");
  const developments = nodes.filter(n => n.type === "Development");
  const personas = nodes.filter(n => n.type === "PersonaPhase");
  const rels = nodes.filter(n => n.type === "RelationshipPhase");
  const entities = nodes.filter(n => n.type === "Entity");
  const memories = nodes.filter(n => n.type === "Memory");
  const facts = nodes.filter(n => n.type === "Fact");

  // Dynamic scene step so the timeline stays beautifully compact and centered
  const sceneCount = scenes.length;
  const sceneStartX = 200;
  const sceneStep = sceneCount <= 6 ? 90 : (sceneCount <= 12 ? 65 : 45);

  const sceneXMap = {};
  scenes.forEach((scNode, idx) => {
    const x = sceneStartX + idx * sceneStep;
    const y = 300;
    positions[scNode.id] = { x, y };
    sceneXMap[scNode.properties.scene_order] = x;
  });

  // 2. Left Flank: Story, Characters, PersonaPhases
  if (story) {
    positions[story.id] = { x: 75, y: 70 };
  }

  if (focalChar) {
    positions[focalChar.id] = { x: 75, y: 180 };
  }

  otherChars.forEach((cNode, idx) => {
    positions[cNode.id] = { x: 75, y: 280 + idx * 70 };
  });

  personas.forEach((pNode, idx) => {
    positions[pNode.id] = { x: 140, y: 150 + idx * 60 };
  });

  // 3. Right Flank: RelationshipPhases and Target Entities
  const maxSceneX = sceneCount > 0 ? (sceneStartX + (sceneCount - 1) * sceneStep) : sceneStartX;
  const rightFlankX = Math.max(maxSceneX + 90, 520);

  rels.forEach((rNode, idx) => {
    positions[rNode.id] = { x: rightFlankX, y: 55 + idx * 44 };
  });

  entities.forEach((eNode, idx) => {
    positions[eNode.id] = { x: rightFlankX + 110, y: 55 + idx * 48 };
  });

  // 4. Top Tier: Checkpoint, StateClaims, Developments
  const cpScene = checkpoint?.properties?.scene_order || asOfScene;
  const cpX = sceneXMap[cpScene] || (sceneCount > 0 ? sceneStartX + (sceneCount - 1) * sceneStep : 400);

  if (checkpoint) {
    positions[checkpoint.id] = { x: cpX, y: 160 };
  }

  // State Claims arranged in clean rows above Checkpoint
  claims.forEach((clNode, idx) => {
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    const numInRow = Math.min(4, claims.length - row * 4);
    const colOffset = (col - (numInRow - 1) / 2) * 58;
    positions[clNode.id] = {
      x: cpX + colOffset,
      y: 50 + row * 44,
      claimIdx: idx + 1
    };
  });

  // Developments placed to the left of the Checkpoint
  developments.forEach((devNode, idx) => {
    positions[devNode.id] = { x: Math.max(80, cpX - 75 - idx * 55), y: 160 };
  });

  // 5. Bottom Tier: Memories & Grounded Facts
  // Map memories to their child facts via GROUNDED_IN_FACT edges
  const memToFacts = {};
  edges.forEach(e => {
    if ((e.type === "GROUNDED_IN_FACT" || e.type === "GROUNDED_IN") && e.source.startsWith("memory:") && e.target.startsWith("fact:")) {
      if (!memToFacts[e.source]) memToFacts[e.source] = [];
      memToFacts[e.source].push(e.target);
    }
  });

  // Group memories by their available_from scene
  const sceneMemMap = {};
  memories.forEach(m => {
    const s = m.properties.available_from ? m.properties.available_from.scene_order : 1;
    if (!sceneMemMap[s]) sceneMemMap[s] = [];
    sceneMemMap[s].push(m);
  });

  // Lay out memories and facts deterministically in scene columns
  Object.keys(sceneMemMap).forEach(sStr => {
    const s = parseInt(sStr, 10);
    const memList = sceneMemMap[s];
    memList.sort((a, b) => a.id.localeCompare(b.id));

    const colBaseX = sceneXMap[s] || (sceneStartX + (s - 1) * sceneStep);

    memList.forEach((mNode, mIdx) => {
      const memX = colBaseX - 22;
      const memY = 360 + mIdx * 44;
      positions[mNode.id] = { x: memX, y: memY, colIdx: mIdx };

      // Grounded child facts
      const childFacts = memToFacts[mNode.id] || [];
      childFacts.forEach((factId, fIdx) => {
        positions[factId] = { x: colBaseX + 22, y: memY + fIdx * 20, colIdx: fIdx };
      });
    });
  });

  // Fallback for any unassigned facts
  facts.forEach((fNode, idx) => {
    if (!positions[fNode.id]) {
      const parentId = fNode.id.split(":")[1];
      const parentPos = positions[`memory:${parentId}`];
      if (parentPos) {
        positions[fNode.id] = { x: parentPos.x + 44, y: parentPos.y + (idx % 2) * 20, colIdx: 0 };
      } else {
        const s = fNode.properties.fact_origin ? fNode.properties.fact_origin.scene_order : 1;
        const colBaseX = sceneXMap[s] || sceneStartX;
        positions[fNode.id] = { x: colBaseX + 22, y: 360 + idx * 24, colIdx: idx };
      }
    }
  });

  return positions;
}

function selectNode(node, filteredEdges) {
  selectedNodeId = node.id;

  // Highlight selected node
  document.querySelectorAll(".graph-node").forEach(el => {
    const isSel = el.dataset.nodeId === node.id;
    el.classList.toggle("selected", isSel);
  });

  // Highlight connected edges
  document.querySelectorAll(".graph-edge").forEach(edgeEl => {
    const src = edgeEl.dataset.source;
    const tgt = edgeEl.dataset.target;
    const isConn = (src === node.id || tgt === node.id);
    edgeEl.classList.toggle("highlighted", isConn);
    edgeEl.classList.toggle("dimmed", !isConn);
    if (isConn) {
      edgeEl.setAttribute("marker-end", "url(#arrow-highlight)");
    } else {
      edgeEl.setAttribute("marker-end", "url(#arrow)");
    }
  });

  renderInspector(node);
}

function clearInspector() {
  document.getElementById("inspector-badge").textContent = "Node Inspector";
  document.getElementById("inspector-badge").className = "inspector-type-badge badge-official";
  document.getElementById("inspector-title").textContent = "Click any node to view details";
  document.getElementById("inspector-body").innerHTML = `
    <div class="inspector-empty">
      Select a node in the graph to inspect its properties, evidence citations, event origin time, knowledge availability time, and source provenance.
    </div>
  `;
}

const SCENE_METADATA = {
  "1": {
    "title": "INT. DOCTOR'S OFFICE / EXAM ROOM - DAY",
    "characters": [
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "The doctor asserts that Hazel is depressed despite her repeated denials.",
      "A medical appointment where Hazel's condition is discussed by her mother and the doctor.",
      "Hazel narrates that her depression is not due to cancer but to the fact of dying.",
      "Hazel repeatedly insists she is not depressed, countering the doctor's diagnosis.",
      "Hazel briefly watches a playful couple at Starbucks before returning to her book."
    ]
  },
  "2": {
    "title": "INT. CHURCH BASEMENT - DAY",
    "characters": [
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "The doctor considers switching Hazel's medication to Zoloft or Lexapro with increased frequency.",
      "Hazel sarcastically responds to the doctor's suggestion of increasing medication, comparing herself to Keith Richards.",
      "A medical consultation involving Hazel, her mother Frannie, and the doctor, focusing on mental health and treatment options.",
      "Hazel challenges the doctor's use of the word 'journey' to describe illness, showing resistance to euphemistic language.",
      "The doctor raises the topic of Hazel attending the suggested support group, prompting resistance and skepticism.",
      "The doctor dismisses Hazel's protest and insists she try the support group, appealing to personal obligation."
    ]
  },
  "3": {
    "title": "INT. CHURCH BASEMENT - SUPPORT GROUP",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "Hazel participates in a cancer support group meeting in a church basement, where members share their cancer stories.",
      "Hazel and Isaac exchange a knowing look of disapproval toward Patrick's speech.",
      "Patrick calls on Hazel to share her story during the support group session.",
      "Hazel verbally discloses her thyroid cancer with lung metastases during the support group session.",
      "The group collectively says 'We're here for you' after Hazel shares her story.",
      "A gathering of young cancer patients in a church basement led by Patrick, where members share personal experiences with cancer."
    ]
  },
  "4": {
    "title": "INT. CHURCH BASEMENT - CIRCLE ROOM",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "Hazel comes out of the church and gets into the car without speaking, only exhaling in response to Frannie's silent question.",
      "Frannie looks at Hazel with a questioning expression; Hazel responds only with an exhale, conveying ambivalence or fatigue.",
      "A group session takes place inside the church, which Frannie waits for to end and Hazel participates in."
    ]
  },
  "5": {
    "title": "INT. CHURCH BASEMENT - MEETING CONTINUES",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "Frannie suggests Hazel call her friends, but Hazel dismisses the idea indifferently.",
      "Hazel proposes that her parents go to a movie, encouraging them to take a break from staying home and attending to her.",
      "Michael asks if Hazel wants to see a movie, but she redirects the idea to her parents instead.",
      "A Friday night family gathering in the living room, centered around passive TV watching and unspoken concern for Hazel."
    ]
  },
  "6": {
    "title": "INT. CHURCH HALLWAY - LATER",
    "characters": [
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "A scheduled gathering for individuals with shared experiences to provide mutual support, which Hazel is being sent to attend.",
      "Hazel's parents insist she attend a support group, overriding her objections.",
      "Hazel sarcastically rejects the idea of attending support group and suggests getting a fake ID instead.",
      "Frannie ends the discussion by ordering Hazel to get in the car."
    ]
  },
  "7": {
    "title": "INT. CHURCH - SAME",
    "characters": [
      "Augustus Waters",
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "A church service taking place at an Episcopalian sanctuary in suburban Indianapolis.",
      "Hazel goes to a church service at an Episcopalian sanctuary, not out of personal desire but to please her parents.",
      "Frannie shouts a suggestion to Hazel to make friends before leaving."
    ]
  },
  "8": {
    "title": "INT. CHURCH HALLWAY / STAIRS - SAME",
    "characters": [
      "Augustus Waters",
      "Hazel Grace"
    ],
    "events": [
      "Hazel chooses to take the stairs instead of the elevator after encountering a very sick child.",
      "After bumping into each other, Gus and Hazel exchange brief, polite apologies.",
      "Hazel collides with Gus, a strikingly attractive boy, leading to a moment of mutual awareness and speechlessness."
    ]
  },
  "9": {
    "title": "INT. CHURCH BASEMENT - LATER",
    "characters": [
      "Augustus Waters",
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "Augustus Waters shares his existential fear of oblivion during the support group meeting, prompting Hazel to respond.",
      "Hazel looks in the mirror and reacts negatively to her own appearance, indicating self-disapproval or distress."
    ]
  },
  "10": {
    "title": "EXT. OUTSIDE THE CHURCH - LATER",
    "characters": [
      "Augustus Waters",
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "A gathering of cancer patients in a church basement for sharing experiences and emotional support.",
      "Isaac reveals he will undergo another surgery soon and will likely become blind as a result.",
      "Hazel meets Augustus's persistent stare with equal intensity, initiating a silent contest of wills.",
      "Hazel initiates and wins a silent staring contest with Augustus after feeling his persistent gaze.",
      "Augustus reveals his name, age, and cancer history, including losing a leg to osteosarcoma and being in remission.",
      "Augustus states that his greatest fear is oblivion, because he wants to live an extraordinary life and be remembered.",
      "Hazel argues that oblivion is inevitable for everyone, and that fearing it is pointless because even great historical figures will eventually be forgotten.",
      "Hazel publicly responds to Augustus's fear of oblivion by arguing it is inevitable and should be ignored."
    ]
  },
  "11": {
    "title": "EXT. OUTSIDE THE CHURCH - SIDEWALK - LATER",
    "characters": [
      "Augustus Waters",
      "Hazel Grace"
    ],
    "events": [
      "Augustus tells Hazel she is beautiful, marking the beginning of their romantic tension.",
      "Hazel encounters Augustus (Gus) for the first time outside the church; he approaches her, compliments her, and initiates conversation that leads to a connection.",
      "A casual gathering outside the church after an event, where teens socialize and couples interact.",
      "Augustus invites Hazel to watch a movie immediately, proposing an impromptu outing.",
      "Hazel criticizes Augustus for holding a cigarette, seeing it as self-destructive and hypocritical given his cancer history.",
      "Augustus shocks Hazel by pulling out a cigarette but explains it is unlit and symbolic \u2014 representing control over one's fate despite danger.",
      "Hazel declines her mother's offer to go home, choosing instead to follow through on impromptu plans with Augustus."
    ]
  },
  "12": {
    "title": "EXT. SUBURBAN STREET / CAR - LATER",
    "characters": [
      "Augustus Waters",
      "Hazel Grace"
    ],
    "events": [
      "Hazel reacts with sarcasm and dry humor to Gus's admission of being a bad driver.",
      "Gus admits to failing his driving test multiple times and jokes about his poor driving being a 'cancer perk.'",
      "Gus discloses that he failed his driving test multiple times and barely passed on the fourth attempt, with an instructor deeming his driving 'unpleasant but not technically unsafe.'",
      "Hazel takes a deep breath and begins recounting the discovery of her cancer, signaling a moment of emotional significance.",
      "A car ride during which Hazel and Gus engage in personal conversation while traveling together."
    ]
  },
  "13": {
    "title": "FLASHBACK - INT. HOSPITAL CLINIC - DAY",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "I remember the needle, the cold table, the pressure in my neck\u2014and then just one sentence, spoken like it was final: Stage IV thyroid cancer."
    ]
  },
  "14": {
    "title": "FLASHBACK - INT. HAZEL'S BEDROOM - NIGHT",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "Hazel experiences acute respiratory distress as fluid accumulates in her lungs, escalating into a medical emergency between initial diagnosis and intensive care hospitalization."
    ]
  },
  "15": {
    "title": "FLASHBACK - INT. HOSPITAL ICU - NIGHT",
    "characters": [
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "Dad calls emergency services as Hazel struggles to breathe.",
      "Frannie comforts Hazel by running her fingers through her hair as Hazel prepares for a medical procedure.",
      "Frannie tearfully asks Hazel if she is ready, likely referring to a medical procedure or transition.",
      "Michael becomes overwhelmed with emotion and breaks down, unable to contain his feelings any longer."
    ]
  },
  "16": {
    "title": "FLASHBACK - INT. HOSPITAL ICU - MORNING",
    "characters": [
      "Hazel Grace"
    ],
    "events": [
      "A morning period in the ICU where Hazel shows visible signs of recovery.",
      "Hazel begins to recover from her illness as the antibiotics take effect and fluid is drained from her lungs."
    ]
  },
  "17": {
    "title": "INT. GUS'S CAR - SAME",
    "characters": [
      "Augustus Waters",
      "Hazel Grace"
    ],
    "events": [
      "During the drive to Gus's house, Hazel shares that her tumors have shrunk and her metastases have remained nearly unchanged, but she emphasizes that her lungs still do not function well. This revelation contextualizes her difficulty breathing as she descends the stairs to Gus's basement bedroom, where she labors noticeably while carrying her oxygen tank and needs time to recover once seated on the bed.",
      "During the car ride to Gus's house, Hazel discusses her tumor stability and compromised lung capacity, explaining the physical reality of her breathing challenges."
    ]
  },
  "18": {
    "title": "EXT/INT. GUS'S HOUSE - SAME",
    "characters": [
      "Augustus Waters",
      "Hazel Grace"
    ],
    "events": [
      "Hazel reveals that her tumors have shrunk and her metastases have barely progressed, indicating a temporary medical stabilization despite ongoing lung issues.",
      "An informal, intimate conversation between Hazel and Gus during a car ride, serving as emotional and informational bonding time.",
      "Gus playfully attributes Hazel's sophistication to her being a college girl after learning she has her GED.",
      "Hazel responds to Gus's joke with a light shove, signaling ease and growing intimacy.",
      "Gus successfully drives and parks his car in his driveway, marking the end of the car ride and transition to a new location."
    ]
  },
  "19": {
    "title": "INT. HAZEL'S BEDROOM - ANOTHER NIGHT",
    "characters": [
      "Augustus Waters",
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "Gus rolls his eyes when explaining his parents' engraved plaques as 'encouragements', signaling mild embarrassment or affectionate mockery to Hazel.",
      "Gus's parents are preparing dinner in the kitchen when Hazel arrives with Gus.",
      "Gus brings Hazel into his house and introduces her to his parents, who are making dinner in the kitchen.",
      "Hazel clarifies that she goes by 'Hazel', not 'Hazel Grace', asserting her preferred identity.",
      "Gus abruptly ends the parental introduction and pulls Hazel downstairs, redirecting focus to private time together.",
      "Gus leads Hazel downstairs to his basement bedroom, revealing personal space filled with video games, band posters, and basketball memorabilia.",
      "Hazel struggles with breathing after descending stairs and standing, requiring rest on Gus's bed.",
      "Hazel names 'An Imperial Affliction' as her favorite novel, describing it as deeply meaningful and spiritually significant to her.",
      "Gus commits to reading 'An Imperial Affliction' despite initial skepticism, marking a shift in his attitude toward Hazel's inner world.",
      "Gus gives Hazel a novelization of his favorite video game in exchange for her reading 'An Imperial Affliction', forming a symbolic pact.",
      "Their hands briefly tangle when exchanging books, creating a moment of romantic tension and connection.",
      "Gus and Hazel have an intimate conversation in his basement bedroom after being introduced to his parents.",
      "Gus flirts with Hazel by saying he loves it when she talks medical, responding to her explanation of cold hands."
    ]
  },
  "20": {
    "title": "INT. HAZEL'S DINING ROOM - NIGHT",
    "characters": [
      "Augustus Waters",
      "Frannie Lancaster",
      "Hazel Grace"
    ],
    "events": [
      "Hazel is reading a novella written by Gus, indicating he gave her the book, which represents a personal and creative gesture.",
      "Hazel insists she is not waiting for Gus to call, despite clear signs of anticipation.",
      "Frannie observes the new book and comments on it, initiating a brief exchange about Gus.",
      "Hazel reads Gus's novella in bed at night while Frannie briefly visits the room.",
      "Hazel repeatedly checks her phone while engaging in daily activities, revealing her emotional preoccupation with hearing from Gus."
    ]
  }
};

function renderInspector(node) {
  const badge = document.getElementById("inspector-badge");
  const title = document.getElementById("inspector-title");
  const body = document.getElementById("inspector-body");

  badge.textContent = node.type;
  badge.className = `inspector-type-badge node-${node.type.toLowerCase()}`;

  const props = node.properties || {};

  // Clean, unabridged, contextual title by node type
  if (node.type === "Memory") {
    const scNum = props.available_from ? props.available_from.scene_order : "1";
    title.textContent = `Character Memory (Scene ${scNum})`;
  } else if (node.type === "Fact") {
    const scNum = props.fact_origin ? props.fact_origin.scene_order : "1";
    title.textContent = `Grounded Narrative Fact (Scene ${scNum})`;
  } else if (node.type === "Scene") {
    const scNum = props.scene_order || parseInt(node.id.replace("scene:", ""), 10);
    const meta = SCENE_METADATA[scNum] || {};
    const titleText = props.scene_title || meta.title || `Scene ${scNum}`;
    title.textContent = `Scene ${scNum}: ${titleText}`;
  } else if (node.type === "StateClaim") {
    title.textContent = "Task 1 Checkpoint State Claim";
  } else if (node.type === "Development") {
    title.textContent = "Narrative Development";
  } else if (node.type === "PersonaPhase") {
    title.textContent = "Persona Phase";
  } else if (node.type === "RelationshipPhase") {
    title.textContent = `Relationship: ${props.target || "Phase"}`;
  } else if (node.type === "Checkpoint") {
    title.textContent = `Official Checkpoint ${props.sequence_index || ""}`;
  } else if (node.type === "Character") {
    title.textContent = `Character: ${props.canonical_name || node.label}`;
  } else {
    title.textContent = node.label;
  }

  let html = `<div style="margin-bottom:10px; font-family:var(--font-mono); font-size:11px; color:var(--text-muted); word-break:break-all;">ID: ${escapeHtml(node.id)}</div>`;

  // Specialized detail views by node type
  if (node.type === "Memory") {
    const memText = props.memory_text || (node.label.startsWith("Memory: ") ? node.label.slice(8) : node.label);
    html += `
      <div style="font-size:14px; color:var(--text-primary); font-weight:600; margin-bottom:12px; line-height:1.55; padding:12px 14px; background:var(--panel-bg); border:1px solid var(--border-medium); border-radius:6px; border-left:4px solid var(--color-burgundy); word-break:break-word;">
        "${escapeHtml(memText)}"
      </div>
      <div class="memory-timing-grid" style="margin-top:8px;">
        <div>
          <div class="timing-col-label">How Learned</div>
          <div class="timing-col-val"><span class="access-badge access-${props.access_type}">${props.access_type}</span></div>
        </div>
        <div>
          <div class="timing-col-label">Event Happened At</div>
          <div class="timing-col-val">Scene ${props.fact_origin ? props.fact_origin.scene_order : "N/A"}</div>
        </div>
        <div>
          <div class="timing-col-label">Known By Character From</div>
          <div class="timing-col-val" style="color:var(--text-primary); font-weight:700;">Scene ${props.available_from ? props.available_from.scene_order : "N/A"}</div>
        </div>
      </div>
    `;

    if (props.grounded_facts && props.grounded_facts.length > 0) {
      html += `
        <div style="margin-top:14px;">
          <div class="inspector-prop-label" style="margin-bottom:6px;">Grounded Objective Facts (${props.grounded_facts.length})</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${props.grounded_facts.map(gf => `
              <div style="font-size:12.5px; color:var(--text-primary); line-height:1.45; padding:8px 10px; background:var(--card-bg); border:1px solid var(--border-subtle); border-radius:4px;">
                ${escapeHtml(gf)}
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }
  } else if (node.type === "Fact") {
    const factText = props.fact_text || (node.label.startsWith("Fact: ") ? node.label.slice(6) : node.label);
    html += `
      <div style="font-size:14px; color:var(--text-primary); font-weight:600; margin-bottom:12px; line-height:1.55; padding:12px 14px; background:var(--panel-bg); border:1px solid var(--border-medium); border-radius:6px; border-left:4px solid var(--color-warm-brown); word-break:break-word;">
        ${escapeHtml(factText)}
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Event Scene Origin</div>
        <div class="inspector-prop-val">Scene ${props.fact_origin ? props.fact_origin.scene_order : "N/A"}</div>
      </div>
    `;
    if (props.source_memory_text) {
      html += `
        <div style="margin-top:10px;">
          <div class="inspector-prop-label" style="margin-bottom:4px;">Derived from Character Memory</div>
          <div style="font-size:12.5px; color:var(--text-primary); font-style:italic; line-height:1.45; padding:8px 10px; background:var(--card-bg); border:1px solid var(--border-subtle); border-radius:4px;">
            "${escapeHtml(props.source_memory_text)}"
          </div>
        </div>
      `;
    }
  } else if (node.type === "Scene") {
    const scNum = props.scene_order || parseInt(node.id.replace("scene:", ""), 10);
    const meta = SCENE_METADATA[scNum] || {};
    const titleText = props.scene_title || meta.title || `Scene ${scNum}`;
    const events = (props.events && props.events.length > 0) ? props.events : (meta.events || []);
    const characters = (props.characters && props.characters.length > 0) ? props.characters : (meta.characters || []);
    const desc = props.description || (events.length > 0 ? events.join(" ") : `Scene ${scNum} of screenplay.`);

    html += `
      <div style="margin-bottom:12px;">
        <div class="inspector-prop-label" style="margin-bottom:4px;">Setting / Script Location</div>
        <div style="font-size:14px; font-weight:700; color:var(--color-burgundy);">${escapeHtml(titleText)}</div>
      </div>

      <div style="margin-bottom:12px;">
        <div class="inspector-prop-label" style="margin-bottom:6px;">Scene Narrative & Events</div>
        <div style="font-size:13px; line-height:1.55; color:var(--text-primary); background:var(--panel-bg); padding:10px 14px; border-radius:6px; border:1px solid var(--border-medium); border-left:4px solid var(--color-warm-brown);">
          ${events.length > 0 
            ? `<ul style="margin:0; padding-left:18px;">${events.map(ev => `<li style="margin-bottom:6px; color:var(--text-primary);">${escapeHtml(ev)}</li>`).join("")}</ul>`
            : `<p style="margin:0; color:var(--text-primary);">${escapeHtml(desc)}</p>`}
        </div>
      </div>

      ${characters.length > 0 ? `
      <div class="inspector-prop-row" style="margin-bottom:10px;">
        <div class="inspector-prop-label">Characters Present in Scene</div>
        <div class="inspector-prop-val" style="display:flex; flex-wrap:wrap; gap:5px; margin-top:4px;">
          ${characters.map(c => `<span style="font-size:11.5px; padding:3px 8px; border-radius:4px; background:var(--card-bg); border:1px solid var(--border-medium); color:var(--text-primary); font-weight:600;">${escapeHtml(c)}</span>`).join("")}
        </div>
      </div>` : ""}

      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Screenplay Progression</div>
        <div class="inspector-prop-val">Scene ${scNum} of 20</div>
      </div>
    `;
  } else if (node.type === "StateClaim") {
    html += `
      <div style="font-size:14px; color:var(--text-primary); margin-bottom:12px; font-weight:600; line-height:1.5; padding:10px 12px; background:var(--panel-bg); border:1px solid var(--border-medium); border-radius:6px; border-left:4px solid var(--color-burgundy);">${escapeHtml(props.claim)}</div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Supporting Evidence Scenes</div>
        <div class="inspector-prop-val">[${(props.evidence_scene_orders || []).join(", ")}]</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Evaluated at Checkpoint</div>
        <div class="inspector-prop-val">${escapeHtml(props.checkpoint_id)}</div>
      </div>
    `;
  } else if (node.type === "Development") {
    html += `
      <div style="font-size:14px; color:var(--text-primary); margin-bottom:12px; font-weight:600; line-height:1.5; padding:10px 12px; background:var(--panel-bg); border:1px solid var(--border-medium); border-radius:6px; border-left:4px solid var(--color-burgundy);">${escapeHtml(props.claim)}</div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Supporting Evidence Scenes</div>
        <div class="inspector-prop-val">[${(props.evidence_scene_orders || []).join(", ")}]</div>
      </div>
    `;
  } else if (node.type === "PersonaPhase") {
    html += `
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Traits</div>
        <div class="inspector-prop-val">${(props.traits || []).map(t => escapeHtml(t)).join("; ") || "None"}</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Behavioral Constraints</div>
        <div class="inspector-prop-val" style="color:var(--text-secondary);">${(props.behavioral_constraints || []).map(b => escapeHtml(b)).join("; ") || "None"}</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Validity Window</div>
        <div class="inspector-prop-val">Scene ${props.valid_from ? props.valid_from.scene_order : "1"} &rarr; ${props.valid_until ? props.valid_until.scene_order : "Open-ended"}</div>
      </div>
    `;
  } else if (node.type === "RelationshipPhase") {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="color:var(--text-primary); font-size:14px;">Target: ${escapeHtml(props.target)}</strong>
        <span class="badge polarity-${props.polarity}">${props.polarity}</span>
      </div>
      <div style="font-size:13.5px; color:var(--text-primary); margin-bottom:10px; line-height:1.45;">${escapeHtml(props.description)}</div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Validity Window</div>
        <div class="inspector-prop-val">Scene ${props.valid_from ? props.valid_from.scene_order : "1"} &rarr; ${props.valid_until ? props.valid_until.scene_order : "Open-ended"}</div>
      </div>
    `;
  } else if (node.type === "Checkpoint") {
    const iv = props.screenplay_interval || {};
    html += `
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Sequence Index</div>
        <div class="inspector-prop-val">Checkpoint ${props.sequence_index}</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Screenplay Interval</div>
        <div class="inspector-prop-val">(${iv.start_scene_order_exclusive}, ${iv.end_scene_order_inclusive}]</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Observation Anchor</div>
        <div class="inspector-prop-val">Scene ${props.scene_order}</div>
      </div>
    `;
  }

  // Provenance metadata
  html += `
    <div style="margin-top:14px; padding-top:10px; border-top:1px solid var(--border-color);">
      <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:4px;">STAGE Provenance:</div>
      <div style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);">Source: ${escapeHtml(node.source_file || "STAGE annotations")}</div>
      ${node.source_record_id ? `<div style="font-family:var(--font-mono); font-size:11px; color:var(--text-secondary);">Record ID: ${escapeHtml(node.source_record_id)}</div>` : ""}
    </div>
  `;

  body.innerHTML = html;
}


/* ==========================================================================
   Existing Character State & Content Renderers (Preserved)
   ========================================================================== */

function renderAll(state) {
  renderStatusBar(state);
  renderCurrentStates(state);
  renderDevelopments(state);
  renderMemories(state);
  renderPersonaAndRelationships(state);
}

function renderStatusBar(state) {
  document.getElementById("status-char").textContent = state.character;
  document.getElementById("status-scene").textContent = `Scene ${state.scene_order}`;
  document.getElementById("current-scene-limit").textContent = state.scene_order;

  const badge = document.getElementById("status-badge");
  const meta = document.getElementById("status-meta");

  if (state.is_official_checkpoint) {
    badge.className = "badge badge-official";
    badge.textContent = `Official Task 1 Checkpoint (Seq ${state.checkpoint_sequence_index})`;

    const iv = state.screenplay_interval;
    const intervalStr = iv ? `Interval: (${iv.start_scene_order_exclusive}, ${iv.end_scene_order_inclusive}]` : "";
    meta.innerHTML = `
      <span>${intervalStr}</span> &bull; 
      <span style="color:var(--text-muted);">${state.checkpoint_id}</span>
    `;
  } else {
    badge.className = "badge badge-non-checkpoint";
    badge.textContent = "Non-Checkpoint Scene";
    meta.innerHTML = `<span style="color:var(--accent-amber);">No official Task 1 state exists at this scene. States are not interpolated.</span>`;
  }
}

function renderCurrentStates(state) {
  const container = document.getElementById("current-states-container");
  const countPill = document.getElementById("current-states-count");
  container.innerHTML = "";

  if (!state.is_official_checkpoint) {
    countPill.textContent = "0";
    container.innerHTML = `
      <div class="empty-notice">
        <strong>No Official Task 1 State at Scene ${state.scene_order}</strong>
        Task 1 character states in STAGE are formally evaluated only at official checkpoints.
        StoryLens preserves narrative factuality and does not invent or interpolate states between checkpoints.
      </div>
    `;
    return;
  }

  const claims = state.current_states || [];
  countPill.textContent = claims.length;

  if (claims.length === 0) {
    container.innerHTML = `<div class="empty-notice">No current-state claims recorded at this checkpoint.</div>`;
    return;
  }

  claims.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    
    const evScenes = (item.evidence_scene_orders || []).join(", ");
    card.innerHTML = `
      <div class="card-title">${idx + 1}. ${escapeHtml(item.claim)}</div>
      <div>
        <span class="evidence-tag">Evidence Scenes: [${evScenes}]</span>
        <span class="provenance-tag">ID: ${item.source_state_id || item.source_checkpoint_id}</span>
        <span class="provenance-tag">Source: ${item.source_file}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderDevelopments(state) {
  const container = document.getElementById("developments-container");
  const countPill = document.getElementById("developments-count");
  container.innerHTML = "";

  if (!state.is_official_checkpoint) {
    countPill.textContent = "0";
    container.innerHTML = `
      <div class="empty-notice">
        <strong>Not an Official Checkpoint</strong>
        Interval developments are defined only between adjacent official checkpoints.
      </div>
    `;
    return;
  }

  const devs = state.developments || [];
  countPill.textContent = devs.length;

  if (devs.length === 0) {
    container.innerHTML = `
      <div class="empty-notice">
        <strong>Initial Checkpoint</strong>
        This is the character's first formal checkpoint in the screenplay; no prior interval developments exist.
      </div>
    `;
    return;
  }

  devs.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "card";
    const evScenes = (item.evidence_scene_orders || []).join(", ");
    card.innerHTML = `
      <div class="card-title">${idx + 1}. ${escapeHtml(item.claim)}</div>
      <div>
        <span class="evidence-tag">Evidence Scenes: [${evScenes}]</span>
        <span class="provenance-tag">ID: ${item.source_development_id}</span>
        <span class="provenance-tag">Source: ${item.source_file}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderMemories(state) {
  const container = document.getElementById("memories-container");
  const countPill = document.getElementById("memories-count");
  const searchTerm = document.getElementById("memory-search").value.toLowerCase().trim();
  const accessFilter = document.getElementById("access-filter").value;

  const allMems = state.cumulative_memories || [];
  
  const filtered = allMems.filter(m => {
    const matchAccess = accessFilter === "all" || m.access_type === accessFilter;
    const matchSearch = !searchTerm || 
      (m.memory_text && m.memory_text.toLowerCase().includes(searchTerm)) ||
      (m.grounded_facts && m.grounded_facts.some(f => f.toLowerCase().includes(searchTerm)));
    return matchAccess && matchSearch;
  });

  countPill.textContent = `${filtered.length} / ${allMems.length}`;
  container.innerHTML = "";

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-notice">
        <strong>No memories match the filter</strong>
        ${allMems.length === 0 ? "No memories available to this character by Scene " + state.scene_order + "." : "Try clearing search or access type filters."}
      </div>
    `;
    return;
  }

  filtered.forEach(mem => {
    const card = document.createElement("div");
    card.className = "card memory-card";

    const originScene = mem.fact_origin ? mem.fact_origin.scene_order : "N/A";
    const originId = mem.fact_origin ? mem.fact_origin.scene_id : "";
    const availScene = mem.available_from ? mem.available_from.scene_order : "N/A";
    const availOffset = mem.available_from ? mem.available_from.char_end : "0";

    const accessClass = `access-${mem.access_type || "witnessed"}`;

    let groundedHtml = "";
    if (mem.grounded_facts && mem.grounded_facts.length > 0) {
      groundedHtml = `
        <div style="margin-top:8px;">
          <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted);">Objective Grounded Facts:</span>
          <ul class="grounded-facts-list">
            ${mem.grounded_facts.map(gf => `<li>${escapeHtml(gf)}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-title">"${escapeHtml(mem.memory_text)}"</div>
      ${groundedHtml}
      <div class="memory-timing-grid">
        <div>
          <div class="timing-col-label">How Learned</div>
          <div class="timing-col-val">
            <span class="access-badge ${accessClass}">${mem.access_type || "unknown"}</span>
          </div>
        </div>
        <div>
          <div class="timing-col-label">Event Happened At</div>
          <div class="timing-col-val">Scene ${originScene} <span style="font-size:11px; color:var(--text-muted);">${originId}</span></div>
        </div>
        <div>
          <div class="timing-col-label">Known By Character From</div>
          <div class="timing-col-val" style="color:var(--text-primary); font-weight:700;">Scene ${availScene} <span style="font-size:11px; color:var(--text-muted);">(char ${availOffset})</span></div>
        </div>
      </div>
      <div style="margin-top:8px;">
        <span class="provenance-tag">ID: ${mem.source_memory_id}</span>
        <span class="provenance-tag">Role: ${mem.source_role_id}</span>
        <span class="provenance-tag" style="color:var(--text-secondary); font-weight:600;">Spoiler-Safe &le; Scene ${state.scene_order}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderPersonaAndRelationships(state) {
  const pContainer = document.getElementById("persona-container");
  const rContainer = document.getElementById("relationships-container");

  pContainer.innerHTML = "";
  rContainer.innerHTML = "";

  const personaPhases = state.active_persona_phases || [];
  if (personaPhases.length === 0) {
    pContainer.innerHTML = `<div class="empty-notice" style="padding:10px;">No active persona phase constraints for this scene.</div>`;
  } else {
    personaPhases.forEach(p => {
      const card = document.createElement("div");
      card.className = "card";
      const vf = p.valid_from ? p.valid_from.scene_order : "1";
      const vu = p.valid_until ? p.valid_until.scene_order : "Open-ended";

      let traitsHtml = "";
      if (p.traits && p.traits.length > 0) {
        traitsHtml += `<div style="font-size:13px; margin-bottom:4px;"><strong>Traits:</strong> ${p.traits.map(t => escapeHtml(t)).join("; ")}</div>`;
      }
      if (p.behavioral_constraints && p.behavioral_constraints.length > 0) {
        traitsHtml += `<div style="font-size:13px; margin-bottom:4px; color:var(--text-secondary);"><strong>Constraints:</strong> ${p.behavioral_constraints.map(b => escapeHtml(b)).join("; ")}</div>`;
      }
      if (p.speaking_style && p.speaking_style.length > 0) {
        traitsHtml += `<div style="font-size:13px; color:var(--text-secondary);"><strong>Style:</strong> ${p.speaking_style.map(s => escapeHtml(s)).join("; ")}</div>`;
      }

      card.innerHTML = `
        ${traitsHtml}
        <div style="margin-top:6px;">
          <span class="evidence-tag">Valid Scenes: ${vf} &rarr; ${vu}</span>
          <span class="provenance-tag">ID: ${p.source_persona_phase_id}</span>
        </div>
      `;
      pContainer.appendChild(card);
    });
  }

  const relPhases = state.active_relationship_phases || [];
  if (relPhases.length === 0) {
    rContainer.innerHTML = `<div class="empty-notice" style="padding:10px;">No active relationship phases recorded for this scene.</div>`;
  } else {
    relPhases.forEach(r => {
      const card = document.createElement("div");
      card.className = "card";
      const polarityClass = `polarity-${r.polarity || "neutral"}`;
      const vf = r.valid_from ? r.valid_from.scene_order : "1";
      const vu = r.valid_until ? r.valid_until.scene_order : "Open-ended";

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="color:var(--text-primary); font-size:14px;">${escapeHtml(r.target)}</strong>
          <span class="badge ${polarityClass}">${r.polarity}</span>
        </div>
        <div style="font-size:13px; color:var(--text-primary);">${escapeHtml(r.description)}</div>
        <div style="margin-top:6px;">
          <span class="evidence-tag">Valid Scenes: ${vf} &rarr; ${vu}</span>
          <span class="provenance-tag">ID: ${r.source_relationship_phase_id}</span>
        </div>
      `;
      rContainer.appendChild(card);
    });
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
