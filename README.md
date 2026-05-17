# Vazhi (വഴി) 🗺️  
## Real-Time Transit Intelligence Platform for Kerala

Vazhi is a smart mobility and transit intelligence platform designed for Kerala.  
The system integrates public transit visualization, journey planning, real-time transport monitoring, civic reporting, and geospatial analytics into a unified platform.

The project combines:
- real-time transit intelligence,
- GIS-powered spatial analysis,
- scalable backend architecture,
- and interactive 3D visualization

to create a modern public mobility ecosystem.

---

# ✨ Core Features

## 🚆 Multi-Modal Transit Intelligence
- Metro, Bus, Water Metro integration
- Dynamic city-based transport configurations
- GTFS-powered transit data processing

## 🗺️ Interactive Smart Maps
- 3D Kerala visualization using React Three Fiber
- GIS-enabled transit route rendering
- Route and stop visualization
- Real-time map updates

## 🧠 Intelligent Journey Planning
- Dijkstra-based shortest path routing
- Transfer-aware route optimization
- Disruption-aware recalculation

## 📡 Real-Time Infrastructure
- GTFS-RT polling services
- WebSocket-based live updates
- Redis-powered transient caching
- Schedule interpolation fallback support

## 🚨 Alert & Civic Reporting System
- Real-time disruption alerts
- Citizen incident reporting with map pin drops
- WebSocket broadcast of community reports
- Auto-expiring reports using cron jobs

## 🌍 Smart City Overlays
- AQI overlays
- Weather overlays
- Traffic congestion visualization

---

# 🏗️ System Architecture

Vazhi follows a modular multi-layer architecture:

## Presentation Layer
- React + TypeScript frontend
- React Three Fiber 3D rendering
- Leaflet.js GIS visualization
- Recharts analytics dashboards

## Business Logic Layer
- Express.js REST APIs
- Socket.io WebSocket server
- GTFS ingestion services
- node-cron background workers

## Data Layer
### PostgreSQL + PostGIS
Stores:
- routes
- stops
- schedules
- alerts
- analytics
- geospatial data

### MongoDB
Stores:
- users
- refresh tokens
- personalization data

### Redis
Handles:
- live vehicle cache
- transient real-time data
- Socket.io pub/sub communication

---

# 🛠️ Tech Stack

## Frontend
- React
- Vite
- TypeScript
- Tailwind CSS
- React Three Fiber
- Leaflet.js
- Recharts
- Socket.io Client

## Backend
- Node.js
- Express.js
- Socket.io
- node-cron
- JWT Authentication

## Databases
- PostgreSQL + PostGIS
- MongoDB Atlas
- Redis

## APIs & External Services
- GTFS / GTFS-RT
- OpenAQ API
- OpenWeatherMap API
- TomTom Traffic API

----

# 📂 Repository Structure

```bash
Vazhi/
│
├── client/        # React + Vite frontend
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── maps/
│   └── animations/
│
├── server/        # Express backend
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   ├── cron/
│   ├── polling/
│   └── utils/
│
├── docs/          # Architecture diagrams & SRS
└── README.md
```
# ⚙️ Current Progress

## ✅ Completed
- PERN stack environment setup
- 3D animated Kerala map visualization
- GTFS static feed ingestion pipeline
- JWT authentication system
- Refresh token rotation
- Routes & Stops APIs
- Journey planner backend
- Redis caching layer
- WebSocket backend infrastructure
- Citizen reporting backend
- Swagger API documentation
- PostgreSQL + PostGIS integration

---

## 🚧 In Progress
- Frontend-backend synchronization
- Real-time GTFS-RT integration
- Analytics dashboard integration
- WebSocket frontend updates
- AQI/Weather overlay refinement

---

## 🔮 Planned Features
- Full Kerala-wide deployment
- AI-based delay prediction
- Native mobile application
- Predictive transit analytics
- Production-grade GTFS-RT feeds

---

# 🚀 Getting Started

## 1️⃣ Clone the Repository

```bash
git clone https://github.com/sid-possibly/Vazhi.git
cd Vazhi
```

---

# 💻 Client Setup

```bash
cd client
npm install
npm run dev
```

Frontend runs on:

```bash
http://localhost:5173
```

---

# 🖥️ Server Setup

```bash
cd server
npm install
npm run dev
```

Backend runs on:

```bash
http://localhost:5000
```

---

# 🔐 Environment Variables

Create a `.env` file inside `/server`:

```env
PORT=5000

MONGO_URI=your_mongodb_uri

DATABASE_URL=your_postgresql_url

REDIS_URL=your_redis_url

JWT_SECRET=your_jwt_secret

OPENWEATHER_API_KEY=your_api_key

TOMTOM_API_KEY=your_api_key
```

---

# 🧠 Key Engineering Concepts

- Dijkstra’s shortest path algorithm
- GTFS graph generation
- PostGIS geospatial querying
- Redis TTL caching
- WebSocket broadcasting
- Schedule interpolation fallback
- JWT refresh token rotation
- Real-time polling infrastructure

---

# 📊 Project Vision

Vazhi aims to evolve into a unified intelligent mobility ecosystem for Kerala by combining:

- real-time transit systems
- GIS analytics
- smart-city overlays
- citizen engagement

within one scalable platform.

---

# 👨‍💻 Team

- Tanmay Jayanthi
- Samridhi Singh
- Sidharth R Krishna
- Vani Sugovind S R

---

# 📜 License

This project is developed for academic and research purposes.
