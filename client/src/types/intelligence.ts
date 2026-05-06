export interface City {
  city_id: string;
  name: string;
  slug: string;
  current_status: string;
  lat: number;
  lng: number;
  modes?: Array<{
    modeId: string;
    type: string;
    isEnabled: boolean;
    dataSourceUrl: string | null;
  }>;
}

export interface TransitRouteFeature {
  type: 'Feature';
  properties: {
    routeId: string;
    gtfsId: string;
    shortName: string;
    color: string;
    mode: string;
  };
}

export interface TransitStopFeature {
  type: 'Feature';
  properties: {
    stopId: string;
    gtfsId: string;
    name: string;
    mode: string;
  };
}

export interface AlertItem {
  alertId: string;
  routeId: string;
  routeName: string;
  routeColor: string;
  tripId: string;
  severity: 'minor' | 'major' | 'critical';
  message: string;
  delayMinutes: number;
  createdAt: string;
  expiresAt: string;
}

export interface LivePosition {
  cityId?: string;
  tripId: string;
  routeId: string;
  routeColor: string;
  lat: number;
  lng: number;
  delayMinutes: number;
  interpolated: boolean;
  lastUpdate: string;
}

export interface JourneyLeg {
  type: 'transit' | 'walking';
  mode?: string;
  routeId?: string;
  routeName?: string;
  durationMinutes: number;
  from: {
    gtfsId: string;
    name: string;
  };
  to: {
    gtfsId: string;
    name: string;
  };
}

export interface JourneyPlan {
  origin: string;
  destination: string;
  sessionId?: string | null;
  totalTravelTimeMinutes: string;
  transfers: number;
  totalFare?: {
    amount: number;
    currencyType: string;
    isEstimate: boolean;
  } | null;
  legs: JourneyLeg[];
}

export interface AuthUser {
  userId: string;
  name: string;
  email: string;
}

export interface ValidationFieldError {
  field: string;
  message: string;
}

export interface StopArrival {
  tripId: string;
  routeId: string;
  routeName: string;
  routeColor: string;
  mode: string;
  arrivalTime: string;
  departureTime: string;
  minutesAway: number;
}
