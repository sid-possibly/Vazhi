const cron = require('node-cron');

// Task 15: Background Cron Jobs [cite: 163, 228]
const initCronJobs = (pool) => {
  // Runs every hour ('0 * * * *')
  cron.schedule('0 * * * *', async () => {
    console.log('--- Running Background Cleanup: Expiring old Citizen Reports ---');
    try {
      const query = `
        DELETE FROM citizen_reports 
        WHERE expires_at < NOW();
      `;
      await pool.query(query);
      console.log('--- Cleanup Successful: Stale reports removed ---');
    } catch (err) {
      console.error('--- Cleanup Failed ---', err);
    }
  });
};

module.exports = { initCronJobs };