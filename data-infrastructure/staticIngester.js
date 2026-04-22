const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
console.log("DB URL Check:", process.env.DATABASE_URL ? "Found" : "NOT FOUND");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Task 3: GTFS Static Ingester
 * Ingests stops, routes, and schedules for a specific mode.
 */
const ingestGTFS = async (citySlug, modeType, folderPath) => {
    try {
        // Resolve City and Mode IDs [cite: 122, 123]
        const modeRes = await pool.query(`
            SELECT m.mode_id, c.city_id 
            FROM transport_modes m 
            JOIN cities c ON m.city_id = c.city_id 
            WHERE c.slug = $1 AND m.type = $2`, [citySlug, modeType]);
        
        if (modeRes.rows.length === 0) throw new Error("Metadata missing for this city/mode");
        const { mode_id, city_id } = modeRes.rows[0];

        // 1. Ingest STOPS (stops.txt) [cite: 252]
        const stops = parse(fs.readFileSync(path.join(folderPath, 'stops.txt')), { columns: true });
        for (const s of stops) {
            await pool.query(`
                INSERT INTO stops (city_id, gtfs_stop_id, stop_name, geom)
                VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))
                ON CONFLICT (gtfs_stop_id) DO NOTHING`, [city_id, s.stop_id, s.stop_name, s.stop_lon, s.stop_lat]);
        }
        console.log(`✅ Ingested ${stops.length} stops`);

        // 2. Ingest ROUTES (routes.txt) [cite: 251]
        const routes = parse(fs.readFileSync(path.join(folderPath, 'routes.txt')), { columns: true });
        for (const r of routes) {
            await pool.query(`
                INSERT INTO routes (mode_id, gtfs_route_id, route_short_name, route_color)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (gtfs_route_id) DO NOTHING`, [mode_id, r.route_id, r.route_short_name, r.route_color || '#000000']);
        }
        console.log(`✅ Ingested ${routes.length} routes`);

    } catch (err) {
        console.error("Ingestion failed:", err.message);
    } finally {
        pool.end();
    }
};