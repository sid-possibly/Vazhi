import type {
  AlertItem,
  AuthUser,
  City,
  JourneyPlan,
  LivePosition,
  StopArrival,
  TransitRouteFeature,
  TransitStopFeature,
  ValidationFieldError,
} from '../types/intelligence';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export class ApiError extends Error {
  status: number;
  fields: ValidationFieldError[];

  constructor(message: string, status: number, fields: ValidationFieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

const getJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      data.error || 'Request failed.',
      response.status,
      Array.isArray(data.errors) ? data.errors : []
    );
  }

  return data as T;
};

export const intelligenceApi = {
  baseUrl: API_BASE,

  async getCities() {
    const data = await getJson<{ cities: City[] }>('/api/transit/cities');
    return data.cities;
  },

  async getRoutes(cityId: string) {
    const data = await getJson<{ features: TransitRouteFeature[] }>(`/api/transit/${cityId}/routes`);
    return data.features;
  },

  async getStops(cityId: string) {
    const data = await getJson<{ features: TransitStopFeature[] }>(`/api/transit/${cityId}/stops`);
    return data.features;
  },

  async getAlerts(cityId: string) {
    const data = await getJson<{ alerts: AlertItem[] }>(`/api/alerts/${cityId}`);
    return data.alerts;
  },

  async getLivePositions(cityId: string) {
    const data = await getJson<{ positions: LivePosition[] }>(`/api/live/positions/${cityId}`);
    return data.positions;
  },

  async getArrivals(gtfsStopId: string) {
    const data = await getJson<{ arrivals: StopArrival[]; message?: string }>(
      `/api/transit/stops/${gtfsStopId}/arrivals`
    );
    return data;
  },

  async register(name: string, email: string, password: string) {
    return getJson<{ userId: string; name: string; email: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
  },

  async login(email: string, password: string) {
    return getJson<{ accessToken: string; refreshToken: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async getProfile(token: string) {
    return getJson<{
      userId: string;
      name: string;
      email: string;
      savedRoutes: string[];
      alertPrefs: string[];
    }>('/api/user/profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async getJourneyPlan(token: string, cityId: string, startStopId: string, endStopId: string) {
    return getJson<JourneyPlan>('/api/journey/plan', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ cityId, startStopId, endStopId }),
    });
  },
};
