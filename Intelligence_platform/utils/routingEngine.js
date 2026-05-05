// utils/routingEngine.js
class MinHeap {
  constructor() { this.heap = []; }
  push(node, priority) {
    this.heap.push({ node, priority });
    this.heap.sort((a, b) => a.priority - b.priority); 
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
    if (u === endNode) break; // Destination reached
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

  // Phase 1, Task 1 Fix: Safely handle unreachable destinations
  if (distances[endNode] === Infinity) {
    return {
      path: [],
      totalTime: Infinity,
      success: false
    };
  }

  const path = [];
  let curr = endNode;
  while (curr) { 
    path.unshift(curr); 
    curr = prev[curr]; 
  }

  return {
    path: path[0] === startNode ? path : [],
    totalTime: distances[endNode],
    success: true
  };
};

module.exports = { findShortestPath };