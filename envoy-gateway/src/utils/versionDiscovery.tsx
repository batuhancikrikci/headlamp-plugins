import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React, { useCallback, useEffect, useState } from 'react';
import { orderVersions } from '../common/kubeVersion';
import { CRDS } from '../resources/registry';
import { API_GROUP, DEFAULT_API_VERSION } from '../resources/types';

export interface Availability {
  /** Whether the gateway.envoyproxy.io API group is served at all. */
  groupInstalled: boolean;
  /** Served group version per resource plural. Missing key = CRD not installed. */
  versions: Record<string, string>;
}

const cache = new Map<string, Availability>();
const inflight = new Map<string, Promise<Availability>>();

function clusterKey(cluster?: string | null): string {
  return cluster || '';
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

async function fetchAvailability(cluster: string): Promise<Availability> {
  const params = cluster ? { cluster } : {};
  let groupInfo: {
    versions?: Array<{ groupVersion: string }>;
    preferredVersion?: { groupVersion: string };
  };
  try {
    groupInfo = await ApiProxy.request(`/apis/${API_GROUP}`, params);
  } catch (err) {
    if (isNotFound(err)) return { groupInstalled: false, versions: {} };
    throw err;
  }

  const versions = orderVersions(
    (groupInfo?.versions || []).map(v => v.groupVersion),
    groupInfo?.preferredVersion?.groupVersion
  );
  const known = new Set(CRDS.map(c => c.plural));
  const result: Record<string, string> = {};

  for (const version of versions) {
    try {
      const info: { resources?: Array<{ name: string }> } = await ApiProxy.request(
        `/apis/${version}`,
        params
      );
      for (const resource of info?.resources || []) {
        if (resource.name.includes('/')) continue; // subresources such as "/status"
        if (known.has(resource.name) && !result[resource.name]) {
          result[resource.name] = version;
        }
      }
    } catch {
      // A single version failing (e.g. a removed alpha version) must not break discovery.
    }
  }
  return { groupInstalled: true, versions: result };
}

/**
 * Discovers the served API versions for the given cluster. Successful results are cached per
 * cluster; failures are not cached so the next call retries.
 */
export function discoverAvailability(cluster?: string | null): Promise<Availability> {
  const key = clusterKey(cluster);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;

  const promise = fetchAvailability(key)
    .then(result => {
      cache.set(key, result);
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function getCachedAvailability(cluster?: string | null): Availability | undefined {
  return cache.get(clusterKey(cluster));
}

/** Writes the discovered versions to the resource classes. */
export function applyVersions(availability: Availability) {
  for (const crd of CRDS) {
    crd.cls.apiVersion = availability.versions[crd.plural] || DEFAULT_API_VERSION;
  }
}

export function isAvailable(availability: Availability | undefined, plural: string): boolean {
  return !!availability?.versions[plural];
}

/** Returns the served apiVersion for a CRD kind (falls back to the default version). */
export function servedApiVersion(plural: string, cluster?: string | null): string {
  return getCachedAvailability(cluster ?? getCluster())?.versions[plural] || DEFAULT_API_VERSION;
}

export type DiscoveryState =
  | { status: 'loading' }
  | { status: 'error'; error: string; retry: () => void }
  | { status: 'ready'; availability: Availability };

/** React hook that discovers (and applies) the Envoy Gateway API versions of the current cluster. */
export function useEnvoyGatewayDiscovery(): DiscoveryState {
  const cluster = K8s.useCluster() || getCluster() || '';
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DiscoveryState>(() => {
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      return { status: 'ready', availability: cached };
    }
    return { status: 'loading' };
  });
  const retry = useCallback(() => setAttempt(a => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      setState({ status: 'ready', availability: cached });
      return;
    }
    setState({ status: 'loading' });
    discoverAvailability(cluster)
      .then(availability => {
        if (cancelled) return;
        applyVersions(availability);
        setState({ status: 'ready', availability });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          error: (err as Error)?.message || String(err),
          retry,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, attempt, retry]);

  return state;
}

export function DiscoveryLoader({ title }: { title: string }) {
  return <Loader title={title} />;
}
