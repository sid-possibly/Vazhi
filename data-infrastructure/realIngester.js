// realIngester.js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

/**
 * Normalizes GTFS time strings that can exceed 23:xx (e.g. 25:10:00)
 * by wrapping hours with modulo 24.
 */
const formatGTFSTime = (timeStr) => {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(':');
  const hours = parseInt(parts[0], 10) % 24;
  return `${hours.toString().padStart(2, '0')}:${parts[1]}:${parts[2]}`;
};

/**
 * Builds a PostGIS LINESTRING WKT string from an array of shape points.
 * Points must already be sorted by shape_pt_sequence.
 * Returns null if fewer than 2 points (can't form a line).
 *
 * @param {Array} points - Array of { shape_pt_lat, shape_pt_lon }
 * @returns {string|null}
 */
const buildLineStringWKT = (points) => {
  if (points.length < 2) return null;
  const coords = points
    .map(p => `${parseFloat(p.shape_pt_lon)} ${parseFloat(p.shape_pt_lat)}`)
    .join(', ');
  return `LINESTRING(${coords})`;
};

/**
 * Ingests a full GTFS feed (routes, stops, trips, stop_times, shapes) for a
 * specific city + transport mode into PostgreSQL.
 *
 * @param {Pool}     pool          - pg Pool instance
 * @param {string}   citySlug      - e.g. 'kochi'
 * @param {string}   modeType      - e.g. 'Metro', 'Bus', 'Water'
 * @param {string}   folderPath    - path to the GTFS folder
 * @param {string[]} agencyFilter  - only ingest routes from these agency_ids (empty = ingest all)
 */
const ingestGTFSForMode = async (pool, citySlug, modeType, folderPath, agencyFilter = []) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Resolve city_id and mode_id from DB ──────────────────────────────
    const metaRes = await client.query(
      `SELECT c.city_id, m.mode_id
       FROM cities c
       JOIN transport_modes m ON m.city_id = c.city_id
       WHERE c.slug = $1 AND m.type = $2`,
      [citySlug, modeType]
    );

    if (metaRes.rows.length === 0) {
      throw new Error(
        `No DB record found for city slug '${citySlug}' and mode '${modeType}'. ` +
        `Check your cities and transport_modes tables.`
      );
    }

    const { city_id, mode_id } = metaRes.rows[0];
    console.log(`   city_id: ${city_id} | mode_id: ${mode_id}`);

    // ── 1. ROUTES ────────────────────────────────────────────────────────
    const routes = parse(
      fs.readFileSync(path.join(folderPath, 'routes.txt')),
      { columns: true, skip_empty_lines: true, trim: true }
    );

    const routeMap = new Map(); // gtfs_route_id → internal route_id

    for (const r of routes) {
      if (agencyFilter.length > 0 && !agencyFilter.includes(r.agency_id)) continue;

      const res = await client.query(
        `INSERT INTO routes (mode_id, gtfs_route_id, route_short_name, route_color)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (gtfs_route_id) DO UPDATE
           SET route_short_name = EXCLUDED.route_short_name,
               route_color      = EXCLUDED.route_color,
               mode_id          = EXCLUDED.mode_id
         RETURNING route_id`,
        [
          mode_id,
          r.route_id,
          r.route_short_name || r.route_long_name || r.route_id,
          r.route_color ? `#${r.route_color.replace('#', '')}` : '#000000'
        ]
      );

      routeMap.set(r.route_id, res.rows[0].route_id);
    }

    console.log(`   ✅ Routes ingested: ${routeMap.size}`);

    // ── 2. STOPS ─────────────────────────────────────────────────────────
    // mode_id is intentionally NOT stored on stops.
    // A stop can be served by multiple modes (e.g. shared Bus + Water stops
    // in the community feed). Mode is derived at query time via
    // schedules → routes → transport_modes.
    const stops = parse(
      fs.readFileSync(path.join(folderPath, 'stops.txt')),
      { columns: true, skip_empty_lines: true, trim: true }
    );

    for (const s of stops) {
      await client.query(
        `INSERT INTO stops (city_id, gtfs_stop_id, stop_name, geom)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
         ON CONFLICT (gtfs_stop_id) DO UPDATE
           SET stop_name = EXCLUDED.stop_name,
               geom      = EXCLUDED.geom`,
        [city_id, s.stop_id, s.stop_name, parseFloat(s.stop_lon), parseFloat(s.stop_lat)]
      );
    }

    console.log(`   ✅ Stops ingested: ${stops.length}`);

    // ── 3. TRIPS → build maps for route and shape linking ─────────────────
    const trips = parse(
      fs.readFileSync(path.join(folderPath, 'trips.txt')),
      { columns: true, skip_empty_lines: true, trim: true }
    );

    const tripRouteMap = new Map(); // gtfs_trip_id → internal route_id
    // shape_id → gtfs_route_id (first trip we see wins — one shape per route)
    const shapeRouteMap = new Map();

    for (const t of trips) {
      if (routeMap.has(t.route_id)) {
        tripRouteMap.set(t.trip_id, routeMap.get(t.route_id));

        // Map this shape to the route — only store the first occurrence
        if (t.shape_id && !shapeRouteMap.has(t.shape_id)) {
          shapeRouteMap.set(t.shape_id, t.route_id);
        }
      }
    }

    console.log(`   ✅ Trips mapped: ${tripRouteMap.size}`);
    console.log(`   ✅ Shapes to process: ${shapeRouteMap.size}`);

    // ── 4. SHAPES → build LINESTRING and update route_shape ──────────────
    // Read all shape points, group by shape_id, sort by sequence,
    // build a LINESTRING WKT, then update the matching route row.
    const shapesPath = path.join(folderPath, 'shapes.txt');

    if (fs.existsSync(shapesPath)) {
      const shapePoints = parse(
        fs.readFileSync(shapesPath),
        { columns: true, skip_empty_lines: true, trim: true }
      );

      // Group points by shape_id
      const shapeMap = new Map();
      for (const pt of shapePoints) {
        if (!shapeMap.has(pt.shape_id)) shapeMap.set(pt.shape_id, []);
        shapeMap.get(pt.shape_id).push(pt);
      }

      let shapesIngested = 0;

      for (const [shapeId, points] of shapeMap) {
        const gtfsRouteId = shapeRouteMap.get(shapeId);
        if (!gtfsRouteId) continue; // Shape belongs to a filtered-out route

        // Sort by sequence (handle both integer and float sequence values)
        points.sort((a, b) =>
          parseFloat(a.shape_pt_sequence) - parseFloat(b.shape_pt_sequence)
        );

        const wkt = buildLineStringWKT(points);
        if (!wkt) continue;

        await client.query(
          `UPDATE routes
           SET route_shape = ST_SetSRID(ST_GeomFromText($1), 4326)
           WHERE gtfs_route_id = $2`,
          [wkt, gtfsRouteId]
        );

        shapesIngested++;
      }

      console.log(`   ✅ Shapes ingested: ${shapesIngested}`);
    } else {
      console.log(`   ⚠️  No shapes.txt found — skipping shape ingestion.`);
    }

    // ── 5. STOP_TIMES / SCHEDULES ────────────────────────────────────────
    const stopTimes = parse(
      fs.readFileSync(path.join(folderPath, 'stop_times.txt')),
      { columns: true, skip_empty_lines: true, trim: true }
    );

    let schedulesInserted = 0;
    let schedulesSkipped = 0;

    for (const st of stopTimes) {
      const dbRouteId = tripRouteMap.get(st.trip_id);
      if (!dbRouteId) {
        schedulesSkipped++;
        continue;
      }

      await client.query(
        `INSERT INTO schedules (stop_id, route_id, trip_id, arrival_time, departure_time, stop_sequence)
         SELECT s.stop_id, $1, $2, $3, $4, $5
         FROM stops s
         WHERE s.gtfs_stop_id = $6
           AND s.city_id = $7
         LIMIT 1
         ON CONFLICT DO NOTHING`,
        [
          dbRouteId,
          st.trip_id,
          formatGTFSTime(st.arrival_time),
          formatGTFSTime(st.departure_time),
          parseInt(st.stop_sequence, 10),
          st.stop_id,
          city_id
        ]
      );

      schedulesInserted++;
    }

    console.log(`   ✅ Schedules inserted: ${schedulesInserted} | skipped: ${schedulesSkipped}`);

    await client.query('COMMIT');
    console.log(`✅ [${modeType}] Ingestion complete.\n`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ [${modeType}] Ingestion failed — rolled back:`, err.message);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { ingestGTFSForMode };