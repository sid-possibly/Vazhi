// utils/routingEngine.js

/**
 * Finds the fastest path between two stops[cite: 142, 278].
 * @param {Object} graph - Map of stop IDs and travel times.
 * @param {string} startNode - Origin stop_id.
 * @param {string} endNode - Destination stop_id.
 */
const findShortestPath = (graph, startNode, endNode) => {
    let distances = {};
    distances[endNode] = "Infinity";
    distances = Object.assign(distances, graph[startNode]);

    let parents = { endNode: null };
    for (let child in graph[startNode]) {
        parents[child] = startNode;
    }

    let visited = [];
    let node = shortestDistanceNode(distances, visited);

    while (node) {
        let distance = distances[node];
        let children = graph[node];
        for (let child in children) {
            if (String(child) === String(startNode)) continue;
            let newdistance = distance + children[child];
            if (!distances[child] || distances[child] > newdistance) {
                distances[child] = newdistance;
                parents[child] = node;
            }
        }
        visited.push(node);
        node = shortestDistanceNode(distances, visited);
    }

    let shortestPath = [endNode];
    let parent = parents[endNode];
    while (parent) {
        shortestPath.push(parent);
        parent = parents[parent];
    }
    shortestPath.reverse();

    return {
        path: shortestPath,
        totalTime: distances[endNode]
    };
};

const shortestDistanceNode = (distances, visited) => {
    let shortest = null;
    for (let node in distances) {
        let isShortest = shortest === null || distances[node] < distances[shortest];
        if (isShortest && !visited.includes(node)) {
            shortest = node;
        }
    }
    return shortest;
};

module.exports = { findShortestPath };