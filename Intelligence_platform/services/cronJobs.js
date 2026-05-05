// services/cronJobs.js
// Background cron jobs:
//   Every hour:    expire old citizen reports
//   Every hour:    deactivate expired alerts
//   Every 15 mins: update city current_status based on active alerts
//   Every 30 mins: aggregate route analytics snapshot
//   Weekly:        Refresh Static GTFS Data

const cron = require('node-cron');
const { ingestGTFSForMode } = require('./realIngester');

const initCronJobs = (pool) => {

  // 1. Expire old citizen reports
  cron.schedule('0 * * * *', async () => {
    console.log('--- Cron: Expiring old citizen reports ---');
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM citizen_reports WHERE expires_at < NOW()`
      );
      console.log(`--- Cron: Deleted ${rowCount} expired reports ---`);
    } catch (err) {
      console.error('--- Cron: Report cleanup failed ---', err.message);
    }
  });

  // 2. Deactivate expired alerts
  cron.schedule('0 * * * *', async () => {
    console.log('--- Cron: Deactivating expired alerts ---');
    try {
      const { rowCount } = await pool.query(
        `UPDATE alerts SET is_active = false
         WHERE is_active = true AND expires_at < NOW()`
      );
      console.log(`--- Cron: Deactivated ${rowCount} expired alerts ---`);
    } catch (err) {
      console.error('--- Cron: Alert cleanup failed ---', err.message);
    }
  });

  // 3. Auto-update city current_status based on active alerts
  cron.schedule('*/15 * * * *', async () => {
    console.log('--- Cron: Updating city status badges ---');
    try {
      const { rows: cities } = await pool.query(`SELECT city_id FROM cities`);

      for (const city of cities) {
        const { rows: alertRows } = await pool.query(`
          SELECT severity FROM alerts
          WHERE city_id = $1
            AND is_active = true
            AND expires_at > NOW()
        `, [city.city_id]);

        let newStatus = 'Operational';
        if (alertRows.some(a => a.severity === 'Critical')) {
          newStatus = 'Disrupted';
        } else if (alertRows.some(a => a.severity === 'Warning')) {
          newStatus = 'Delayed';
        }

        await pool.query(
          `UPDATE cities SET current_status = $1 WHERE city_id = $2`,
          [newStatus, city.city_id]
        );
      }

      console.log(`--- Cron: Updated status for ${cities.length} cities ---`);
    } catch (err) {
      console.error('--- Cron: City status update failed ---', err.message);
    }
  });

  // 4. Route analytics aggregator — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('--- Cron: Aggregating route analytics ---');
    try {
      const { rows: routes } = await pool.query(`
        SELECT DISTINCT r.route_id, r.gtfs_route_id, tm.city_id
        FROM routes r
        JOIN transport_modes tm ON tm.mode_id = r.mode_id
      `);

      for (const route of routes) {
        const istNow = `(NOW() AT TIME ZONE 'Asia/Kolkata')::time`;

        const { rows: activeRows } = await pool.query(`
          SELECT COUNT(DISTINCT sch.trip_id) AS active_trips
          FROM schedules sch
          JOIN routes r ON r.route_id = sch.route_id
          WHERE r.route_id = $1
            AND ${istNow} BETWEEN
              (SELECT MIN(departure_time) FROM schedules WHERE route_id = $1)
              AND
              (SELECT MAX(arrival_time) FROM schedules WHERE route_id = $1)
        `, [route.route_id]);

        const { rows: alertRows } = await pool.query(`
          SELECT
            COUNT(*)                                       AS total_alerts,
            AVG(delay_minutes)                             AS avg_delay,
            COUNT(*) FILTER (WHERE delay_minutes >= 5)    AS delayed_count
          FROM alerts
          WHERE route_id = $1
            AND created_at > NOW() - INTERVAL '24 hours'
        `, [route.route_id]);

        const activeTripCount = parseInt(activeRows[0]?.active_trips || 0);
        const totalAlerts     = parseInt(alertRows[0]?.total_alerts  || 0);
        const avgDelay        = parseFloat(alertRows[0]?.avg_delay   || 0);
        const delayedCount    = parseInt(alertRows[0]?.delayed_count || 0);

        const onTimePct = totalAlerts > 0
          ? Math.max(0, ((totalAlerts - delayedCount) / totalAlerts) * 100)
          : 100;

        await pool.query(`
          INSERT INTO route_analytics
            (route_id, city_id, active_trips, avg_delay_mins, on_time_pct, delayed_trips, total_trips)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          route.route_id,
          route.city_id,
          activeTripCount,
          avgDelay.toFixed(2),
          onTimePct.toFixed(2),
          delayedCount,
          totalAlerts
        ]);
      }

      console.log(`--- Cron: Analytics snapshot written for ${routes.length} routes ---`);
    } catch (err) {
      console.error('--- Cron: Analytics aggregation failed ---', err.message);
    }
  });

  // 5. Phase 1, Task 3: Weekly Static GTFS Refresh (Sundays at 2 AM)
  cron.schedule('0 2 * * 0', async () => {
    console.log('--- Cron: Starting Weekly GTFS Refresh ---');
    try {
      await ingestGTFSForMode(pool, 'kochi', 'Metro', './data/kochi/metro', ['KMRL']);
      await ingestGTFSForMode(pool, 'kochi', 'Water', './data/kochi/community', ['Kochi city boat']);
      await ingestGTFSForMode(pool, 'kochi', 'Bus', './data/kochi/community', ['Kochi city bus', 'Ordinary bus', 'Mofussil Kochi bus']);
      console.log('--- Cron: GTFS Refresh Successful ---');
    } catch (err) {
      console.error('--- Cron: GTFS Refresh Failed ---', err.message);
    }
  });

  console.log('✅ Cron Jobs Initialized.');
};

module.exports = { initCronJobs };