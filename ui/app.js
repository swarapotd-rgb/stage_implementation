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

  document.getElementById("char-select").value = character;
  document.getElementById("scene-input").value = sceneOrder;

  // 1. Load Character State
  await loadState(character, sceneOrder);

  // 2. Load Corresponding As-Of Temporal Knowledge Graph
  await loadGraph(character, sceneOrder);
}

async function loadState(character, sceneOrder) {
  try {
    const apiUrl = `/api/state?character=${encodeURIComponent(character)}&scene=${sceneOrder}`;
    const res = await fetch(apiUrl);
    if (res.ok) {
      currentState = await res.json();
      renderAll(currentState);
      return;
    }
  } catch (e) {
    // API not responding or local file mode
  }

  const match = preloadedCheckpoints.find(
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
  try {
    const apiUrl = `/api/graph?character=${encodeURIComponent(character)}&scene=${sceneOrder}`;
    const res = await fetch(apiUrl);
    if (res.ok) {
      currentGraphData = await res.json();
      renderGraph(currentGraphData);
      return;
    }
  } catch (e) {
    // API not responding or local file mode
  }

  const key = `${character}_${sceneOrder}`;
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

  // 1. Horizontal Timeline Spine for Scenes at y = 320
  const sceneCount = scenes.length;
  const sceneStartX = 230;
  const sceneStep = 100;

  const sceneXMap = {};
  scenes.forEach((scNode, idx) => {
    const x = sceneStartX + idx * sceneStep;
    const y = 320;
    positions[scNode.id] = { x, y };
    sceneXMap[scNode.properties.scene_order] = x;
  });

  // 2. Left Flank: Story, Characters, PersonaPhases
  if (story) {
    positions[story.id] = { x: 75, y: 75 };
  }

  if (focalChar) {
    positions[focalChar.id] = { x: 75, y: 190 };
  }

  otherChars.forEach((cNode, idx) => {
    positions[cNode.id] = { x: 75, y: 290 + idx * 80 };
  });

  personas.forEach((pNode, idx) => {
    positions[pNode.id] = { x: 155, y: 160 + idx * 65 };
  });

  // 3. Right Flank: RelationshipPhases and Target Entities
  const maxSceneX = sceneCount > 0 ? (sceneStartX + (sceneCount - 1) * sceneStep) : sceneStartX;
  const rightFlankX = Math.max(maxSceneX + 130, 580);

  rels.forEach((rNode, idx) => {
    positions[rNode.id] = { x: rightFlankX, y: 60 + idx * 46 };
  });

  entities.forEach((eNode, idx) => {
    positions[eNode.id] = { x: rightFlankX + 130, y: 60 + idx * 52 };
  });

  // 4. Top Tier: Checkpoint, StateClaims, Developments
  const cpScene = checkpoint?.properties?.scene_order || asOfScene;
  const cpX = sceneXMap[cpScene] || (sceneCount > 0 ? sceneStartX + (sceneCount - 1) * sceneStep : 400);

  if (checkpoint) {
    positions[checkpoint.id] = { x: cpX, y: 170 };
  }

  // State Claims arranged in two clean staggered rows above Checkpoint
  claims.forEach((clNode, idx) => {
    const row = Math.floor(idx / 4);
    const col = idx % 4;
    const numInRow = Math.min(4, claims.length - row * 4);
    const colOffset = (col - (numInRow - 1) / 2) * 65;
    positions[clNode.id] = {
      x: cpX + colOffset,
      y: 55 + row * 48,
      claimIdx: idx + 1
    };
  });

  // Developments placed to the left of the Checkpoint
  developments.forEach((devNode, idx) => {
    positions[devNode.id] = { x: cpX - 90 - idx * 60, y: 170 };
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
      const memY = 380 + mIdx * 46;
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
        positions[fNode.id] = { x: colBaseX + 22, y: 380 + idx * 24, colIdx: idx };
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

function renderInspector(node) {
  const badge = document.getElementById("inspector-badge");
  const title = document.getElementById("inspector-title");
  const body = document.getElementById("inspector-body");

  badge.textContent = node.type;
  badge.className = `inspector-type-badge node-${node.type.toLowerCase()}`;
  title.textContent = node.label;

  let html = `<div style="margin-bottom:8px; font-family:var(--font-mono); font-size:11px; color:var(--text-muted); word-break:break-all;">ID: ${escapeHtml(node.id)}</div>`;

  const props = node.properties || {};

  // Specialized detail views by node type
  if (node.type === "Memory") {
    html += `
      <div style="font-size:13px; color:#fff; margin-bottom:10px;">"${escapeHtml(props.memory_text)}"</div>
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
          <div class="timing-col-val" style="color:var(--accent-emerald);">Scene ${props.available_from ? props.available_from.scene_order : "N/A"}</div>
        </div>
      </div>
    `;
  } else if (node.type === "Fact") {
    html += `
      <div style="font-size:13px; color:#fff; margin-bottom:10px;">${escapeHtml(props.fact_text)}</div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Event Scene Origin</div>
        <div class="inspector-prop-val">Scene ${props.fact_origin ? props.fact_origin.scene_order : "N/A"}</div>
      </div>
    `;
  } else if (node.type === "StateClaim") {
    html += `
      <div style="font-size:13px; color:var(--accent-emerald); margin-bottom:10px; font-weight:500;">${escapeHtml(props.claim)}</div>
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
      <div style="font-size:13px; color:var(--accent-cyan); margin-bottom:10px; font-weight:500;">${escapeHtml(props.claim)}</div>
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
        <div class="inspector-prop-val" style="color:var(--accent-amber);">${(props.behavioral_constraints || []).map(b => escapeHtml(b)).join("; ") || "None"}</div>
      </div>
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Validity Window</div>
        <div class="inspector-prop-val">Scene ${props.valid_from ? props.valid_from.scene_order : "1"} &rarr; ${props.valid_until ? props.valid_until.scene_order : "Open-ended"}</div>
      </div>
    `;
  } else if (node.type === "RelationshipPhase") {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="color:#fff;">Target: ${escapeHtml(props.target)}</strong>
        <span class="badge polarity-${props.polarity}">${props.polarity}</span>
      </div>
      <div style="font-size:13px; color:#fff; margin-bottom:10px;">${escapeHtml(props.description)}</div>
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
  } else if (node.type === "Scene") {
    html += `
      <div class="inspector-prop-row">
        <div class="inspector-prop-label">Screenplay Order</div>
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
      <div class="card-title" style="color:var(--accent-cyan);">${idx + 1}. ${escapeHtml(item.claim)}</div>
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
          <div class="timing-col-val" style="color:var(--accent-emerald);">Scene ${availScene} <span style="font-size:11px; color:var(--text-muted);">(char ${availOffset})</span></div>
        </div>
      </div>
      <div style="margin-top:8px;">
        <span class="provenance-tag">ID: ${mem.source_memory_id}</span>
        <span class="provenance-tag">Role: ${mem.source_role_id}</span>
        <span class="provenance-tag" style="color:var(--accent-emerald);">Spoiler-Safe &le; Scene ${state.scene_order}</span>
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
        traitsHtml += `<div style="font-size:13px; margin-bottom:4px; color:var(--accent-amber);"><strong>Constraints:</strong> ${p.behavioral_constraints.map(b => escapeHtml(b)).join("; ")}</div>`;
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
          <strong style="color:#fff; font-size:14px;">${escapeHtml(r.target)}</strong>
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
