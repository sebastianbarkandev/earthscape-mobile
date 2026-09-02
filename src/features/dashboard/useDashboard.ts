import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getDashboard, type DashboardPayload } from './api';
import { normalizeDashboard } from './dashboardModel';

/** Re-read on tab focus once the data is this old — the web page reloads on every visit. */
export const DASHBOARD_STALE_MS = 60_000;

export type DashboardStatus = 'loading' | 'ready' | 'error';

/**
 * Screen-local dashboard state (no Redux slice: nothing else reads it, and CLAUDE.md keeps
 * the store slim). First load shows the spinner; later loads keep the last payload on
 * screen and surface a failure as a banner, never a blank page (UI-005).
 */
export function useDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [status, setStatus] = useState<DashboardStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadedAt = useRef(0);
  const reqId = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent') => {
    const id = ++reqId.current;
    if (mode === 'initial') setStatus('loading');
    if (mode === 'refresh') setRefreshing(true);
    try {
      const payload = normalizeDashboard(await getDashboard());
      if (!mounted.current || id !== reqId.current) return;
      loadedAt.current = Date.now();
      setData(payload);
      setError(null);
      setStatus('ready');
    } catch (e) {
      if (!mounted.current || id !== reqId.current) return;
      setError(e instanceof Error ? e.message : 'Could not load the dashboard');
      // Keep showing stale data if we have any; only the very first failure is a full-screen error.
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'));
    } finally {
      if (mounted.current && id === reqId.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load('initial');
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (loadedAt.current && Date.now() - loadedAt.current > DASHBOARD_STALE_MS) void load('silent');
    }, [load]),
  );

  const refresh = useCallback(() => load('refresh'), [load]);
  const retry = useCallback(() => load(data ? 'refresh' : 'initial'), [load, data]);

  return { data, status, error, refreshing, refresh, retry };
}
