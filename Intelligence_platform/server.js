// server.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const { Pool }     = require('pg');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const swaggerUi    = require('swagger-ui-express');
const swaggerSpec  = require('./config/Swaggerconfig');

// Internal imports
const { findShortestPath } = require('./utils/routingEngine');
const { fetchWithRetry }   = require('./utils/apiWrapper');
const { initCronJobs }     = require('./services/cronJobs');
const graphService         = require('./services/graphService');
const { getRedisClient }   = require('./services/redisClient');
const { initGtfsPoller }   = require('./services/gtfsPoller');
const { connectMongo }     = require('./services/mongoClient');
const { ensureBootstrapData } = require('./services/dbBootstrap');
const { protect }          = require('./middleware/authMiddleware');
const { enrichJourney }    = require('./services/journeyEnricher');
const { errorHandler }     = require('./middleware/errorHandler');
const { validateJourneyPlan } = require('./middleware/validation');

// Routers
const transitRouter      = require('./routes/transitRoutes');
const authRouter         = require('./routes/authRoutes');
const reportsRouter      = require('./routes/reportsRoutes');
const userRouter         = require('./routes/userRoutes');
const alertsRouter       = require('./routes/alertsRoutes');
const analyticsRouter    = require('./routes/analyticsRoutes');
const intelligenceRouter = require('./routes/intelligenceRoutes');
const overviewRouter     = require('./routes/overviewRoutes');
const comparisonRouter   = require('./routes/comparisonRoutes');
const adminRouter        = require('./routes/adminRoutes');

const app    = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ['http://localhost:3000', 'http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed.`));
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// ── SECURITY ──────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));

// ── RATE LIMITING ─────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message:         { error: 'Too many requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message:         { error: 'Too many requests. Please try again later.' },
  standardHeaders: true, legacyHeaders: false
});

// Tighter limiter specifically for citizen report submission
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message:         { error: 'Too many reports submitted. Please wait before filing another.' },
  standardHeaders: true, legacyHeaders: false
});

app.use('/api/auth',           authLimiter);
app.use('/api/reports',        reportLimiter);   // tighter — sits before generalLimiter
app.use('/api',                generalLimiter);
app.use(express.json({ limit: '10kb' }));

// ── DB + REDIS INIT ───────────────────────────────────────────────────────────

console.log('🛠️  Vazhi Backend Starting...');

const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = getRedisClient();

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] }
});

// ── REQUEST INJECTION ─────────────────────────────────────────────────────────
// Attach pool, io, and redis to every request so route handlers
// don't need to import them directly.

app.use((req, res, next) => {
  req.pool  = pool;
  req.io    = io;
  req.redis = redis;
  next();
});

// ── SWAGGER ───────────────────────────────────────────────────────────────────

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Vazhi API Docs',
  customCss:       '.swagger-ui .topbar { background-color: #1a1a2e; }',
  swaggerOptions:  { persistAuthorization: true }
}));

app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

console.log('📖 API Docs available at http://localhost:5000/api/docs');

// ── SOCKET.IO EVENTS ──────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Client joins a city room so transit_update broadcasts are scoped correctly.
  socket.on('join_city', (cityId) => {
    socket.join(`city:${cityId}`);
    console.log(`🏙️  Socket ${socket.id} joined city room: ${cityId}`);
  });

  // Client joins a journey room so journey_recalculated reaches reconnected clients.
  socket.on('join_journey', (sessionId) => {
    socket.join(`journey:${sessionId}`);
    console.log(`🗺️  Socket ${socket.id} joined journey session: ${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// ── ROUTERS ───────────────────────────────────────────────────────────────────

app.use('/api/auth',         authRouter);
app.use('/api/transit',      transitRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/user',         userRouter);
app.use('/api/alerts',       alertsRouter);
app.use('/api/analytics',    analyticsRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/overview',     overviewRouter);
app.use('/api/comparison',   comparisonRouter);
app.use('/api/admin',        adminRouter);

// ── JOURNEY PLANNER ───────────────────────────────────────────────────────────

app.post('/api/journey/plan', protect, validateJourneyPlan, async (req, res, next) => {
  const { startStopId, endStopId, cityId } = req.body;

  console.log(`🔍 Journey Request: ${startStopId} → ${endStopId} (City: ${cityId})`);

  try {
    const graph = await graphService.getGraph(pool, cityId);

    if (Object.keys(graph).length === 0) {
      return res.status(404).json({ error: 'No transit data available for this city.' });
    }
    if (!graph[startStopId]) {
      return res.status(404).json({ error: `Start stop '${startStopId}' not found in transit graph.` });
    }
    if (startStopId === endStopId) {
      return res.status(400).json({ error: 'Start and destination stops cannot be the same.' });
    }

    const result = findShortestPath(graph, startStopId, endStopId);

    if (!result.success || result.path.length === 0) {
      return res.status(404).json({ error: 'No path found between these stops.' });
    }

    const enriched = await enrichJourney(pool, result.path, result.totalTime, cityId);

    // Collect transit route IDs for disruption monitoring
    const routeIds = enriched.legs
      .filter(l => l.type === 'transit')
      .map(l => l.routeId);

    // Register journey session for auto-recalculation on disruption
    let sessionId = null;
    if (routeIds.length > 0) {
      const { rows } = await pool.query(`
        INSERT INTO journey_sessions
          (user_id, route_ids, start_stop_id, end_stop_id, city_id, expires_at)
        VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 hour')
        RETURNING session_id
      `, [
        req.user.userId.toString(),
        routeIds,
        startStopId,
        endStopId,
        cityId
      ]);
      sessionId = rows[0]?.session_id;
    }

    res.json({
      origin:      startStopId,
      destination: endStopId,
      sessionId,   // Frontend: socket.emit('join_journey', sessionId)
      ...enriched,
      timestamp:   new Date().toISOString()
    });

  } catch (err) { next(err); }
});

// ── LIVE VEHICLE POSITIONS ────────────────────────────────────────────────────

app.get('/api/live/positions/:cityId', async (req, res, next) => {
  try {
    const { cityId } = req.params;
    const keys = await redis.keys(`pos:${cityId}:*`);
    if (keys.length === 0) {
      return res.json({
        cityId,
        positions: [],
        message:   'No active vehicles at this time.'
      });
    }
    const pipeline  = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results   = await pipeline.exec();
    const positions = results
      .map(([err, val]) => (err || !val ? null : JSON.parse(val)))
      .filter(Boolean);

    res.json({
      cityId,
      positions,
      timestamp: new Date().toISOString()
    });
  } catch (err) { next(err); }
});

// ── HEALTH CHECK (no auth, no rate limit) ─────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'UP', uptime: process.uptime() });
});

// ── GLOBAL ERROR HANDLER — must be last ──────────────────────────────────────

app.use(errorHandler);

// ── SERVER STARTUP ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Vazhi Intelligence Engine running on http://localhost:${PORT}`);
});

// Connect to PostgreSQL, then start background services.
// City ID is queried dynamically — never hardcoded — so it works on any
// fresh database where the seed UUID might differ.
pool.connect(async (err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.stack);
    return;
  }
  console.log('✅ Successfully connected to PostgreSQL + PostGIS');
  release();

  try {
    const KOCHI_CITY_ID = await ensureBootstrapData(pool);
    console.log(`🏙️  Kochi city_id resolved: ${KOCHI_CITY_ID}`);

    initCronJobs(pool);
    initGtfsPoller(pool, KOCHI_CITY_ID, redis, io, graphService);

  } catch (resolveErr) {
    console.error('❌ Failed to resolve city ID:', resolveErr.message);
  }
});

connectMongo();

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  pool.end();
  redis.quit();
  process.exit(0);
});
