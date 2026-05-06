// utils/routingEngine.js
// Dijkstra's shortest-path algorithm for the Vazhi transit graph.
// Uses a proper binary MinHeap (O(log n) push/pop) instead of Array.sort()
// which is O(n log n) per insertion — critical for Kochi's large graph.

class MinHeap {
  constructor() { this.heap = []; }

  push(node, priority) {
    this.heap.push({ node, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    const top  = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].priority <= this.heap[i].priority) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].priority < this.heap[smallest].priority) smallest = l;
      if (r < n && this.heap[r].priority < this.heap[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }

  get size() { return this.heap.length; }
}

const findShortestPath = (graph, startNode, endNode) => {
  // Guard: if either node is completely absent from the graph, fail fast
  const allNodes = new Set([
    ...Object.keys(graph),
    ...Object.values(graph).flatMap(n => Object.keys(n))
  ]);

  if (!allNodes.has(startNode)) {
    return { path: [], totalTime: Infinity, success: false };
  }
  if (!allNodes.has(endNode)) {
    return { path: [], totalTime: Infinity, success: false };
  }

  const distances = {};
  const prev      = {};
  const visited   = new Set();

  allNodes.forEach(n => {
    distances[n] = Infinity;
    prev[n]      = null;
  });
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

  // Double-check after traversal — endNode may be unreachable
  if (distances[endNode] === undefined || distances[endNode] === Infinity) {
    return { path: [], totalTime: Infinity, success: false };
  }

  const path = [];
  let curr = endNode;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev[curr];
  }

  // Sanity check: reconstructed path must start at startNode
  if (path[0] !== startNode) {
    return { path: [], totalTime: Infinity, success: false };
  }

  return {
    path,
    totalTime: distances[endNode],
    success:   true
  };
};

module.exports = { findShortestPath };