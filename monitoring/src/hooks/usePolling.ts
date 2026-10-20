import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingResult<T> {
  data: T | undefined;
  error: unknown;
  /** True only until the first response (success or error). */
  loading: boolean;
  /** True while any request is in flight (including background refreshes). */
  refreshing: boolean;
  lastUpdated: Date | null;
  refresh: () => void;
}

/**
 * Runs `fetcher` whenever `deps` change and optionally every `intervalMs`.
 * Responses from superseded requests are dropped (no stale overwrite, no
 * setState after unmount). Previous data is kept while refreshing.
 */
export function usePolling<T>(
  fetcher: (() => Promise<T>) | null,
  deps: React.DependencyList,
  intervalMs = 0
): PollingResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(!!fetcher);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const fn = fetcherRef.current;
    if (!fn) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setRefreshing(true);
    try {
      const result = await fn();
      if (!mounted.current || id !== requestId.current) return;
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return;
      setError(err);
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Reset when the inputs change so we never show data for other inputs.
  useEffect(() => {
    setData(undefined);
    setError(null);
    setLoading(!!fetcherRef.current);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0 || !fetcherRef.current) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') run();
    }, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, run, ...deps]);

  return { data, error, loading, refreshing, lastUpdated, refresh: run };
}
