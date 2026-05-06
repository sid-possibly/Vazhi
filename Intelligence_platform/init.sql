
-- ==========================================
-- 1. EXTENSIONS
-- ==========================================
-- Enable PostGIS geospatial capabilities
CREATE EXTENSION IF NOT EXISTS postgis;
-- Enable fuzzy string matching for stop search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==========================================
-- 2. ENUMS (Safe Creation)
-- ==========================================
DO $$ BEGIN
    CREATE TYPE city_status AS ENUM ('Operational', 'Delayed', 'Disrupted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE alert_severity AS ENUM ('minor', 'major', 'critical');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE report_category AS ENUM ('Overcrowded', 'Infrastructure', 'Missed', 'Unsafe');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ==========================================
-- 3. TABLES
-- ==========================================

-- City Master Table
CREATE TABLE IF NOT EXISTS cities (
    city_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    center_coords GEOMETRY(POINT, 4326) NOT NULL,
    current_status city_status DEFAULT 'Operational'
);

-- Transport Mode Configuration
CREATE TABLE IF NOT EXISTS transport_modes (
    mode_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID REFERENCES cities(city_id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- Metro, Bus, Water, Rail
    data_source_url TEXT,
    is_enabled BOOLEAN DEFAULT true
);

-- Transit Routes
CREATE TABLE IF NOT EXISTS routes (
    route_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode_id UUID REFERENCES transport_modes(mode_id) ON DELETE CASCADE,
    gtfs_route_id VARCHAR(100) UNIQUE NOT NULL,
    route_short_name VARCHAR(50),
    route_color VARCHAR(7) DEFAULT '#000000',
    route_shape GEOMETRY(LINESTRING, 4326)
);

-- Transit Stops
CREATE TABLE IF NOT EXISTS stops (
    stop_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID REFERENCES cities(city_id) ON DELETE CASCADE,
    gtfs_stop_id VARCHAR(100) UNIQUE NOT NULL,
    stop_name VARCHAR(255) NOT NULL,
    geom GEOMETRY(POINT, 4326) NOT NULL
);

-- Transit Schedules
CREATE TABLE IF NOT EXISTS schedules (
    schedule_id BIGSERIAL PRIMARY KEY,
    stop_id UUID REFERENCES stops(stop_id) ON DELETE CASCADE,
    route_id UUID REFERENCES routes(route_id) ON DELETE CASCADE,
    trip_id VARCHAR(100) NOT NULL,
    arrival_time TIME NOT NULL,
    departure_time TIME NOT NULL,
    stop_sequence INTEGER NOT NULL
);

-- Service Alerts
CREATE TABLE IF NOT EXISTS alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id UUID REFERENCES cities(city_id),
    route_id UUID REFERENCES routes(route_id),
    trip_id VARCHAR(100),
    severity alert_severity NOT NULL,
    message TEXT NOT NULL,
    delay_minutes INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Citizen-Submitted Reports
CREATE TABLE IF NOT EXISTS citizen_reports (
    report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id_ref VARCHAR(255) NOT NULL, -- Reference to MongoDB UserID
    category report_category NOT NULL,
    description TEXT,
    location GEOMETRY(POINT, 4326) NOT NULL,
    upvotes INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Route Analytics Snapshots
CREATE TABLE IF NOT EXISTS route_analytics (
    id SERIAL PRIMARY KEY,
    route_id UUID REFERENCES routes(route_id),
    city_id UUID REFERENCES cities(city_id),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    active_trips INTEGER,
    avg_delay_mins NUMERIC(5,2),
    on_time_pct NUMERIC(5,2),
    delayed_trips INTEGER,
    total_trips INTEGER
);

-- GTFS Feed Metadata
CREATE TABLE IF NOT EXISTS gtfs_feed_metadata (
    id SERIAL PRIMARY KEY,
    city_id UUID REFERENCES cities(city_id),
    mode_id UUID REFERENCES transport_modes(mode_id),
    last_ingested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    feed_version VARCHAR(50),
    routes_count INTEGER,
    stops_count INTEGER,
    schedules_count INTEGER,
    UNIQUE(city_id, mode_id)
);

-- Graph Edges 
CREATE TABLE IF NOT EXISTS edges (
    edge_id SERIAL PRIMARY KEY,
    from_stop_id VARCHAR(100) NOT NULL,
    to_stop_id VARCHAR(100) NOT NULL,
    travel_time NUMERIC(10,2) NOT NULL,
    edge_type VARCHAR(20) NOT NULL, -- travel, transfer
    metadata JSONB -- stores mode/route info
);

-- Active Journey Sessions
CREATE TABLE IF NOT EXISTS journey_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255),
    socket_id VARCHAR(255),
    route_ids VARCHAR(100)[] NOT NULL,
    start_stop_id VARCHAR(100) NOT NULL,
    end_stop_id VARCHAR(100) NOT NULL,
    city_id UUID REFERENCES cities(city_id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- ==========================================
-- 4. INDEXES (Crucial for Map Performance)
-- ==========================================
-- Spatial indexes for fast bounding-box queries on the map
CREATE INDEX IF NOT EXISTS idx_cities_coords ON cities USING GIST (center_coords);
CREATE INDEX IF NOT EXISTS idx_routes_shape ON routes USING GIST (route_shape);
CREATE INDEX IF NOT EXISTS idx_stops_geom ON stops USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_reports_loc ON citizen_reports USING GIST (location);

-- Trigram index for fuzzy searching stop names
CREATE INDEX IF NOT EXISTS idx_stops_name_trgm ON stops USING GIN (stop_name gin_trgm_ops);

-- ==========================================
-- 5. INITIAL SEED DATA
-- ==========================================
-- Insert a default city to test map rendering
INSERT INTO cities (name, slug, center_coords, current_status)
VALUES ('Kochi', 'kochi', ST_SetSRID(ST_MakePoint(76.2673, 9.9312), 4326), 'Operational')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO transport_modes (city_id, type, is_enabled)
SELECT c.city_id, mode_config.type, true
FROM cities c
CROSS JOIN (
    VALUES ('Metro'), ('Bus'), ('Water')
) AS mode_config(type)
WHERE c.slug = 'kochi'
  AND NOT EXISTS (
    SELECT 1
    FROM transport_modes tm
    WHERE tm.city_id = c.city_id
      AND tm.type = mode_config.type
  );
