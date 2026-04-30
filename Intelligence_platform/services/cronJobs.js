// services/cronJobs.js
// Background cron jobs:
//   - Every hour: expire old citizen reports
//   - Every hour: deactivate expired alerts

const cron = require('node-cron');

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

  console.log('✅ Cron Jobs Initialized.');
};

module.exports = { initCronJobs };