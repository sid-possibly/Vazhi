// config/swaggerConfig.js
// OpenAPI 3.0 specification for the Vazhi backend.
// Available at GET /api/docs (Swagger UI) and GET /api/docs.json (raw spec).

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Vazhi — Real-Time Transit Intelligence API',
      version:     '1.0.0',
      description: 'Backend API for the Vazhi Kerala transit intelligence platform. Covers authentication, transit data, journey planning, alerts, citizen reports, analytics, and intelligence layers.',
      contact: {
        name: 'Vazhi Dev Team'
      }
    },
    servers: [
      { url: 'http://localhost:5000', description: 'Local development' },
      { url: 'https://your-production-url.com', description: 'Production' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'JWT access token from POST /api/auth/login. Expires in 15 minutes.'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error:  { type: 'string', example: 'An error occurred.' },
            errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } }
          }
        },
        City: {
          type: 'object',
          properties: {
            city_id:       { type: 'string', format: 'uuid' },
            name:          { type: 'string', example: 'Kochi' },
            slug:          { type: 'string', example: 'kochi' },
            current_status:{ type: 'string', enum: ['Operational', 'Delayed', 'Disrupted'] },
            lat:           { type: 'number', example: 9.9312 },
            lng:           { type: 'number', example: 76.2673 },
            lastUpdated:   { type: 'string', format: 'date-time' },
            modes:         { type: 'array', items: { type: 'object' } }
          }
        },
        Alert: {
          type: 'object',
          properties: {
            alertId:      { type: 'string', format: 'uuid' },
            routeId:      { type: 'string' },
            routeName:    { type: 'string' },
            routeColor:   { type: 'string' },
            tripId:       { type: 'string' },
            severity:     { type: 'string', enum: ['minor', 'major', 'critical'] },
            message:      { type: 'string' },
            delayMinutes: { type: 'integer' },
            createdAt:    { type: 'string', format: 'date-time' },
            expiresAt:    { type: 'string', format: 'date-time' }
          }
        },
        JourneyResult: {
          type: 'object',
          properties: {
            origin:               { type: 'string' },
            destination:          { type: 'string' },
            sessionId:            { type: 'string', format: 'uuid', nullable: true },
            legs:                 { type: 'array', items: { type: 'object' } },
            totalTravelTimeMinutes: { type: 'string' },
            transfers:            { type: 'integer' },
            totalFare:            { type: 'object', nullable: true },
            timestamp:            { type: 'string', format: 'date-time' }
          }
        },
        CitizenReport: {
          type: 'object',
          properties: {
            reportId:       { type: 'string', format: 'uuid' },
            userId:         { type: 'string' },
            category:       { type: 'string', enum: ['Overcrowded', 'Infrastructure', 'Missed', 'Unsafe'] },
            description:    { type: 'string' },
            upvotes:        { type: 'integer' },
            lat:            { type: 'number' },
            lng:            { type: 'number' },
            distanceMetres: { type: 'integer' },
            expiresAt:      { type: 'string', format: 'date-time' },
            createdAt:      { type: 'string', format: 'date-time' }
          }
        }
      }
    },
    tags: [
      { name: 'Auth',         description: 'Registration, login, token management' },
      { name: 'Transit',      description: 'Cities, routes, stops, arrivals' },
      { name: 'Journey',      description: 'Journey planning with Dijkstra routing' },
      { name: 'Live',         description: 'Real-time vehicle positions from Redis' },
      { name: 'Alerts',       description: 'Service disruption alerts' },
      { name: 'Reports',      description: 'Citizen community reports' },
      { name: 'Analytics',    description: 'Historical route performance data' },
      { name: 'Intelligence', description: 'AQI, weather, and traffic layers' },
      { name: 'Overview',     description: 'Kerala state-level metrics' },
      { name: 'Comparison',   description: 'Side-by-side city comparison' },
      { name: 'User',         description: 'Profile, saved routes, alert prefs' },
      { name: 'Admin',        description: 'City/mode management (admin only)' }
    ],
    paths: {

      // ── AUTH ────────────────────────────────────────────────────────────────

      '/api/auth/register': {
        post: {
          tags:    ['Auth'],
          summary: 'Register a new user account',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['name', 'email', 'password'], properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } } } } }
          },
          responses: {
            201: { description: 'Account created' },
            409: { description: 'Email already in use' }
          }
        }
      },
      '/api/auth/login': {
        post: {
          tags:    ['Auth'],
          summary: 'Login and receive JWT + refresh token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } } } }
          },
          responses: {
            200: { description: 'Login successful — returns accessToken + refreshToken' },
            401: { description: 'Invalid credentials' }
          }
        }
      },
      '/api/auth/refresh': {
        post: {
          tags:    ['Auth'],
          summary: 'Rotate refresh token and get new access token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } }
          },
          responses: {
            200: { description: 'New accessToken + refreshToken' },
            401: { description: 'Invalid, expired, or reused token' }
          }
        }
      },
      '/api/auth/logout': {
        post: {
          tags:    ['Auth'],
          summary: 'Revoke the current refresh token',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } }
          },
          responses: { 200: { description: 'Logged out successfully' } }
        }
      },

      // ── TRANSIT ─────────────────────────────────────────────────────────────

      '/api/transit/cities': {
        get: {
          tags:    ['Transit'],
          summary: 'List all cities with their transport modes (Redis-cached 5 min)',
          responses: { 200: { description: 'Array of city objects', content: { 'application/json': { schema: { type: 'object', properties: { cities: { type: 'array', items: { '$ref': '#/components/schemas/City' } } } } } } } }
        }
      },
      '/api/transit/{cityId}/routes': {
        get: {
          tags:    ['Transit'],
          summary: 'Get all routes for a city as GeoJSON FeatureCollection',
          parameters: [
            { name: 'cityId', in: 'path',  required: true,  schema: { type: 'string', format: 'uuid' } },
            { name: 'mode',   in: 'query', required: false, schema: { type: 'string', enum: ['Metro', 'Bus', 'Water', 'Rail'] } }
          ],
          responses: { 200: { description: 'GeoJSON FeatureCollection of route shapes' } }
        }
      },
      '/api/transit/{cityId}/stops': {
        get: {
          tags:    ['Transit'],
          summary: 'Get all stops for a city as GeoJSON FeatureCollection',
          parameters: [
            { name: 'cityId', in: 'path',  required: true,  schema: { type: 'string', format: 'uuid' } },
            { name: 'mode',   in: 'query', required: false, schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'GeoJSON FeatureCollection of stop points' } }
        }
      },
      '/api/transit/{cityId}/stops/search': {
        get: {
          tags:    ['Transit'],
          summary: 'Search stops by name (fuzzy)',
          parameters: [
            { name: 'cityId', in: 'path',  required: true,  schema: { type: 'string' } },
            { name: 'q',      in: 'query', required: true,  schema: { type: 'string' } },
            { name: 'mode',   in: 'query', required: false, schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'Matching stops array' } }
        }
      },
      '/api/transit/stops/{gtfsStopId}/arrivals': {
        get: {
          tags:    ['Transit'],
          summary: 'Next arrivals at a stop (up to 5)',
          parameters: [
            { name: 'gtfsStopId', in: 'path',  required: true,  schema: { type: 'string' } },
            { name: 'limit',      in: 'query', required: false, schema: { type: 'integer', default: 5, maximum: 20 } }
          ],
          responses: { 200: { description: 'Upcoming arrivals list' } }
        }
      },

      // ── JOURNEY ─────────────────────────────────────────────────────────────

      '/api/journey/plan': {
        post: {
          tags:       ['Journey'],
          summary:    'Plan a journey between two stops (Dijkstra + enrichment)',
          security:   [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['startStopId', 'endStopId', 'cityId'], properties: { startStopId: { type: 'string' }, endStopId: { type: 'string' }, cityId: { type: 'string', format: 'uuid' } } } } }
          },
          responses: {
            200: { description: 'Journey result with legs, fare, sessionId for WebSocket room', content: { 'application/json': { schema: { '$ref': '#/components/schemas/JourneyResult' } } } },
            404: { description: 'No path found or stop not in graph' }
          }
        }
      },

      // ── LIVE ────────────────────────────────────────────────────────────────

      '/api/live/positions/{cityId}': {
        get: {
          tags:    ['Live'],
          summary: 'Current interpolated vehicle positions from Redis',
          parameters: [{ name: 'cityId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Array of vehicle position objects' } }
        }
      },

      // ── ALERTS ──────────────────────────────────────────────────────────────

      '/api/alerts/{cityId}': {
        get: {
          tags:    ['Alerts'],
          summary: 'All active alerts for a city',
          parameters: [
            { name: 'cityId',   in: 'path',  required: true,  schema: { type: 'string' } },
            { name: 'severity', in: 'query', required: false, schema: { type: 'string', enum: ['minor', 'major', 'critical'] } }
          ],
          responses: { 200: { description: 'Active alerts list', content: { 'application/json': { schema: { type: 'object', properties: { alerts: { type: 'array', items: { '$ref': '#/components/schemas/Alert' } } } } } } } }
        }
      },
      '/api/alerts/{cityId}/route/{gtfsRouteId}': {
        get: {
          tags:    ['Alerts'],
          summary: 'Active alerts for a specific route',
          parameters: [
            { name: 'cityId',      in: 'path', required: true, schema: { type: 'string' } },
            { name: 'gtfsRouteId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'Route-specific alerts' } }
        }
      },

      // ── REPORTS ─────────────────────────────────────────────────────────────

      '/api/reports': {
        get: {
          tags:    ['Reports'],
          summary: 'Get citizen reports within a radius',
          parameters: [
            { name: 'lat',    in: 'query', required: true,  schema: { type: 'number' } },
            { name: 'lng',    in: 'query', required: true,  schema: { type: 'number' } },
            { name: 'radius', in: 'query', required: false, schema: { type: 'integer', default: 2000 }, description: 'Radius in metres' },
            { name: 'limit',  in: 'query', required: false, schema: { type: 'integer', default: 50 } }
          ],
          responses: { 200: { description: 'Reports within radius', content: { 'application/json': { schema: { type: 'object', properties: { reports: { type: 'array', items: { '$ref': '#/components/schemas/CitizenReport' } } } } } } } }
        },
        post: {
          tags:    ['Reports'],
          summary: 'File a new citizen report (auth required)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object', required: ['category', 'description', 'lat', 'lng'], properties: { category: { type: 'string', enum: ['Overcrowded', 'Infrastructure', 'Missed', 'Unsafe'] }, description: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } } }
          },
          responses: { 201: { description: 'Report filed — broadcast via WebSocket new_report event' } }
        }
      },
      '/api/reports/{reportId}/upvote': {
        post: {
          tags:     ['Reports'],
          summary:  'Upvote a citizen report (auth required)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'reportId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Updated upvote count' }, 404: { description: 'Report not found or expired' } }
        }
      },

      // ── ANALYTICS ───────────────────────────────────────────────────────────

      '/api/analytics/route/{routeId}': {
        get: {
          tags:    ['Analytics'],
          summary: 'Historical performance data for a route',
          parameters: [
            { name: 'routeId', in: 'path',  required: true,  schema: { type: 'string' } },
            { name: 'days',    in: 'query', required: false, schema: { type: 'integer', default: 7 } }
          ],
          responses: { 200: { description: 'Analytics snapshots array' }, 404: { description: 'No data found' } }
        }
      },

      // ── INTELLIGENCE ─────────────────────────────────────────────────────────

      '/api/intelligence/aqi': {
        get: {
          tags:    ['Intelligence'],
          summary: 'Air quality data for a city (OpenAQ)',
          parameters: [{ name: 'city', in: 'query', required: false, schema: { type: 'string', default: 'Kochi' } }],
          responses: { 200: { description: 'AQI readings' } }
        }
      },
      '/api/intelligence/weather': {
        get: {
          tags:    ['Intelligence'],
          summary: 'Current weather at coordinates (OpenWeatherMap)',
          parameters: [
            { name: 'lat', in: 'query', required: true, schema: { type: 'number' } },
            { name: 'lng', in: 'query', required: true, schema: { type: 'number' } }
          ],
          responses: { 200: { description: 'Weather data object' } }
        }
      },
      '/api/intelligence/traffic': {
        get: {
          tags:    ['Intelligence'],
          summary: 'Traffic congestion heatmap points (TomTom)',
          parameters: [
            { name: 'lat', in: 'query', required: true, schema: { type: 'number' } },
            { name: 'lng', in: 'query', required: true, schema: { type: 'number' } }
          ],
          responses: { 200: { description: 'Array of heatmap points with congestion ratio' } }
        }
      },

      // ── OVERVIEW ─────────────────────────────────────────────────────────────

      '/api/overview/metrics': {
        get: {
          tags:    ['Overview'],
          summary: 'Kerala state-level metrics for the landing page',
          responses: { 200: { description: 'Active routes, disruption counts, avg AQI, weather advisory' } }
        }
      },

      // ── COMPARISON ───────────────────────────────────────────────────────────

      '/api/comparison': {
        get: {
          tags:    ['Comparison'],
          summary: 'Side-by-side transit metrics for two cities',
          parameters: [
            { name: 'city1', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'city2', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }
          ],
          responses: { 200: { description: 'Metrics for both cities with category winners' } }
        }
      },

      // ── USER ─────────────────────────────────────────────────────────────────

      '/api/user/profile': {
        get: {
          tags: ['User'], summary: 'Get current user profile',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'User profile without password hash' } }
        }
      },
      '/api/user/dashboard': {
        get: {
          tags: ['User'], summary: 'Personal dashboard: saved routes + live status + own reports',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Dashboard payload' } }
        }
      },
      '/api/user/push-subscription': {
        post: {
          tags: ['User'], summary: 'Save browser push subscription for alerts',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['subscription'], properties: { subscription: { type: 'object' } } } } } },
          responses: { 200: { description: 'Subscription saved' } }
        }
      },
      '/api/user/saved-routes': {
        put: {
          tags: ['User'], summary: 'Add or remove a saved route',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['gtfsRouteId', 'action'], properties: { gtfsRouteId: { type: 'string' }, action: { type: 'string', enum: ['add', 'remove'] } } } } } },
          responses: { 200: { description: 'Updated saved routes list' } }
        }
      },
      '/api/user/alert-prefs': {
        put: {
          tags: ['User'], summary: 'Subscribe or unsubscribe from route alerts',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['gtfsRouteId', 'action'], properties: { gtfsRouteId: { type: 'string' }, action: { type: 'string', enum: ['add', 'remove'] } } } } } },
          responses: { 200: { description: 'Updated alert prefs list' } }
        }
      },

      // ── ADMIN ─────────────────────────────────────────────────────────────────

      '/api/admin/cities': {
        get: {
          tags: ['Admin'], summary: 'List all cities',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Cities array' } }
        },
        post: {
          tags: ['Admin'], summary: 'Add a new city',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'slug', 'lat', 'lng'], properties: { name: { type: 'string' }, slug: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } } } } },
          responses: { 201: { description: 'City created' } }
        }
      },
      '/api/admin/modes': {
        post: {
          tags: ['Admin'], summary: 'Add a transport mode to a city',
          security: [{ bearerAuth: [] }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['cityId', 'type'], properties: { cityId: { type: 'string' }, type: { type: 'string' }, dataSourceUrl: { type: 'string' } } } } } },
          responses: { 201: { description: 'Mode created' } }
        }
      },
      '/api/admin/health': {
        get: {
          tags: ['Admin'], summary: 'System health check — DB, Redis, uptime',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Health status object' } }
        }
      }
    }
  },
  apis: [] // JSDoc scanning disabled — spec is defined inline above
};

module.exports = swaggerJsdoc(options);
