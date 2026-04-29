import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import axios from 'axios'; // You'll need to run: npm install axios

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173" }
});

// 1. Storage for real-world nodes
let realBusStops: { lat: number, lon: number, name: string }[] = [];

// 2. Fetch real bus stops from OpenStreetMap (Kerala Region)
async function fetchKeralaBusStops() {
  console.log("🛰️  Fetching real transit nodes from OpenStreetMap...");
  const query = `
    [out:json][timeout:25];
    area["name"="Kerala"]->.searchArea;
    (
      node["highway"="bus_stop"](area.searchArea);
    );
    out body 200; // Let's grab 200 real stops to start
  `;
  
  try {
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const response = await axios.get(url);
    realBusStops = response.data.elements.map((el: any) => ({
      lat: el.lat,
      lon: el.lon,
      name: el.tags.name || "KSRTC Stop"
    }));
    console.log(`✅ Loaded ${realBusStops.length} real transit nodes.`);
  } catch (error) {
    console.error("❌ OSM Fetch Failed:", error);
  }
}

fetchKeralaBusStops();

// 3. Emit updates based on REAL nodes
setInterval(() => {
  if (realBusStops.length === 0) return;

  // Pick a random REAL bus stop from the OSM data
  const randomStop = realBusStops[Math.floor(Math.random() * realBusStops.length)];

  const busUpdate = {
    vehicleId: `KSRTC-${Math.floor(Math.random() * 9000) + 1000}`,
    lat: randomStop.lat,
    lon: randomStop.lon,
    stopName: randomStop.name,
    speed: Math.floor(Math.random() * 40) + 10
  };

  io.emit('transit_update', busUpdate);
}, 1500);

httpServer.listen(4000, () => {
  console.log(`🚀 Vazhi Intelligence Backend: Real-Node Mode Active`);
});