import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import {
  applyVersions,
  Availability,
  CRDMeta,
  discoverAvailability,
  fetchAllCRDMeta,
  fetchCRDMeta,
  getCachedAvailability,
  invalidateAvailability,
} from '../api/discovery';

/** Name of the cluster the current view belongs to ('' when there is none). */
export function useCurrentCluster(): string {
  return K8s.useCluster() || getCluster() || '';
}

export type DiscoveryState =
  | { status: 'loading' }
  | { status: 'error'; error: string; forbidden: boolean; retry: () => void }
  | { status: 'ready'; availability: Availability; refresh: () => void };

/** Discovers (and applies) the Cilium API versions of the current cluster. */
export function useCiliumDiscovery(): DiscoveryState {
  const cluster = useCurrentCluster();
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt(a => a + 1), []);
  const refresh = React.useCallback(() => {
    invalidateAvailability(cluster);
    setAttempt(a => a + 1);
  }, [cluster]);

  const [state, setState] = React.useState<DiscoveryState>(() => {
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      return { status: 'ready', availability: cached, refresh };
    }
    return { status: 'loading' };
  });

  React.useEffect(() => {
    let cancelled = false;
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      setState({ status: 'ready', availability: cached, refresh });
      return;
    }
    setState({ status: 'loading' });
    discoverAvailability(cluster)
      .then(availability => {
        if (cancelled) return;
        applyVersions(availability);
        setState({ status: 'ready', availability, refresh });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        setState({
          status: 'error',
          error: (err as Error)?.message || String(err),
          forbidden: status === 403 || status === 401,
          retry,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, attempt, retry, refresh]);

  return state;
}

export type CRDMetaState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; meta: Record<string, CRDMeta> };

/**
 * Deprecation and storage-version details from the CRD objects. Reading CRDs is often not
 * permitted; the state is then `unavailable` and callers fall back to the static registry.
 */
export function useCRDMeta(availability: Availability | undefined): CRDMetaState {
  const cluster = useCurrentCluster();
  const [state, setState] = React.useState<CRDMetaState>({ status: 'loading' });
  const plurals = React.useMemo(
    () => (availability ? Object.keys(availability.resources).sort() : []),
    [availability]
  );
  const key = plurals.join(',');

  React.useEffect(() => {
    if (plurals.length === 0) {
      setState(availability ? { status: 'ready', meta: {} } : { status: 'loading' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    fetchAllCRDMeta(cluster, plurals)
      .then(meta => !cancelled && setState({ status: 'ready', meta }))
      .catch(() => !cancelled && setState({ status: 'unavailable' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, key]);

  return state;
}

/** CRD details of a single resource; undefined while loading or when CRDs cannot be read. */
export function useCRDMetaOf(plural: string): CRDMeta | undefined {
  const cluster = useCurrentCluster();
  const [meta, setMeta] = React.useState<CRDMeta | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    setMeta(undefined);
    fetchCRDMeta(cluster, plural)
      .then(result => !cancelled && setMeta(result))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cluster, plural]);
  return meta;
}
