import React from 'react';
import { locationsOf, ResourceLocation } from '../api/discovery';
import { ApiError, getSnapshot, isForbidden, refresh, Snapshot, subscribe } from '../api/liveStore';
import { coreListPath, customListPath, ListOptions } from '../api/paths';
import { ResourceId, RESOURCES } from '../resources/definitions';
import { KubeJson, KubeList } from '../resources/types';
import { refreshMs, useSettings } from '../settings/settings';
import { useCurrentCluster } from './useCluster';
import { useDiscovery } from './useDiscovery';

/**
 * Subscribes to several API paths of the current cluster and returns their snapshots in order.
 * `intervalMs` defaults to the refresh interval from the settings; 0 fetches once.
 */
export function useLivePaths<T>(
  paths: string[],
  intervalMs?: number
): { snapshots: Snapshot<T>[]; refetch: () => void } {
  const cluster = useCurrentCluster();
  const settings = useSettings();
  const ms = intervalMs ?? refreshMs(settings);
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  const joined = paths.join('\n');

  React.useEffect(() => {
    if (!joined) return;
    const unsubs = joined.split('\n').map(p => subscribe(cluster, p, ms, forceUpdate));
    return () => unsubs.forEach(u => u());
  }, [cluster, joined, ms]);

  const refetch = React.useCallback(() => {
    joined && joined.split('\n').forEach(p => refresh(cluster, p));
  }, [cluster, joined]);

  return { snapshots: paths.map(p => getSnapshot<T>(cluster, p)), refetch };
}

export function useLivePath<T>(
  path: string | null,
  intervalMs?: number
): Snapshot<T> & { refetch: () => void } {
  const { snapshots, refetch } = useLivePaths<T>(path ? [path] : [], intervalMs);
  return { ...(snapshots[0] || { loading: false }), refetch };
}

export interface ResourceListResult<T> {
  /** Items of every served location, merged. Empty while loading. */
  items: T[];
  loading: boolean;
  /** The API is not served by the cluster (CRD not installed). */
  notInstalled: boolean;
  /** Discovery itself failed. */
  discoveryError?: string;
  /** Errors per location (a partial result is still returned). */
  errors: ApiError[];
  forbidden: boolean;
  locations: ResourceLocation[];
  refetch: () => void;
}

function withTypeMeta<T extends KubeJson>(
  items: T[] | undefined,
  apiVersion: string,
  kind: string
) {
  return (items || []).map(item =>
    item.apiVersion && item.kind ? item : ({ ...item, apiVersion, kind } as T)
  );
}

/**
 * Lists an Inference Hub custom resource from every API group/version it is served at.
 * Pass `null` as namespace to skip the request (e.g. until a namespace is chosen).
 */
export function useResourceList<T extends KubeJson = KubeJson>(
  id: ResourceId,
  opts: ListOptions | null = {},
  intervalMs?: number
): ResourceListResult<T> {
  const def = RESOURCES[id];
  const state = useDiscovery();
  const locations =
    state.status === 'ready' ? locationsOf(state.discovery, id) : ([] as ResourceLocation[]);
  const paths = opts ? locations.map(l => customListPath(def, l, opts)) : [];
  const { snapshots, refetch } = useLivePaths<KubeList<T>>(paths, intervalMs);

  const items = React.useMemo(
    () =>
      snapshots.flatMap((s, i) => withTypeMeta(s.data?.items, locations[i].apiVersion, def.kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshots.map(s => s.updatedAt).join(','), paths.join(',')]
  );
  const errors = snapshots.flatMap(s => (s.error ? [s.error] : []));

  return {
    items,
    loading: state.status === 'loading' || snapshots.some(s => s.loading),
    notInstalled: state.status === 'ready' && locations.length === 0,
    discoveryError: state.status === 'error' ? state.error : undefined,
    errors,
    forbidden: errors.length > 0 && errors.every(isForbidden),
    locations,
    refetch,
  };
}

/** Lists a built-in resource, e.g. useCoreList('v1', 'pods', true, { namespace }). */
export function useCoreList<T extends KubeJson = KubeJson>(
  apiVersion: string,
  plural: string,
  namespaced: boolean,
  opts: ListOptions | null = {},
  intervalMs?: number
) {
  const path = opts ? coreListPath(apiVersion, plural, namespaced, opts) : null;
  const snapshot = useLivePath<KubeList<T>>(path, intervalMs);
  return {
    items: snapshot.data?.items || [],
    loading: snapshot.loading && !!path,
    error: snapshot.error,
    forbidden: isForbidden(snapshot.error),
    refetch: snapshot.refetch,
  };
}
