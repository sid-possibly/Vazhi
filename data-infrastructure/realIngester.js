// services/realIngester.js
const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const graphService = require('../Intelligence_platform/services/graphService'); // Phase 1, Task 4 Fix

const formatGTFSTime = (timeStr) => {
  if (!timeStr) return null;
  const parts = timeStr.trim().split(':');
  const hours = parseInt(parts[0], 10) % 24;
  return `${hours.toString().padStart(2, '0')}:${parts[1]}:${parts[2]}`;
};

const ingestGTFSForMode = async (pool, citySlug, modeType, folderPath, agencyFilter = []) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const metaRes = await client.query(
      `SELECT c.city_id, m.mode_id
       FROM cities c
       JOIN transport_modes m ON m.city_id = c.city_id
       WHERE c.slug = $1 AND m.type = $2`,
      [citySlug, modeType]
    );

    if (metaRes.rows.length === 0) {
      throw new Error(
        `No DB record found for city slug '${citySlug}' and mode '${modeType}'.`
      );
    }

    const { city_id, mode_id } = metaRes.rows[0];
    console.log(`   city_id: ${city_id} | mode_id: ${mode_id}`);

    // 1. ROUTES
    const routes = parse(fs.readFileSync(path.join(folderPath, 'routes.txt')), { columns: true, skip_empty_lines: true, trim: true });
    const routeMap = new Map();

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
        [mode_id, r.route_id, r.route_short_name || r.route_long_name || r.route_id, r.route_color ? `#${r.route_color.replace('#', '')}` : '#000000']
      );
      routeMap.set(r.route_id, res.rows[0].route_id);
    }
    console.log(`   ✅ Routes ingested: ${routeMap.size}`);

    // 2. STOPS
    const stops = parse(fs.readFileSync(path.join(folderPath, 'stops.txt')), { columns: true, skip_empty_lines: true, trim: true });
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

    // 3. TRIPS
    const trips = parse(fs.readFileSync(path.join(folderPath, 'trips.txt')), { columns: true, skip_empty_lines: true, trim: true });
    const tripRouteMap  = new Map();
    const shapeRouteMap = new Map();

    for (const t of trips) {
      if (routeMap.has(t.route_id)) {
        tripRouteMap.set(t.trip_id, routeMap.get(t.route_id));
        if (t.shape_id && !shapeRouteMap.has(t.shape_id)) {
          shapeRouteMap.set(t.shape_id, t.route_id);
        }
      }
    }
    console.log(`   ✅ Trips mapped: ${tripRouteMap.size}`);

    // 4. SHAPES
    const shapesPath = path.join(folderPath, 'shapes.txt');
    if (fs.existsSync(shapesPath)) {
      const shapePoints = parse(fs.readFileSync(shapesPath), { columns: true, skip_empty_lines: true, trim: true });
      const shapeMap = new Map();
      for (const pt of shapePoints) {
        if (!shapeMap.has(pt.shape_id)) shapeMap.set(pt.shape_id, []);
        shapeMap.get(pt.shape_id).push(pt);
      }

      let shapesIngested = 0;
      for (const [shapeId, points] of shapeMap) {
        const gtfsRouteId = shapeRouteMap.get(shapeId);
        if (!gtfsRouteId) continue;

        points.sort((a, b) => parseFloat(a.shape_pt_sequence) - parseFloat(b.shape_pt_sequence));
        if (points.length < 2) continue;

        const coords = points.map(p => `${parseFloat(p.shape_pt_lon)} ${parseFloat(p.shape_pt_lat)}`).join(', ');
        const wkt = `LINESTRING(${coords})`;

        await client.query(`UPDATE routes SET route_shape = ST_SetSRID(ST_GeomFromText($1), 4326) WHERE gtfs_route_id = $2`, [wkt, gtfsRouteId]);
        shapesIngested++;
      }
      console.log(`   ✅ Shapes ingested: ${shapesIngested}`);
    }

    // 5. STOP TIMES / SCHEDULES
    const stopTimes = parse(fs.readFileSync(path.join(folderPath, 'stop_times.txt')), { columns: true, skip_empty_lines: true, trim: true });
    let schedulesInserted = 0;
    let schedulesSkipped  = 0;

    for (const st of stopTimes) {
      const dbRouteId = tripRouteMap.get(st.trip_id);
      if (!dbRouteId) { schedulesSkipped++; continue; }

      await client.query(
        `INSERT INTO schedules (stop_id, route_id, trip_id, arrival_time, departure_time, stop_sequence)
         SELECT s.stop_id, $1, $2, $3, $4, $5 FROM stops s WHERE s.gtfs_stop_id = $6 AND s.city_id = $7 LIMIT 1
         ON CONFLICT DO NOTHING`,
        [dbRouteId, st.trip_id, formatGTFSTime(st.arrival_time), formatGTFSTime(st.departure_time), parseInt(st.stop_sequence, 10), st.stop_id, city_id]
      );
      schedulesInserted++;
    }
    console.log(`   ✅ Schedules inserted: ${schedulesInserted} | skipped: ${schedulesSkipped}`);

    // 6. FARE ATTRIBUTES
    const fareAttrsPath = path.join(folderPath, 'fare_attributes.txt');
    if (fs.existsSync(fareAttrsPath)) {
      const fareAttrs = parse(fs.readFileSync(fareAttrsPath), { columns: true, skip_empty_lines: true, trim: true });
      for (const f of fareAttrs) {
        await client.query(
          `INSERT INTO fare_attributes (fare_id, city_id, price, currency_type, payment_method, transfers)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (fare_id) DO UPDATE
             SET price = EXCLUDED.price, currency_type = EXCLUDED.currency_type, payment_method = EXCLUDED.payment_method, transfers = EXCLUDED.transfers`,
          [f.fare_id, city_id, parseFloat(f.price), f.currency_type || 'INR', parseInt(f.payment_method || 0), f.transfers !== '' && f.transfers !== undefined ? parseInt(f.transfers) : null]
        );
      }
      console.log(`   ✅ Fare attributes ingested: ${fareAttrs.length}`);
    }

    // 7. FARE RULES
    const fareRulesPath = path.join(folderPath, 'fare_rules.txt');
    if (fs.existsSync(fareRulesPath)) {
      const fareRules = parse(fs.readFileSync(fareRulesPath), { columns: true, skip_empty_lines: true, trim: true });
      await client.query(`DELETE FROM fare_rules WHERE route_id IN (SELECT r.route_id FROM routes r JOIN transport_modes tm ON tm.mode_id = r.mode_id WHERE tm.city_id = $1)`, [city_id]);

      let fareRulesInserted = 0;
      for (const fr of fareRules) {
        const internalRouteId = fr.route_id ? routeMap.get(fr.route_id) || null : null;
        await client.query(`INSERT INTO fare_rules (fare_id, route_id, origin_id, destination_id) VALUES ($1, $2, $3, $4)`, [fr.fare_id, internalRouteId, fr.origin_id || null, fr.destination_id || null]);
        fareRulesInserted++;
      }
      console.log(`   ✅ Fare rules ingested: ${fareRulesInserted}`);
    }

    await client.query('COMMIT');

    // Phase 1, Task 4: Clear the graph cache after a successful DB commit
    graphService.clearCache(city_id);

    // 8. WRITE FEED METADATA
    await pool.query(
      `INSERT INTO gtfs_feed_metadata (city_id, mode_id, last_ingested_at, routes_count, stops_count, schedules_count)
       VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (city_id, mode_id) DO UPDATE
         SET last_ingested_at = NOW(), routes_count = EXCLUDED.routes_count, stops_count = EXCLUDED.stops_count, schedules_count = EXCLUDED.schedules_count`,
      [city_id, mode_id, routeMap.size, stops.length, schedulesInserted]
    );

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