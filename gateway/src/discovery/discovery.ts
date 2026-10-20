/**
 * Runtime discovery of the Gateway API on a cluster: which kinds are served, in which versions,
 * and (when the user may read CRDs) which bundle version and channel are installed.
 *
 * Results are cached per cluster. The served version is written to the resource classes so every
 * list, get and write uses it.
 */
import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useCallback, useEffect, useState } from 'react';
import { setApiVersions } from '../resources/classes';
import { KindInfo, KindName } from '../resources/registry';
import { BUNDLE_VERSION_ANNOTATION, CHANNEL_ANNOTATION, GATEWAY_GROUP } from '../resources/types';
import {
  Availability,
  DiscoveredGroup,
  DiscoveredResource,
  parseChannel,
  resolveAvailability,
} from './availability';

const GROUPS = [GATEWAY_GROUP];
/** CRDs probed, in order, for the bundle annotations. */
const BUNDLE_CRDS = [
  `gateways.${GATEWAY_GROUP}`,
  `gatewayclasses.${GATEWAY_GROUP}`,
  `httproutes.${GATEWAY_GROUP}`,
];

const cache = new Map<string, Availability>();
const inflight = new Map<string, Promise<Availability>>();
const listeners = new Set<() => void>();

function clusterKey(cluster?: string | null): string {
  return cluster || '';
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function requestParams(cluster: string) {
  return cluster ? { cluster } : {};
}

interface APIGroupDocument {
  versions?: Array<{ groupVersion?: string; version?: string }>;
  preferredVersion?: { version?: string };
}

interface APIResourceListDocument {
  resources?: DiscoveredResource[];
}

async function discoverGroup(group: string, cluster: string): Promise<DiscoveredGroup | null> {
  let document: APIGroupDocument;
  try {
    document = await ApiProxy.request(`/apis/${group}`, requestParams(cluster));
  } catch (err) {
    // The group is simply not installed.
    if (statusOf(err) === 404) return null;
    throw err;
  }

  const versionNames = (document?.versions || [])
    .map(v => v.version || (v.groupVersion || '').split('/')[1])
    .filter((v): v is string => !!v);

  const versions = await Promise.all(
    versionNames.map(async version => {
      try {
        const list: APIResourceListDocument = await ApiProxy.request(
          `/apis/${group}/${version}`,
          requestParams(cluster)
        );
        return { version, resources: list?.resources || [] };
      } catch {
        // One broken version (e.g. an alpha version being removed) must not hide the others.
        return { version, resources: [] };
      }
    })
  );

  return { group, preferredVersion: document?.preferredVersion?.version, versions };
}

interface CRDDocument {
  metadata?: { annotations?: Record<string, string> };
}

/** Reads the bundle annotations from the CRDs; needs CRD read access, so failures are expected. */
async function discoverBundle(
  cluster: string
): Promise<Pick<Availability, 'bundleVersion' | 'channel'>> {
  for (const name of BUNDLE_CRDS) {
    try {
      const crd: CRDDocument = await ApiProxy.request(
        `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${name}`,
        requestParams(cluster)
      );
      const annotations = crd?.metadata?.annotations || {};
      if (annotations[BUNDLE_VERSION_ANNOTATION] || annotations[CHANNEL_ANNOTATION]) {
        return {
          bundleVersion: annotations[BUNDLE_VERSION_ANNOTATION],
          channel: parseChannel(annotations[CHANNEL_ANNOTATION]),
        };
      }
    } catch (err) {
      // Forbidden: no point in trying the other CRDs.
      if (statusOf(err) === 403 || statusOf(err) === 401) break;
    }
  }
  return {};
}

async function fetchAvailability(cluster: string): Promise<Availability> {
  const groups = (await Promise.all(GROUPS.map(group => discoverGroup(group, cluster)))).filter(
    (group): group is DiscoveredGroup => group !== null
  );
  const availability = resolveAvailability(groups);
  if (availability.installed) {
    Object.assign(availability, await discoverBundle(cluster));
  }
  return availability;
}

/**
 * Discovers the Gateway API of a cluster. Successful results are cached; failures are not, so the
 * next call retries.
 */
export function discoverAvailability(
  cluster?: string | null,
  force = false
): Promise<Availability> {
  const key = clusterKey(cluster);
  if (!force) {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = inflight.get(key);
    if (running) return running;
  }

  const promise = fetchAvailability(key)
    .then(result => {
      cache.set(key, result);
      listeners.forEach(listener => listener());
      return result;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function getCachedAvailability(cluster?: string | null): Availability | undefined {
  return cache.get(clusterKey(cluster));
}

/** Calls `listener` whenever discovery of any cluster completes. Returns the unsubscribe function. */
export function onAvailabilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Writes the served versions to the resource classes. */
export function applyVersions(availability: Availability): void {
  const versions: Partial<Record<KindName, string>> = {};
  for (const [kind, served] of Object.entries(availability.kinds)) {
    if (served) versions[kind as KindName] = served.apiVersion;
  }
  setApiVersions(versions);
}

/** `group/version` to use for a kind on the current (or given) cluster. */
export function servedApiVersion(info: KindInfo, cluster?: string | null): string {
  const availability = getCachedAvailability(cluster ?? getCluster());
  return availability?.kinds[info.kind]?.apiVersion || `${info.group}/${info.knownVersions[0]}`;
}

export type DiscoveryState =
  | { status: 'loading' }
  | { status: 'error'; error: string; retry: () => void }
  | { status: 'ready'; availability: Availability; refresh: () => void };

/** React hook: discovers (and applies) the Gateway API versions of the current cluster. */
export function useDiscovery(): DiscoveryState {
  const cluster = K8s.useCluster() || getCluster() || '';
  const [attempt, setAttempt] = useState(0);
  const [forced, setForced] = useState(0);
  const retry = useCallback(() => setAttempt(a => a + 1), []);
  const refresh = useCallback(() => setForced(f => f + 1), []);

  const [state, setState] = useState<DiscoveryState>(() => {
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      return { status: 'ready', availability: cached, refresh };
    }
    return { status: 'loading' };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = forced > 0 ? undefined : getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      setState({ status: 'ready', availability: cached, refresh });
      return;
    }
    setState({ status: 'loading' });
    discoverAvailability(cluster, forced > 0)
      .then(availability => {
        if (cancelled) return;
        applyVersions(availability);
        setState({ status: 'ready', availability, refresh });
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
    // `forced` only ever grows, so each refresh re-runs discovery exactly once.
  }, [cluster, attempt, forced, retry, refresh]);

  return state;
}
