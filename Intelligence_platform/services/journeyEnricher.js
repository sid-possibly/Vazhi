// services/journeyEnricher.js
//
// Takes the flat array of gtfs_stop_ids from Dijkstra and enriches it into
// a structured legs response:
//
//   - Transit legs: grouped by consecutive stops on the same mode/route
//   - Walking legs: inserted between mode transfers, with TomTom turn-by-turn directions
//
// Flow:
//   1. Bulk-fetch metadata for every stop in the path (name, coords, mode, route)
//   2. Detect transfer points where the mode changes
//   3. Group into transit legs
//   4. Insert walking legs at each transfer using TomTom Routing API
//   5. Return structured legs array

const axios = require('axios');

const WALKING_SPEED_MS = 1.4; // metres per second

// ── TomTom walking directions ─────────────────────────────────────────────────

/**
 * Calls TomTom Routing API for pedestrian turn-by-turn directions.
 * Returns { durationSeconds, distanceMetres, instructions[] }
 * Falls back gracefully if the API call fails.
 */
const getWalkingDirections = async (fromLat, fromLng, toLat, toLng) => {
  try {
    const url = `https://api.tomtom.com/routing/1/calculateRoute/${fromLat},${fromLng}:${toLat},${toLng}/json`;

    const response = await axios.get(url, {
      params: {
        travelMode:       'pedestrian',
        instructionsType: 'text',
        language:         'en-GB',
        key:              process.env.TOMTOM_KEY
      },
      timeout: 5000
    });

    const route    = response.data.routes[0];
    const summary  = route.summary;
    const guidance = route.guidance;

    const instructions = guidance
      ? guidance.instructions
          .filter(inst => inst.maneuver !== 'ARRIVE' || inst === guidance.instructions[guidance.instructions.length - 1])
          .map(inst => ({
            maneuver:    inst.maneuver,
            message:     inst.message || inst.combinedMessage || '',
            distanceMetres: inst.routeOffsetInMeters || 0
          }))
      : [];

    return {
      durationSeconds: summary.travelTimeInSeconds,
      distanceMetres:  summary.lengthInMeters,
      instructions
    };

  } catch (err) {
    // Graceful fallback — estimate from straight-line distance
    console.warn(`⚠️  TomTom walking directions failed: ${err.message}. Using estimate.`);

    const R = 6371000; // Earth radius in metres
    const dLat = (toLat - fromLat) * Math.PI / 180;
    const dLng = (toLng - fromLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(fromLat * Math.PI / 180) *
              Math.cos(toLat * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    const distanceMetres = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const durationSeconds = distanceMetres / WALKING_SPEED_MS;

    return {
      durationSeconds: Math.round(durationSeconds),
      distanceMetres:  Math.round(distanceMetres),
      instructions:    [{ maneuver: 'STRAIGHT', message: 'Walk to the next stop', distanceMetres: Math.round(distanceMetres) }],
      estimated:       true
    };
  }
};

// ── Stop metadata fetcher ─────────────────────────────────────────────────────

/**
 * Bulk-fetches stop metadata for all gtfs_stop_ids in the path.
 * Returns a Map: gtfs_stop_id → { name, lat, lng, modes: Set, routes: Map }
 *
 * For each consecutive pair of stops, we also look up which route/mode
 * connects them via a shared trip.
 */
const fetchStopMetadata = async (pool, path, cityId) => {
  if (path.length === 0) return new Map();

  // Fetch basic stop info
  const { rows: stopRows } = await pool.query(`
    SELECT gtfs_stop_id, stop_name, ST_Y(geom) AS lat, ST_X(geom) AS lng
    FROM stops
    WHERE gtfs_stop_id = ANY($1) AND city_id = $2
  `, [path, cityId]);

  const stopMap = new Map();
  for (const row of stopRows) {
    stopMap.set(row.gtfs_stop_id, {
      gtfsId: row.gtfs_stop_id,
      name:   row.stop_name,
      lat:    parseFloat(row.lat),
      lng:    parseFloat(row.lng)
    });
  }

  return stopMap;
};

/**
 * For each consecutive pair in the path, finds the mode and route that
 * connects them (i.e. they share a trip_id in the same sequence).
 * Returns an array of { from, to, mode, routeId, routeName, routeColor, travelTimeMinutes }
 */
const fetchEdgeMetadata = async (pool, path) => {
  if (path.length < 2) return [];

  // Build pairs
  const pairs = [];
  for (let i = 0; i < path.length - 1; i++) {
    pairs.push([path[i], path[i + 1]]);
  }

  // For each pair, find if they're connected by a transit schedule (same trip, consecutive sequence)
  // or if it's a walking transfer (no shared trip)
  const edgeResults = [];

  for (const [fromId, toId] of pairs) {
    const { rows } = await pool.query(`
      SELECT
        tm.type AS mode,
        r.gtfs_route_id AS route_id,
        r.route_short_name AS route_name,
        r.route_color,
        GREATEST(
          EXTRACT(EPOCH FROM (sch2.arrival_time - sch1.departure_time)) / 60,
          1
        ) AS travel_time_minutes
      FROM schedules sch1
      JOIN schedules sch2
        ON  sch1.trip_id = sch2.trip_id
        AND sch2.stop_sequence = sch1.stop_sequence + 1
      JOIN stops s1 ON sch1.stop_id = s1.stop_id
      JOIN stops s2 ON sch2.stop_id = s2.stop_id
      JOIN routes r ON sch1.route_id = r.route_id
      JOIN transport_modes tm ON tm.mode_id = r.mode_id
      WHERE s1.gtfs_stop_id = $1
        AND s2.gtfs_stop_id = $2
      LIMIT 1
    `, [fromId, toId]);

    if (rows.length > 0) {
      edgeResults.push({
        from:              fromId,
        to:                toId,
        type:              'transit',
        mode:              rows[0].mode,
        routeId:           rows[0].route_id,
        routeName:         rows[0].route_name,
        routeColor:        rows[0].route_color,
        travelTimeMinutes: parseFloat(rows[0].travel_time_minutes)
      });
    } else {
      // No transit schedule found — this is a walking transfer
      edgeResults.push({
        from: fromId,
        to:   toId,
        type: 'walking'
      });
    }
  }

  return edgeResults;
};

// ── Main enricher ─────────────────────────────────────────────────────────────

/**
 * Enriches a flat Dijkstra path into a structured legs array.
 *
 * @param {Pool}     pool    - pg Pool instance
 * @param {string[]} path    - Array of gtfs_stop_ids from Dijkstra
 * @param {number}   totalTime - Total travel time in minutes
 * @param {string}   cityId  - City UUID
 * @returns {Object}          - Structured journey response
 */
const enrichJourney = async (pool, path, totalTime, cityId) => {
  if (path.length < 2) {
    return { legs: [], totalTravelTimeMinutes: '0.00', transfers: 0 };
  }

  // 1. Fetch all stop metadata and edge metadata in parallel
  const [stopMap, edges] = await Promise.all([
    fetchStopMetadata(pool, path, cityId),
    fetchEdgeMetadata(pool, path)
  ]);

  // 2. Group consecutive transit edges with the same route into legs
  //    Walking edges become their own legs
  const rawLegs = [];
  let currentLeg = null;

  for (const edge of edges) {
    const fromStop = stopMap.get(edge.from);
    const toStop   = stopMap.get(edge.to);

    if (!fromStop || !toStop) continue;

    if (edge.type === 'walking') {
      // Flush current transit leg if any
      if (currentLeg) {
        rawLegs.push(currentLeg);
        currentLeg = null;
      }
      // Add walking leg placeholder (directions fetched below)
      rawLegs.push({
        type:     'walking',
        from:     fromStop,
        to:       toStop,
        fromId:   edge.from,
        toId:     edge.to
      });

    } else {
      // Transit edge
      if (
        currentLeg &&
        currentLeg.type === 'transit' &&
        currentLeg.routeId === edge.routeId
      ) {
        // Extend current leg — same route continues
        currentLeg.to = toStop;
        currentLeg.stops.push(toStop);
        currentLeg.durationMinutes += edge.travelTimeMinutes;

      } else {
        // Flush previous leg and start a new one
        if (currentLeg) rawLegs.push(currentLeg);

        currentLeg = {
          type:            'transit',
          mode:            edge.mode,
          routeId:         edge.routeId,
          routeName:       edge.routeName,
          routeColor:      edge.routeColor || '#000000',
          from:            fromStop,
          to:              toStop,
          stops:           [fromStop, toStop],
          durationMinutes: edge.travelTimeMinutes
        };
      }
    }
  }

  // Flush last leg
  if (currentLeg) rawLegs.push(currentLeg);

  // 3. Fetch TomTom walking directions for all walking legs in parallel
  const enrichedLegs = await Promise.all(
    rawLegs.map(async (leg) => {
      if (leg.type !== 'walking') return leg;

      const directions = await getWalkingDirections(
        leg.from.lat, leg.from.lng,
        leg.to.lat,   leg.to.lng
      );

      return {
        type:            'walking',
        from:            leg.from,
        to:              leg.to,
        durationMinutes: parseFloat((directions.durationSeconds / 60).toFixed(1)),
        distanceMetres:  directions.distanceMetres,
        instructions:    directions.instructions,
        estimated:       directions.estimated || false
      };
    })
  );

  // 4. Count transfers (number of mode changes, excluding walking legs)
  const transitLegs = enrichedLegs.filter(l => l.type === 'transit');
  const transfers   = Math.max(0, transitLegs.length - 1);

  return {
    legs:                  enrichedLegs,
    totalTravelTimeMinutes: parseFloat(totalTime).toFixed(2),
    transfers,
    transitLegs:           transitLegs.length,
    walkingLegs:           enrichedLegs.filter(l => l.type === 'walking').length
  };
};

module.exports = { enrichJourney };