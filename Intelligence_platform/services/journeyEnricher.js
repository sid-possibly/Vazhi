// services/journeyEnricher.js
// Enriches a flat Dijkstra path into structured legs with:
//   - Transit legs grouped by route
//   - Walking legs with TomTom turn-by-turn directions
//   - Fare information per transit leg (from fare_rules + fare_attributes)

const axios = require('axios');

const WALKING_SPEED_MS = 1.4;

// ── TomTom walking directions ─────────────────────────────────────────────────

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
      ? guidance.instructions.map(inst => ({
          maneuver:       inst.maneuver,
          message:        inst.message || inst.combinedMessage || '',
          distanceMetres: inst.routeOffsetInMeters || 0
        }))
      : [];

    return {
      durationSeconds: summary.travelTimeInSeconds,
      distanceMetres:  summary.lengthInMeters,
      instructions
    };

  } catch (err) {
    console.warn(`⚠️  TomTom walking directions failed: ${err.message}. Using estimate.`);

    const R    = 6371000;
    const dLat = (toLat - fromLat) * Math.PI / 180;
    const dLng = (toLng - fromLng) * Math.PI / 180;
    const a    = Math.sin(dLat / 2) ** 2 +
                 Math.cos(fromLat * Math.PI / 180) *
                 Math.cos(toLat   * Math.PI / 180) *
                 Math.sin(dLng / 2) ** 2;
    const distanceMetres  = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const durationSeconds = distanceMetres / WALKING_SPEED_MS;

    return {
      durationSeconds: Math.round(durationSeconds),
      distanceMetres:  Math.round(distanceMetres),
      instructions:    [{ maneuver: 'STRAIGHT', message: 'Walk to the next stop', distanceMetres: Math.round(distanceMetres) }],
      estimated:       true
    };
  }
};

// ── Fare lookup ───────────────────────────────────────────────────────────────

/**
 * Looks up the fare for a journey segment on a specific route.
 * Uses fare_rules to find the fare_id for origin→destination pair,
 * then fetches the price from fare_attributes.
 *
 * Falls back to route-level fare if origin/destination specific rule not found.
 * Returns null if no fare data available for this route.
 */
const lookupFare = async (pool, routeId, originGtfsId, destinationGtfsId) => {
  try {
    // Try origin+destination specific fare first
    const { rows: specificRows } = await pool.query(`
      SELECT fa.price, fa.currency_type, fr.fare_id
      FROM fare_rules fr
      JOIN fare_attributes fa ON fa.fare_id = fr.fare_id
      WHERE fr.route_id = $1
        AND fr.origin_id = $2
        AND fr.destination_id = $3
      LIMIT 1
    `, [routeId, originGtfsId, destinationGtfsId]);

    if (specificRows.length > 0) {
      return {
        fareId:       specificRows[0].fare_id,
        price:        parseFloat(specificRows[0].price),
        currencyType: specificRows[0].currency_type,
        basis:        'origin_destination'
      };
    }

    // Fall back to route-level fare (fare rule with no origin/destination)
    const { rows: routeRows } = await pool.query(`
      SELECT fa.price, fa.currency_type, fr.fare_id
      FROM fare_rules fr
      JOIN fare_attributes fa ON fa.fare_id = fr.fare_id
      WHERE fr.route_id = $1
        AND fr.origin_id IS NULL
        AND fr.destination_id IS NULL
      LIMIT 1
    `, [routeId]);

    if (routeRows.length > 0) {
      return {
        fareId:       routeRows[0].fare_id,
        price:        parseFloat(routeRows[0].price),
        currencyType: routeRows[0].currency_type,
        basis:        'route'
      };
    }

    return null; // No fare data for this route

  } catch (err) {
    console.warn(`⚠️  Fare lookup failed: ${err.message}`);
    return null;
  }
};

// ── Stop metadata fetcher ─────────────────────────────────────────────────────

const fetchStopMetadata = async (pool, path, cityId) => {
  if (path.length === 0) return new Map();

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

// ── Edge metadata fetcher ─────────────────────────────────────────────────────

const fetchEdgeMetadata = async (pool, path) => {
  if (path.length < 2) return [];

  const edgeResults = [];

  for (let i = 0; i < path.length - 1; i++) {
    const fromId = path[i];
    const toId   = path[i + 1];

    const { rows } = await pool.query(`
      SELECT
        tm.type AS mode,
        r.route_id AS internal_route_id,
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
        from:               fromId,
        to:                 toId,
        type:               'transit',
        mode:               rows[0].mode,
        internalRouteId:    rows[0].internal_route_id,
        routeId:            rows[0].route_id,
        routeName:          rows[0].route_name,
        routeColor:         rows[0].route_color,
        travelTimeMinutes:  parseFloat(rows[0].travel_time_minutes)
      });
    } else {
      edgeResults.push({ from: fromId, to: toId, type: 'walking' });
    }
  }

  return edgeResults;
};

// ── Main enricher ─────────────────────────────────────────────────────────────

const enrichJourney = async (pool, path, totalTime, cityId) => {
  if (path.length < 2) {
    return { legs: [], totalTravelTimeMinutes: '0.00', transfers: 0, totalFare: null };
  }

  const [stopMap, edges] = await Promise.all([
    fetchStopMetadata(pool, path, cityId),
    fetchEdgeMetadata(pool, path)
  ]);

  // Group consecutive transit edges with same route into legs
  const rawLegs   = [];
  let currentLeg  = null;

  for (const edge of edges) {
    const fromStop = stopMap.get(edge.from);
    const toStop   = stopMap.get(edge.to);
    if (!fromStop || !toStop) continue;

    if (edge.type === 'walking') {
      if (currentLeg) { rawLegs.push(currentLeg); currentLeg = null; }
      rawLegs.push({ type: 'walking', from: fromStop, to: toStop, fromId: edge.from, toId: edge.to });

    } else {
      if (currentLeg && currentLeg.type === 'transit' && currentLeg.routeId === edge.routeId) {
        currentLeg.to = toStop;
        currentLeg.stops.push(toStop);
        currentLeg.durationMinutes += edge.travelTimeMinutes;
      } else {
        if (currentLeg) rawLegs.push(currentLeg);
        currentLeg = {
          type:               'transit',
          mode:               edge.mode,
          internalRouteId:    edge.internalRouteId,
          routeId:            edge.routeId,
          routeName:          edge.routeName,
          routeColor:         edge.routeColor || '#000000',
          from:               fromStop,
          to:                 toStop,
          stops:              [fromStop, toStop],
          durationMinutes:    edge.travelTimeMinutes
        };
      }
    }
  }
  if (currentLeg) rawLegs.push(currentLeg);

  // Enrich walking legs with TomTom directions + transit legs with fare
  const enrichedLegs = await Promise.all(
    rawLegs.map(async (leg) => {

      if (leg.type === 'walking') {
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
      }

      // Transit leg — look up fare
      const fare = await lookupFare(
        pool,
        leg.internalRouteId,
        leg.from.gtfsId,
        leg.to.gtfsId
      );

      return {
        type:            'transit',
        mode:            leg.mode,
        routeId:         leg.routeId,
        routeName:       leg.routeName,
        routeColor:      leg.routeColor,
        from:            leg.from,
        to:              leg.to,
        stops:           leg.stops,
        durationMinutes: leg.durationMinutes,
        fare
      };
    })
  );

  // Compute total fare across all transit legs
  const transitLegs  = enrichedLegs.filter(l => l.type === 'transit');
  const faresWithData = transitLegs.filter(l => l.fare !== null);

  let totalFare = null;
  if (faresWithData.length > 0) {
    totalFare = {
      amount:       faresWithData.reduce((s, l) => s + l.fare.price, 0),
      currencyType: faresWithData[0].fare.currencyType,
      breakdown:    faresWithData.map(l => ({
        routeId: l.routeId,
        mode:    l.mode,
        amount:  l.fare.price
      })),
      isEstimate: faresWithData.length < transitLegs.length
    };
  }

  const transfers  = Math.max(0, transitLegs.length - 1);

  return {
    legs:                   enrichedLegs,
    totalTravelTimeMinutes: parseFloat(totalTime).toFixed(2),
    transfers,
    transitLegs:            transitLegs.length,
    walkingLegs:            enrichedLegs.filter(l => l.type === 'walking').length,
    totalFare
  };
};

module.exports = { enrichJourney };