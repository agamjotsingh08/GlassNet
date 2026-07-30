// This module is downloaded only when a case map is opened.
const layoutCache = new Map();
let cytoscapePromise;

function loadCytoscape() {
  if (window.cytoscape) return Promise.resolve();
  if (cytoscapePromise) return cytoscapePromise;
  cytoscapePromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("The graph library could not load. The text view remains available."));
    document.head.appendChild(script);
  });
  return cytoscapePromise;
}

export async function createCaseGraph({ report, container, onSelect }) {
  await loadCytoscape();
  const cacheKey = `${report.id || "sample"}:concentric:v1`;
  const savedPositions = layoutCache.get(cacheKey);
  const nodeCount = report.graph.nodes.length;
  const lowPower = document.documentElement.dataset.performance === "low";
  const showLabels = !lowPower && nodeCount <= 80;
  const nodes = report.graph.nodes.map((node) => ({
    ...node,
    position: savedPositions?.[node.data.id],
  }));

  const network = window.cytoscape({
    container,
    elements: [...nodes, ...report.graph.edges],
    layout: savedPositions
      ? { name: "preset", fit: true, padding: 58 }
      : { name: nodeCount > 140 ? "grid" : "concentric", padding: 58, minNodeSpacing: 55, animate: false },
    pixelRatio: lowPower || nodeCount > 180 ? 1 : "auto",
    textureOnViewport: lowPower || nodeCount > 120,
    hideEdgesOnViewport: lowPower || nodeCount > 180,
    style: [
      { selector: "node", style: { label: showLabels ? "data(label)" : "", color: "#e4d5bf", "font-family": "Cascadia Code", "font-size": 9, "text-valign": "bottom", "text-margin-y": 9, "text-wrap": "wrap", "text-max-width": 84, width: 34, height: 34, "background-color": "#8f4d79", "border-width": 2, "border-color": "#b87745" } },
      { selector: 'node[kind = "website"]', style: { shape: "hexagon", width: 72, height: 72, "background-color": "#f3eadc", "border-color": "#b87745", color: "#f3eadc", "font-size": 11 } },
      { selector: 'node[kind = "Advertising"]', style: { shape: "diamond", "background-color": "#a9434d", "border-color": "#d88a80" } },
      { selector: 'node[kind = "Analytics"]', style: { shape: "diamond", "background-color": "#d29b55", "border-color": "#ead0a0" } },
      { selector: 'node[kind = "Unknown"]', style: { "background-color": "#30242e", "border-style": "dashed", "border-color": "#9d918a" } },
      { selector: "edge", style: { width: 1.3, "line-color": "#773445", "target-arrow-color": "#b87745", "target-arrow-shape": "triangle", "curve-style": "bezier", opacity: .78 } },
      { selector: ":selected", style: { "border-width": 4, "border-color": "#f3eadc", "line-color": "#d29b55", "target-arrow-color": "#d29b55" } },
    ],
  });

  if (!savedPositions) {
    const positions = {};
    network.nodes().forEach((node) => {
      positions[node.id()] = node.position();
    });
    layoutCache.set(cacheKey, positions);
  }

  network.on("tap", "node", (event) => onSelect(event.target.data()));
  return network;
}
