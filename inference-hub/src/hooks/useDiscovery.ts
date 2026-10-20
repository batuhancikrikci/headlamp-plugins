import React from 'react';
import { discover, Discovery, getCachedDiscovery, subscribeDiscovery } from '../api/discovery';
import { useCurrentCluster } from './useCluster';

export type DiscoveryState =
  | { status: 'loading'; rescan: () => void }
  | { status: 'error'; error: string; rescan: () => void }
  | { status: 'ready'; discovery: Discovery; rescan: () => void; rescanning: boolean };

/** Discovers (once per cluster, cached) which Inference Hub APIs the current cluster serves. */
export function useDiscovery(): DiscoveryState {
  const cluster = useCurrentCluster();
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  const [error, setError] = React.useState<{ cluster: string; message: string } | null>(null);
  const [rescanning, setRescanning] = React.useState(false);

  React.useEffect(() => subscribeDiscovery(forceUpdate), []);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    discover(cluster).catch((err: unknown) => {
      if (!cancelled) setError({ cluster, message: (err as Error)?.message || String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [cluster]);

  const rescan = React.useCallback(() => {
    setError(null);
    setRescanning(true);
    discover(cluster, true)
      .catch((err: unknown) =>
        setError({ cluster, message: (err as Error)?.message || String(err) })
      )
      .finally(() => setRescanning(false));
  }, [cluster]);

  const discovery = getCachedDiscovery(cluster);
  if (discovery) return { status: 'ready', discovery, rescan, rescanning };
  if (error && error.cluster === cluster) return { status: 'error', error: error.message, rescan };
  return { status: 'loading', rescan };
}
