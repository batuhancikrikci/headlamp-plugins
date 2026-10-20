/**
 * Runtime discovery of the backend kinds other than Service (see backendKinds.ts) and listing of
 * their objects for the backend reference pickers. Discovery results are cached per cluster.
 */
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useEffect, useState } from 'react';
import { KubeJson } from '../resources/types';
import { resourcePath } from '../utils/apiPaths';
import { asArray, asRecord, asString } from '../utils/objects';
import { DiscoveredGroup, DiscoveredResource } from './availability';
import { BackendKind, backendKindsFrom, groupsFromAggregated } from './backendKinds';

/** Asks for aggregated discovery; servers without it answer with the legacy APIGroupList. */
const AGGREGATED_ACCEPT = [
  'application/json;g=apidiscovery.k8s.io;v=v2;as=APIGroupDiscoveryList',
  'application/json;g=apidiscovery.k8s.io;v=v2beta1;as=APIGroupDiscoveryList',
  'application/json',
].join(',');

const cache = new Map<string, BackendKind[]>();
const inflight = new Map<string, Promise<BackendKind[]>>();

function requestParams(cluster: string, headers?: Record<string, string>) {
  return { ...(cluster ? { cluster } : {}), ...(headers ? { headers } : {}) };
}

/** Legacy discovery: the preferred version of every group, one request per group. */
async function legacyGroups(document: unknown, cluster: string): Promise<DiscoveredGroup[]> {
  const groups = asArray<Record<string, unknown>>(asRecord(document).groups);
  return Promise.all(
    groups.map(async group => {
      const name = asString(group.name);
      const version = asString(asRecord(group.preferredVersion).version);
      if (!name || !version) return { group: name, versions: [] };
      try {
        const list = await ApiProxy.request(`/apis/${name}/${version}`, requestParams(cluster));
        const resources = asArray<DiscoveredResource>(asRecord(list).resources);
        return { group: name, versions: [{ version, resources }] };
      } catch {
        return { group: name, versions: [] };
      }
    })
  );
}

async function fetchBackendKinds(cluster: string): Promise<BackendKind[]> {
  const document = await ApiProxy.request(
    '/apis',
    requestParams(cluster, { Accept: AGGREGATED_ACCEPT })
  );
  const groups = groupsFromAggregated(document) || (await legacyGroups(document, cluster));
  return backendKindsFrom(groups);
}

function discoverBackendKinds(cluster: string): Promise<BackendKind[]> {
  const cached = cache.get(cluster);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(cluster);
  if (running) return running;
  const promise = fetchBackendKinds(cluster)
    .then(kinds => {
      cache.set(cluster, kinds);
      return kinds;
    })
    .finally(() => inflight.delete(cluster));
  inflight.set(cluster, promise);
  return promise;
}

/**
 * The backend kinds served by the current cluster; empty until discovered and when discovery
 * fails (the kind can still be typed in by hand).
 */
export function useBackendKinds(): BackendKind[] {
  const cluster = K8s.useCluster() || getCluster() || '';
  const [kinds, setKinds] = useState<BackendKind[]>(() => cache.get(cluster) || []);
  useEffect(() => {
    let cancelled = false;
    discoverBackendKinds(cluster)
      .then(result => {
        if (!cancelled) setKinds(result);
      })
      .catch(() => {
        if (!cancelled) setKinds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cluster]);
  return kinds;
}

/**
 * Objects of a backend kind in one namespace, or null while loading, when they cannot be listed
 * (missing permission) and when no kind or namespace is given.
 */
export function useBackendObjects(kind?: BackendKind, namespace?: string): KubeJson[] | null {
  const cluster = K8s.useCluster() || getCluster() || '';
  const [items, setItems] = useState<KubeJson[] | null>(null);
  const path =
    kind && namespace
      ? resourcePath({
          apiVersion: `${kind.group}/${kind.version}`,
          plural: kind.plural,
          namespace,
        })
      : '';
  useEffect(() => {
    setItems(null);
    if (!path) return;
    let cancelled = false;
    ApiProxy.request(path, requestParams(cluster))
      .then(list => {
        if (!cancelled) setItems(asArray<KubeJson>(asRecord(list).items));
      })
      .catch(() => {
        if (!cancelled) setItems(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path, cluster]);
  return items;
}
