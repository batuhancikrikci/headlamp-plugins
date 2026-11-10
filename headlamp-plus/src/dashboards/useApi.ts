/**
 * Reads of the dashboards through Headlamp's API proxy, refreshed on an interval. They work on
 * plain Kubernetes JSON, so the pure helpers next to each dashboard can be tested without
 * Headlamp's resource classes.
 */
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';

export interface ApiState<T> {
  /** Undefined while loading; null when the read failed. */
  data: T | undefined | null;
  error?: unknown;
}

export function errorStatus(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** GET of a path (none when it is null), repeated every `refreshMs`. */
export function useApiGet<T>(path: string | null, refreshMs = 30_000): ApiState<T> {
  const cluster = K8s.useCluster() || '';
  const [state, setState] = React.useState<ApiState<T>>({ data: undefined });
  React.useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState({ data: undefined });
    const load = () =>
      ApiProxy.request(path, cluster ? { cluster } : {})
        .then((data: T) => !cancelled && setState({ data }))
        .catch((error: unknown) => !cancelled && setState({ data: null, error }));
    load();
    const timer = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [path, cluster, refreshMs]);
  return state;
}

/** The items of a list path. */
export function useApiList<T>(path: string | null, refreshMs = 30_000): ApiState<T[]> {
  const state = useApiGet<{ items?: T[] }>(path, refreshMs);
  return React.useMemo(
    () => ({
      data: state.data === undefined || state.data === null ? state.data : state.data.items ?? [],
      error: state.error,
    }),
    [state]
  );
}

/** Labels of the lists still loading and of the lists the user may not read. */
export function listStatus(lists: Array<[string, ApiState<unknown>]>) {
  return {
    pending: lists.filter(([, s]) => s.data === undefined).map(([label]) => label),
    forbidden: lists.filter(([, s]) => errorStatus(s.error) === 403).map(([label]) => label),
    failed: lists
      .filter(([, s]) => s.data === null && errorStatus(s.error) !== 403)
      .map(([label]) => label),
  };
}
