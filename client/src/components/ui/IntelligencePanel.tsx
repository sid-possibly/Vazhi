import { useEffect, useMemo, useState } from 'react';
import { ApiError, intelligenceApi } from '../../services/intelligenceApi';
import type {
  AlertItem,
  City,
  JourneyPlan,
  LivePosition,
  StopArrival,
  TransitRouteFeature,
  TransitStopFeature,
  ValidationFieldError,
} from '../../types/intelligence';

type AuthMode = 'login' | 'register';

interface IntelligencePanelProps {
  districtName: string | null;
}

const KOCHI_DISTRICT = 'Ernakulam';
const ACCESS_TOKEN_KEY = 'vazhi_access_token';
const REFRESH_TOKEN_KEY = 'vazhi_refresh_token';
const DEFAULT_CITY_SLUG = 'kochi';

const emptyArrivals = { arrivals: [] as StopArrival[], message: '' };

export default function IntelligencePanel({ districtName }: IntelligencePanelProps) {
  const [cities, setCities] = useState<City[]>([]);
  const [selectedCityId, setSelectedCityId] = useState('');
  const [routes, setRoutes] = useState<TransitRouteFeature[]>([]);
  const [stops, setStops] = useState<TransitStopFeature[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [journey, setJourney] = useState<JourneyPlan | null>(null);
  const [profileName, setProfileName] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [startStopId, setStartStopId] = useState('');
  const [endStopId, setEndStopId] = useState('');
  const [startArrivals, setStartArrivals] = useState(emptyArrivals);
  const [endArrivals, setEndArrivals] = useState(emptyArrivals);
  const [status, setStatus] = useState('Loading backend data...');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isDataBusy, setIsDataBusy] = useState(false);
  const [isJourneyBusy, setIsJourneyBusy] = useState(false);

  const selectedCity = useMemo(
    () => cities.find((city) => city.city_id === selectedCityId) || null,
    [cities, selectedCityId]
  );

  const selectedStartStop = useMemo(
    () => stops.find((stop) => stop.properties.gtfsId === startStopId) || null,
    [startStopId, stops]
  );
  const selectedEndStop = useMemo(
    () => stops.find((stop) => stop.properties.gtfsId === endStopId) || null,
    [endStopId, stops]
  );

  const isAuthenticated = Boolean(profileName);
  const kochiCity = useMemo(
    () => cities.find((city) => city.slug === DEFAULT_CITY_SLUG) || null,
    [cities]
  );
  const shouldOfferKochiData = Boolean(kochiCity) && (!districtName || districtName === KOCHI_DISTRICT);

  const filteredStartStops = useMemo(
    () => filterStops(stops, startQuery, startStopId),
    [stops, startQuery, startStopId]
  );
  const filteredEndStops = useMemo(
    () => filterStops(stops, endQuery, endStopId),
    [stops, endQuery, endStopId]
  );

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const nextCities = await intelligenceApi.getCities();
        setCities(nextCities);

        const initialCity = nextCities.find((city) => city.slug === DEFAULT_CITY_SLUG) || nextCities[0];
        if (!initialCity) {
          setStatus('No cities found in backend.');
          return;
        }

        setSelectedCityId(initialCity.city_id);
        setStatus('Backend connected. Kochi data will preload for Ernakulam.');
      } catch (err) {
        setError(getErrorMessage(err));
      }
    };

    bootstrap();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY) || '';
    if (!token) return;

    intelligenceApi
      .getProfile(token)
      .then((profile) => setProfileName(profile.name))
      .catch(() => {
        clearStoredTokens();
        setProfileName('');
      });
  }, []);

  useEffect(() => {
    if (!selectedCityId || !kochiCity || !shouldOfferKochiData) return;

    void loadCityData(selectedCityId);
  }, [kochiCity, selectedCityId, shouldOfferKochiData]);

  useEffect(() => {
    if (districtName === KOCHI_DISTRICT && selectedCityId) {
      void loadCityData(selectedCityId, true);
    } else if (districtName && districtName !== KOCHI_DISTRICT) {
      setStatus('Only Kochi transit data is available now. Click Ernakulam to refresh Kochi features.');
    }
  }, [districtName, selectedCityId]);

  useEffect(() => {
    if (!selectedStartStop) {
      setStartArrivals(emptyArrivals);
      return;
    }

    void loadArrivals(selectedStartStop.properties.gtfsId, setStartArrivals);
  }, [selectedStartStop]);

  useEffect(() => {
    if (!selectedEndStop) {
      setEndArrivals(emptyArrivals);
      return;
    }

    void loadArrivals(selectedEndStop.properties.gtfsId, setEndArrivals);
  }, [selectedEndStop]);

  const loadCityData = async (cityId: string, forceRefresh = false) => {
    if (!forceRefresh && isDataBusy) return;

    setIsDataBusy(true);
    setError('');
    setStatus('Loading Kochi routes, stops, alerts, and live positions...');

    try {
      const [nextRoutes, nextStops, nextAlerts, nextPositions] = await Promise.all([
        intelligenceApi.getRoutes(cityId),
        intelligenceApi.getStops(cityId),
        intelligenceApi.getAlerts(cityId),
        intelligenceApi.getLivePositions(cityId),
      ]);

      setRoutes(nextRoutes);
      setStops(nextStops);
      setAlerts(nextAlerts);
      setPositions(nextPositions);

      const startDefault = nextStops[0]?.properties.gtfsId || '';
      const endDefault = nextStops[1]?.properties.gtfsId || nextStops[0]?.properties.gtfsId || '';

      setStartStopId((current) => (current && nextStops.some((stop) => stop.properties.gtfsId === current) ? current : startDefault));
      setEndStopId((current) => (current && nextStops.some((stop) => stop.properties.gtfsId === current) ? current : endDefault));
      setStartQuery('');
      setEndQuery('');
      setStatus(`Loaded Kochi data: ${nextRoutes.length} routes, ${nextStops.length} stops, ${nextAlerts.length} alerts, ${nextPositions.length} live vehicles.`);
    } catch (err) {
      setError(getErrorMessage(err));
      setStatus('Backend connected, but Kochi transit data failed to load.');
    } finally {
      setIsDataBusy(false);
    }
  };

  useEffect(() => {
    if (!selectedCityId || !shouldOfferKochiData) return;

    const interval = window.setInterval(async () => {
      try {
        const [nextAlerts, nextPositions] = await Promise.all([
          intelligenceApi.getAlerts(selectedCityId),
          intelligenceApi.getLivePositions(selectedCityId),
        ]);

        setAlerts(nextAlerts);
        setPositions(nextPositions);
      } catch {
        // Keep current data on transient failures.
      }
    }, 20000);

    return () => window.clearInterval(interval);
  }, [selectedCityId, shouldOfferKochiData]);

  const loadArrivals = async (
    gtfsStopId: string,
    setter: (value: { arrivals: StopArrival[]; message: string }) => void
  ) => {
    try {
      const result = await intelligenceApi.getArrivals(gtfsStopId);
      setter({ arrivals: result.arrivals, message: result.message || '' });
    } catch {
      setter({ arrivals: [], message: 'Failed to load arrivals.' });
    }
  };

  const handleRegister = async () => {
    setIsAuthBusy(true);
    setError('');
    setFieldErrors({});

    try {
      await intelligenceApi.register(name, email, password);
      setAuthMode('login');
      setPassword('');
      setStatus('Account created. Please log in with the new credentials.');
    } catch (err) {
      handleApiError(err);
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogin = async () => {
    setIsAuthBusy(true);
    setError('');
    setFieldErrors({});

    try {
      const loginResult = await intelligenceApi.login(email, password);
      localStorage.setItem(ACCESS_TOKEN_KEY, loginResult.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, loginResult.refreshToken);
      setProfileName(loginResult.user.name);
      setStatus(`Authenticated as ${loginResult.user.name}. Journey planner unlocked.`);
    } catch (err) {
      clearStoredTokens();
      handleApiError(err);
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleJourneyPlan = async () => {
    const token = localStorage.getItem(ACCESS_TOKEN_KEY) || '';

    if (!token) {
      setError('Login first to use journey planning.');
      return;
    }

    if (!selectedCityId || !startStopId || !endStopId) {
      setError('Choose both start and end stops first.');
      return;
    }

    setIsJourneyBusy(true);
    setError('');

    try {
      const result = await intelligenceApi.getJourneyPlan(token, selectedCityId, startStopId, endStopId);
      setJourney(result);
      setStatus('Journey plan fetched from backend.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearStoredTokens();
        setProfileName('');
      }
      handleApiError(err);
    } finally {
      setIsJourneyBusy(false);
    }
  };

  const handleApiError = (err: unknown) => {
    const message = getErrorMessage(err);
    const errors = err instanceof ApiError ? err.fields : [];
    setError(message);
    setFieldErrors(mapFieldErrors(errors));
  };

  return (
    <aside className="absolute right-4 top-4 z-20 w-[380px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-teal-500/30 bg-slate-950/80 p-4 text-white shadow-[0_0_40px_rgba(13,148,136,0.2)] backdrop-blur-xl">
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.35em] text-teal-300/70">Frontend x Backend</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight">Integration Panel</h2>
        <p className="mt-2 text-sm text-slate-300">{status}</p>
        {districtName && districtName !== KOCHI_DISTRICT && (
          <p className="mt-2 text-xs text-amber-300">You clicked {districtName}. Only Kochi transit data is available right now, mapped to Ernakulam.</p>
        )}
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      </div>

      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Backend</p>
        <p className="mt-2 text-sm text-slate-200">{intelligenceApi.baseUrl}</p>
        <p className="mt-2 text-sm text-slate-400">
          City: <span className="text-white">{selectedCity?.name || 'Not selected'}</span>
        </p>
        <p className="text-sm text-slate-400">
          Modes: <span className="text-white">{selectedCity?.modes?.map((mode) => mode.type).join(', ') || 'Not loaded'}</span>
        </p>
        <p className="text-sm text-slate-400">
          Routes {routes.length} | Stops {stops.length} | Alerts {alerts.length} | Live {positions.length}
        </p>
      </section>

      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <div className="flex gap-2 text-xs">
          <button
            className={`rounded px-3 py-1 ${authMode === 'login' ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
            onClick={() => {
              setAuthMode('login');
              setFieldErrors({});
              setError('');
            }}
            type="button"
          >
            Login
          </button>
          <button
            className={`rounded px-3 py-1 ${authMode === 'register' ? 'bg-teal-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
            onClick={() => {
              setAuthMode('register');
              setFieldErrors({});
              setError('');
            }}
            type="button"
          >
            Register
          </button>
        </div>

        {authMode === 'register' && (
          <>
            <input
              className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              value={name}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-rose-300">{fieldErrors.name}</p>}
          </>
        )}

        <input
          className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          value={email}
        />
        {fieldErrors.email && <p className="mt-1 text-xs text-rose-300">{fieldErrors.email}</p>}

        <input
          className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        {fieldErrors.password && <p className="mt-1 text-xs text-rose-300">{fieldErrors.password}</p>}

        <button
          className="mt-3 w-full rounded bg-teal-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          disabled={isAuthBusy}
          onClick={authMode === 'login' ? handleLogin : handleRegister}
          type="button"
        >
          {authMode === 'login' ? 'Login' : 'Create Account'}
        </button>
        <p className="mt-2 text-xs text-slate-400">
          User: <span className="text-white">{profileName || 'Guest'}</span>
        </p>
      </section>

      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Journey</p>
        <StopSelector
          label="Start stop"
          query={startQuery}
          selectedStopId={startStopId}
          stops={filteredStartStops}
          onQueryChange={setStartQuery}
          onSelect={setStartStopId}
        />
        {selectedStartStop && (
          <ArrivalsList title="Start arrivals" arrivals={startArrivals.arrivals} message={startArrivals.message} />
        )}

        <StopSelector
          label="End stop"
          query={endQuery}
          selectedStopId={endStopId}
          stops={filteredEndStops}
          onQueryChange={setEndQuery}
          onSelect={setEndStopId}
        />
        {selectedEndStop && (
          <ArrivalsList title="End arrivals" arrivals={endArrivals.arrivals} message={endArrivals.message} />
        )}

        <button
          className="mt-3 w-full rounded bg-blue-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={isJourneyBusy || !isAuthenticated}
          onClick={handleJourneyPlan}
          type="button"
        >
          {isAuthenticated ? 'Fetch Journey Plan' : 'Login To Plan Journey'}
        </button>

        {journey && (
          <div className="mt-3 text-sm text-slate-300">
            <p>Total {journey.totalTravelTimeMinutes} min</p>
            <p>Transfers {journey.transfers}</p>
            <div className="mt-2 space-y-2">
              {journey.legs.slice(0, 4).map((leg, index) => (
                <div key={`${leg.type}-${index}`} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                  <p className="text-white">{leg.type === 'walking' ? 'Walk' : `${leg.mode} ${leg.routeName || leg.routeId}`}</p>
                  <p className="text-xs text-slate-400">{leg.from.name} to {leg.to.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Route Snapshot</p>
        {routes.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {routes.slice(0, 8).map((route) => (
              <span key={route.properties.gtfsId} className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-200">
                {route.properties.shortName || route.properties.gtfsId} · {route.properties.mode}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">{isDataBusy ? 'Loading routes...' : 'No routes loaded.'}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Live Feed</p>
        <div className="mt-3 space-y-2">
          {alerts.length > 0 ? alerts.slice(0, 3).map((alert) => <AlertRow key={alert.alertId} alert={alert} />) : (
            <p className="text-sm text-slate-400">{isDataBusy ? 'Loading alerts...' : 'No active alerts right now.'}</p>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {positions.length > 0 ? positions.slice(0, 3).map((position) => (
            <div key={`${position.routeId}-${position.tripId}`} className="rounded border border-slate-800 bg-slate-950/60 p-2">
              <p className="text-sm font-semibold text-white">{position.routeId}</p>
              <p className="text-xs text-slate-400">
                {position.lat.toFixed(4)}, {position.lng.toFixed(4)} · delay {position.delayMinutes} min
              </p>
            </div>
          )) : (
            <p className="text-sm text-slate-400">{isDataBusy ? 'Loading live positions...' : 'No live vehicles right now.'}</p>
          )}
        </div>
      </section>
    </aside>
  );
}

function StopSelector({
  label,
  query,
  selectedStopId,
  stops,
  onQueryChange,
  onSelect,
}: {
  label: string;
  query: string;
  selectedStopId: string;
  stops: TransitStopFeature[];
  onQueryChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="mt-3">
      <input
        className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none"
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={`Search ${label.toLowerCase()}`}
        value={query}
      />
      <select
        className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        onChange={(e) => onSelect(e.target.value)}
        value={selectedStopId}
      >
        <option value="">{label}</option>
        {stops.map((stop) => (
          <option key={`${label}-${stop.properties.gtfsId}`} value={stop.properties.gtfsId}>
            {stop.properties.name} · {stop.properties.mode}
          </option>
        ))}
      </select>
    </div>
  );
}

function ArrivalsList({
  title,
  arrivals,
  message,
}: {
  title: string;
  arrivals: StopArrival[];
  message: string;
}) {
  return (
    <div className="mt-2 rounded border border-slate-800 bg-slate-950/60 p-2">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{title}</p>
      {arrivals.length > 0 ? (
        <div className="mt-2 space-y-1">
          {arrivals.slice(0, 3).map((arrival) => (
            <p key={`${arrival.tripId}-${arrival.arrivalTime}`} className="text-xs text-slate-300">
              {arrival.routeName || arrival.routeId} in {arrival.minutesAway} min
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">{message || 'No arrivals available.'}</p>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: AlertItem }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
      <p className="text-sm font-semibold text-white">{alert.routeName || alert.routeId}</p>
      <p className="text-xs uppercase tracking-[0.25em] text-teal-300">{alert.severity}</p>
      <p className="mt-1 text-xs text-slate-400">{alert.message}</p>
    </div>
  );
}

function filterStops(stops: TransitStopFeature[], query: string, selectedStopId: string) {
  const trimmed = query.trim().toLowerCase();
  let nextStops = trimmed
    ? stops.filter((stop) => stop.properties.name.toLowerCase().includes(trimmed))
    : stops.slice(0, 40);

  if (selectedStopId && !nextStops.some((stop) => stop.properties.gtfsId === selectedStopId)) {
    const selected = stops.find((stop) => stop.properties.gtfsId === selectedStopId);
    if (selected) nextStops = [selected, ...nextStops];
  }

  return nextStops.slice(0, 40);
}

function mapFieldErrors(errors: ValidationFieldError[]) {
  return errors.reduce<Record<string, string>>((acc, error) => {
    acc[error.field] = error.message;
    return acc;
  }, {});
}

function getErrorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Request failed.';
}

function clearStoredTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
