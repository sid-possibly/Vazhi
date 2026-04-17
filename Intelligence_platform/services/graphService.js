// Task 7: Converts database rows into the Weighted Graph format for routing 
const buildGraph = (rows) => {
  const graph = {};
  rows.forEach(row => {
    // If source stop isn't in graph yet, add it
    if (!graph[row.source]) {
      graph[row.source] = {};
    }
    // Add the target stop and the travel time (the "weight")
    graph[row.source][row.target] = parseFloat(row.travel_time);
  });
  return graph;
};

module.exports = { buildGraph };