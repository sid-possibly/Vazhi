// const path = require('path');

// // 1. Explicitly load the .env file from the parent directory (Vazhi/)
// require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// // 2. THE TRIPWIRE: Prove the environment loaded before doing anything else
// if (!process.env.DATABASE_URL) {
//     console.error("🛑 FATAL ERROR: DATABASE_URL is undefined.");
//     console.error("👉 Fix: Ensure your .env file is in the 'Vazhi' folder (one level up) and contains DATABASE_URL=...");
//     process.exit(1); // Kill the script immediately
// } else {
//     console.log("✅ DB Connection String loaded successfully.");
// }

// const { Pool } = require('pg');
// const { ingestGTFSForMode } = require('./realIngester');

// // Initialize the database pool
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// const runFullIngestion = async () => {
//     console.log("🚀 Starting Full Vazhi Data Ingestion...");

//     try {
//         // 1. KMRL Metro Feed
//         console.log("\n🚇 Processing Metro Feed...");
//         await ingestGTFSForMode(pool, 'kochi', 'Metro', './data/kochi/metro', ['KMRL']);

//         // 2. Community Feed Path
//         const communityPath = './data/kochi/community';

//         // 3. Water Feed
//         console.log("\n⛴️  Processing Water Metro...");
//         await ingestGTFSForMode(pool, 'kochi', 'Water', communityPath, ['Kochi city boat']);

//         // 4. Bus Feed
//         console.log("\n🚌 Processing Buses...");
//         await ingestGTFSForMode(pool, 'kochi', 'Bus', communityPath, [
//             'Kochi city bus', 
//             'Ordinary bus', 
//             'Mofussil Kochi bus'
//         ]);

//         console.log("\n🏁 All modes ingested successfully! Multimodal graph is ready.");
//     } catch (err) {
//         console.error("\n💥 Critical Ingestion Failure:", err.message);
//     } finally {
//         await pool.end();
//         process.exit(0);
//     }
// };

// runFullIngestion();




// test-ingestion.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.DATABASE_URL) {
    console.error("🛑 FATAL ERROR: DATABASE_URL is undefined.");
    process.exit(1);
}

const { Pool } = require('pg');
const { ingestGTFSForMode } = require('./realIngester');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const runFullIngestion = async () => {
    console.log("🚀 Starting Full Vazhi Data Ingestion...");

    try {
        // Step 1: Ensure Kochi city exists in Postgres
        // This is often why teammates fail—they don't have the city row yet.
        const cityRes = await pool.query("SELECT city_id FROM cities WHERE slug = 'kochi' LIMIT 1");
        if (cityRes.rows.length === 0) {
            console.error("❌ Error: 'kochi' not found in cities table. Please run migrations/seeders first.");
            process.exit(1);
        }

        const communityPath = './data/kochi/community';

        // 1. KMRL Metro Feed
        console.log("\n🚇 Processing Metro Feed...");
        await ingestGTFSForMode(pool, 'kochi', 'Metro', './data/kochi/metro', ['KMRL']);

        // 2. Water Feed
        console.log("\n⛴️  Processing Water Metro...");
        await ingestGTFSForMode(pool, 'kochi', 'Water', communityPath, ['Kochi city boat']);

        // 3. Bus Feed
        console.log("\n🚌 Processing Buses...");
        await ingestGTFSForMode(pool, 'kochi', 'Bus', communityPath, [
            'Kochi city bus', 
            'Ordinary bus', 
            'Mofussil Kochi bus'
        ]);

        console.log("\n🏁 All modes ingested successfully!");
    } catch (err) {
        console.error("\n💥 Critical Ingestion Failure:", err.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
};

runFullIngestion(); 