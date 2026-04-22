const cron = require('node-cron');

/**
 * Initializes scheduled background tasks.
 */
const initCronJobs = (pool) => {
  // 1. Cleanup old reports every hour
  cron.schedule('0 * * * *', async () => {
    console.log('--- Running Background Cleanup: Expiring old Citizen Reports ---');
    try {
      const query = `DELETE FROM citizen_reports WHERE expires_at < NOW();`;
      await pool.query(query);
      console.log('--- Cleanup Successful ---');
    } catch (err) {
      console.error('--- Cleanup Failed ---', err);
    }
  });

  // You can add a midnight graph rebuild here if needed
  console.log('✅ Cron Jobs Initialized.');
};

// EXPORT FIX: Ensures server.js can call this during startup
module.exports = { initCronJobs };