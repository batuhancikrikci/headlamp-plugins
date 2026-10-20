import React from 'react';
import {
  PrometheusEndpoint,
  PromMatrixSeries,
  promQuery,
  promQueryRange,
  PromVectorSample,
} from '../api/prometheus';
import { refreshMs, useSettings } from '../settings/settings';
import { useCurrentCluster } from './useCluster';
import { PrometheusState, usePrometheus } from './usePrometheus';

export interface PromResult<T> {
  prometheus: PrometheusState;
  data?: T;
  error?: string;
  loading: boolean;
}

function usePolled<T>(
  endpoint: PrometheusEndpoint | null,
  key: string,
  run: (endpoint: PrometheusEndpoint) => Promise<T>,
  intervalMs: number
): { data?: T; error?: string; loading: boolean } {
  const [state, setState] = React.useState<{
    key: string;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ key: '', loading: true });
  const runRef = React.useRef(run);
  runRef.current = run;
  const endpointKey = endpoint ? `${endpoint.kind}:${endpoint.base}:${endpoint.orgId || ''}` : '';

  React.useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const data = await runRef.current(endpoint);
        if (!cancelled) setState({ key, data, loading: false });
      } catch (err) {
        if (!cancelled) {
          setState(prev => ({
            key,
            data: prev.key === key ? prev.data : undefined,
            error: (err as Error)?.message || String(err),
            loading: false,
          }));
        }
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointKey, key, intervalMs]);

  if (!endpoint) return { loading: false };
  if (state.key !== key) return { loading: true };
  return state;
}

/** Runs several instant PromQL queries and polls them at the refresh interval. */
export function usePromInstant<K extends string>(
  queries: Record<K, string> | null,
  intervalMs?: number
): PromResult<Record<K, PromVectorSample[]>> {
  const prometheus = usePrometheus();
  const cluster = useCurrentCluster();
  const settings = useSettings();
  const ms = intervalMs ?? refreshMs(settings);
  const endpoint = prometheus.status === 'ready' && queries ? prometheus.endpoint : null;
  const key = `${cluster}|${JSON.stringify(queries)}`;
  const result = usePolled(
    endpoint,
    key,
    async ep => {
      const entries = Object.entries(queries || {}) as Array<[K, string]>;
      const values = await Promise.all(
        entries.map(([, q]) => promQuery(ep, q, cluster).catch(() => [] as PromVectorSample[]))
      );
      return Object.fromEntries(entries.map(([k], i) => [k, values[i]])) as Record<
        K,
        PromVectorSample[]
      >;
    },
    ms
  );
  return { prometheus, ...result };
}

/** Runs one range query over the last `rangeSeconds`. */
export function usePromRange(
  query: string | null,
  rangeSeconds: number,
  stepSeconds: number,
  intervalMs = 60000
): PromResult<PromMatrixSeries[]> {
  const prometheus = usePrometheus();
  const cluster = useCurrentCluster();
  const endpoint = prometheus.status === 'ready' && query ? prometheus.endpoint : null;
  const key = `${cluster}|${query}|${rangeSeconds}|${stepSeconds}`;
  const result = usePolled(
    endpoint,
    key,
    ep => promQueryRange(ep, query || '', cluster, rangeSeconds, stepSeconds),
    intervalMs
  );
  return { prometheus, ...result };
}
