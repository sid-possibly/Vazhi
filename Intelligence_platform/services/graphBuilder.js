// graphBuilder.js
// Builds the adjacency list for the transit network.
// Includes direct travel via consecutive schedules and walking transfers via PostGIS.

const buildTransitGraph = async (pool, cityId) => {
  const graph = {};

  console.log(`👷 Building Graph for City: ${cityId}`);

  // ── 1. Direct Edges ───────────────────────────────────────────────────
  // Only connects consecutive stops on the same trip (stop_sequence + 1).
  // This prevents phantom skip-edges that would let Dijkstra teleport
  // from stop 1 to stop 10 without passing through intermediate stops.
  const directQuery = `
    SELECT
      s1.gtfs_stop_id AS source,
      s2.gtfs_stop_id AS target,
      GREATEST(
        EXTRACT(EPOCH FROM (sch2.arrival_time - sch1.departure_time)) / 60,
        1
      ) AS weight
    FROM schedules sch1
    JOIN schedules sch2
      ON  sch1.trip_id = sch2.trip_id
      AND sch2.stop_sequence = sch1.stop_sequence + 1
    JOIN stops s1 ON sch1.stop_id = s1.stop_id
    JOIN stops s2 ON sch2.stop_id = s2.stop_id
    WHERE s1.city_id = $1
  `;

  // ── 2. Transfer Edges ─────────────────────────────────────────────────
  // Inter-mode walking transfers between stops within 500m.
  //
  // The CTE pre-computes a small deduplicated (stop_id, mode_id) lookup
  // table BEFORE the spatial join runs. This avoids dragging 57k schedule
  // rows into the spatial join, which was the main performance bottleneck.
  //
  // Mode is derived via schedules → routes rather than a mode_id column
  // on stops, because the community GTFS feed shares stops across Bus and
  // Water agencies — stamping mode_id on stops caused clobbering.
  //
  // Casting geom to ::geography ensures:
  //   - ST_DWithin treats 500 as metres (not degrees)
  //   - ST_Distance returns metres so the walking time formula is correct
  //
  // Walking speed: 1.4 m/s → time in minutes = distance / 1.4 / 60
  const transferQuery = `
    WITH stop_modes AS (
      SELECT DISTINCT sch.stop_id, r.mode_id
      FROM schedules sch
      JOIN routes r ON r.route_id = sch.route_id
    )
    SELECT
      s1.gtfs_stop_id AS source,
      s2.gtfs_stop_id AS target,
      (ST_Distance(s1.geom::geography, s2.geom::geography) / 1.4) / 60 AS weight
    FROM stops s1
    JOIN stops s2
      ON  ST_DWithin(s1.geom::geography, s2.geom::geography, 500)
      AND s1.stop_id != s2.stop_id
    JOIN stop_modes sm1 ON sm1.stop_id = s1.stop_id
    JOIN stop_modes sm2 ON sm2.stop_id = s2.stop_id
    WHERE s1.city_id = $1
      AND sm1.mode_id != sm2.mode_id
  `;

  try {
    const { rows: direct } = await pool.query(directQuery, [cityId]);
    const { rows: trans  } = await pool.query(transferQuery, [cityId]);

    console.log(`🔗 Graph Stats: ${direct.length} travel links, ${trans.length} walking transfers.`);

    [...direct, ...trans].forEach(({ source, target, weight }) => {
      if (!graph[source]) graph[source] = {};
      // Always keep the minimum (fastest) weight between any two nodes
      graph[source][target] = Math.min(
        graph[source][target] ?? Infinity,
        parseFloat(weight)
      );
    });

    return graph;

  } catch (err) {
    console.error('❌ Database Graph Build Failed:', err.message);
    throw err;
  }
};

module.exports = { buildTransitGraph };