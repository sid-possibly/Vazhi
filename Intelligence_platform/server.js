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
const swaggerSpec  = require('./config/swaggerConfig');

// Internal imports
const { findShortestPath }    = require('./utils/routingEngine');
const { initCronJobs }        = require('./services/cronJobs');
const graphService            = require('./services/graphService');
const { getRedisClient }      = require('./services/redisClient');
const { initGtfsPoller }      = require('./services/gtfsPoller');
const { connectMongo }        = require('./services/mongoClient');
const { protect }             = require('./middleware/authMiddleware');
const { enrichJourney }       = require('./services/journeyEnricher');
const { errorHandler }        = require('./middleware/errorHandler');
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

// ── HELMET ────────────────────────────────────────────────────────────────────

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

app.use('/api/auth', authLimiter);
app.use('/api',      generalLimiter);
app.use(express.json({ limit: '10kb' }));

console.log('🛠️  Vazhi Backend Starting...');

const pool  = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = getRedisClient();

const KOCHI_CITY_ID = 'e79757c5-93d1-4230-85e3-90998123061c';

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] }
});

// Inject pool and io into every request
app.use((req, res, next) => {
  req.pool = pool;
  req.io   = io;
  next();
});

// ── SWAGGER UI ────────────────────────────────────────────────────────────────

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

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

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

// ── JOURNEY PLANNER ───────────────────────────────────────────────────────────

app.post('/api/journey/plan', protect, validateJourneyPlan, async (req, res, next) => {
  const { startStopId, endStopId, cityId } = req.body;

  console.log(`🔍 Journey Request: ${startStopId} → ${endStopId} (City: ${cityId})`);

  try {
    const graph = await graphService.getGraph(pool, cityId);

    if (Object.keys(graph).length === 0) {
      return res.status(404).json({ success: false, message: 'No transit data available for this city.' });
    }
    if (!graph[startStopId]) {
      return res.status(404).json({ success: false, message: `Start stop '${startStopId}' not found in transit graph.` });
    }

    const result = findShortestPath(graph, startStopId, endStopId);

    // Phase 1, Task 1 Fix: Handle no path found gracefully
    if (!result.success || result.totalTime === Infinity || result.path.length === 0) {
      return res.status(200).json({ 
        success: false, 
        message: 'No transit path found between these locations. Try adjusting your start or end points.',
        fallback: 'GTFS Real-time or static data may be unavailable for this specific route.'
      });
    }

    const enriched = await enrichJourney(pool, result.path, result.totalTime, cityId);

    const routeIds = enriched.legs
      .filter(l => l.type === 'transit')
      .map(l => l.routeId);

    let sessionId = null;
    if (routeIds.length > 0) {
      const { rows } = await pool.query(`
        INSERT INTO journey_sessions
          (user_id, socket_id, route_ids, start_stop_id, end_stop_id, city_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING session_id
      `, [
        req.user.userId,
        req.headers['x-socket-id'] || 'unknown',
        routeIds,
        startStopId,
        endStopId,
        cityId
      ]);
      sessionId = rows[0]?.session_id;
    }

    res.json({
      success: true,
      origin:      startStopId,
      destination: endStopId,
      sessionId,   
      ...enriched,
      timestamp: new Date().toISOString()
    });

  } catch (err) { next(err); }
});

// ── LIVE VEHICLE POSITIONS ────────────────────────────────────────────────────

app.get('/api/live/positions/:cityId', async (req, res, next) => {
  const { cityId } = req.params;
  try {
    const keys = await redis.keys('pos:*');
    if (keys.length === 0) {
      return res.json({ cityId, positions: [], message: 'No active vehicles at this time.' });
    }
    const pipeline  = redis.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results   = await pipeline.exec();
    const positions = results
      .map(([err, val]) => (err || !val ? null : JSON.parse(val)))
      .filter(Boolean);
    res.json({ cityId, positions, timestamp: new Date().toISOString() });
  } catch (err) { next(err); }
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────

app.use(errorHandler);

// ── SERVER STARTUP ────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`✅ Vazhi Intelligence Engine running on http://localhost:${PORT}`);
});

pool.connect((err, client, release) => {
  if (err) return console.error('❌ Database Connection Error:', err.stack);
  console.log('✅ Successfully connected to PostgreSQL + PostGIS');
  initCronJobs(pool);
  initGtfsPoller(pool, KOCHI_CITY_ID, redis, io, graphService);
  release();
});

connectMongo();

process.on('SIGTERM', () => {
  console.log('🛑 Shutting down gracefully...');
  pool.end();
  redis.quit();
  process.exit(0);
});