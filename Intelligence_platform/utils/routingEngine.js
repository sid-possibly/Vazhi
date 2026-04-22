class MinHeap {
  constructor() { this.heap = []; }
  push(node, priority) {
    this.heap.push({ node, priority });
    this.heap.sort((a, b) => a.priority - b.priority); // simple; replace with proper heapify for scale
  }
  pop() { return this.heap.shift(); }
  get size() { return this.heap.length; }
}

const findShortestPath = (graph, startNode, endNode) => {
  const distances = {};
  const prev = {};
  const visited = new Set();

  const allNodes = new Set([
    ...Object.keys(graph),
    ...Object.values(graph).flatMap(n => Object.keys(n))
  ]);

  allNodes.forEach(n => { distances[n] = Infinity; prev[n] = null; });
  distances[startNode] = 0;

  const pq = new MinHeap();
  pq.push(startNode, 0);

  while (pq.size > 0) {
    const { node: u, priority } = pq.pop();
    if (visited.has(u)) continue;
    if (u === endNode) break;
    visited.add(u);

    if (!graph[u]) continue;
    for (const [v, weight] of Object.entries(graph[u])) {
      const alt = distances[u] + weight;
      if (alt < distances[v]) {
        distances[v] = alt;
        prev[v] = u;
        pq.push(v, alt);
      }
    }
  }

  const path = [];
  let curr = endNode;
  while (curr) { path.unshift(curr); curr = prev[curr]; }

  return {
    path: path[0] === startNode ? path : [],
    totalTime: distances[endNode]
  };
};

module.exports = { findShortestPath };