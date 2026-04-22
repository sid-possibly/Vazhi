const { buildTransitGraph } = require('./graphBuilder');

class GraphService {
  constructor() {
    this.cachedGraphs = new Map(); // Store graphs by cityId
  }

  /**
   * Fetches the graph. If it's already in memory, returns it instantly.
   * Otherwise, builds it from the DB and caches it.
   */
  async getGraph(pool, cityId) {
    if (this.cachedGraphs.has(cityId)) {
      return this.cachedGraphs.get(cityId);
    }

    const graph = await buildTransitGraph(pool, cityId);
    this.cachedGraphs.set(cityId, graph);
    return graph;
  }

  /**
   * Clears the cache. Call this after data ingestion.
   */
  clearCache(cityId = null) {
    if (cityId) {
      this.cachedGraphs.delete(cityId);
      console.log(`🧹 Cache cleared for city: ${cityId}`);
    } else {
      this.cachedGraphs.clear();
      console.log("🧹 Global graph cache cleared.");
    }
  }
}

// Export as a Singleton to share cache across the entire app
module.exports = new GraphService();