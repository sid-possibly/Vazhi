// services/redisClient.js
// Singleton Redis client shared across the entire app.
// Uses ioredis which supports the rediss:// TLS scheme that Upstash requires.

const Redis = require('ioredis');

let client = null;

const getRedisClient = () => {
  if (client) return client;

  client = new Redis(process.env.REDIS_URL, {
    // Upstash requires TLS — ioredis handles this automatically
    // when the URL scheme is rediss://
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        console.error('❌ Redis: too many retries, giving up.');
        return null; // Stop retrying
      }
      return Math.min(times * 200, 2000); // Exponential backoff up to 2s
    }
  });

  client.on('connect', () => console.log('✅ Redis connected.'));
  client.on('error', (err) => console.error('❌ Redis error:', err.message));

  return client;
};

module.exports = { getRedisClient };