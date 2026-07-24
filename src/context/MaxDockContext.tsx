import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentRole, listActiveLocations, type LocationDirectoryItem } from '../lib/maxdockService';
import { useAuth } from './AuthContext';

type MaxDockContextValue = {
  locations: LocationDirectoryItem[];
  selectedLocation: LocationDirectoryItem | null;
  setSelectedLocationId: (locationId: string) => void;
  role: string | null;
  loading: boolean;
  error: string | null;
};

const MaxDockContext = createContext<MaxDockContextValue | undefined>(undefined);
const LOCATION_STORAGE_KEY = 'maxdock-v2-selected-location';

const demoLocation: LocationDirectoryItem = {
  id: 'demo-mississauga',
  code: 'MISS',
  name: 'Mississauga',
  timezone: 'America/Toronto',
  is_active: true,
};

export function MaxDockProvider({ children }: { children: React.ReactNode }) {
  const { user, configured } = useAuth();
  const [locations, setLocations] = useState<LocationDirectoryItem[]>(configured ? [] : [demoLocation]);
  const [selectedLocationId, setSelectedLocationIdState] = useState(() => localStorage.getItem(LOCATION_STORAGE_KEY));
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setLocations([demoLocation]);
      setSelectedLocationIdState(demoLocation.id);
      setLoading(false);
      return;
    }

    if (!user) {
      setLocations([]);
      setRole(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([listActiveLocations(), getCurrentRole()])
      .then(([nextLocations, nextRole]) => {
        if (!active) return;
        setLocations(nextLocations);
        setRole(nextRole);
        setSelectedLocationIdState((current) => {
          if (current && nextLocations.some((location) => location.id === current)) return current;
          return nextLocations[0]?.id ?? null;
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Unable to load MaxDock access information.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [configured, user]);

  useEffect(() => {
    if (selectedLocationId) localStorage.setItem(LOCATION_STORAGE_KEY, selectedLocationId);
  }, [selectedLocationId]);

  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0] ?? null;

  const value = useMemo<MaxDockContextValue>(
    () => ({
      locations,
      selectedLocation,
      setSelectedLocationId: setSelectedLocationIdState,
      role,
      loading,
      error,
    }),
    [error, loading, locations, role, selectedLocation],
  );

  return <MaxDockContext.Provider value={value}>{children}</MaxDockContext.Provider>;
}

export function useMaxDock() {
  const context = useContext(MaxDockContext);
  if (!context) throw new Error('useMaxDock must be used inside MaxDockProvider');
  return context;
}
