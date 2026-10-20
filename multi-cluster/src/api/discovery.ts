/**
 * Runtime discovery of the OCM APIs served by the current cluster. Nothing in the plugin assumes
 * a fixed version: every kind is resolved per cluster and the chosen version is written to the
 * resource class before any request is made.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { APIResource, Availability, buildAvailability } from './availability';
import { CRDJson } from './capabilities';
import { discoveredGroups, kindKey, KindMeta } from './kinds';

export * from './availability';

interface APIGroupList {
  groups?: Array<{ name: string; versions?: Array<{ groupVersion: string; version: string }> }>;
}

const cache = new Map<string, Availability>();
const inflight = new Map<string, Promise<Availability>>();

function key(cluster?: string | null): string {
  return cluster || '';
}

function params(cluster: string) {
  return cluster ? { cluster } : {};
}

export function errorStatusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

async function fetchAvailability(cluster: string): Promise<Availability> {
  const wanted = new Set(discoveredGroups());
  const list: APIGroupList = await ApiProxy.request('/apis', params(cluster));
  const groupVersions: Record<string, string[]> = {};
  for (const group of list?.groups || []) {
    if (!wanted.has(group.name)) continue;
    groupVersions[group.name] = (group.versions || []).map(v => v.version);
  }

  const resources: Record<string, APIResource[]> = {};
  await Promise.all(
    Object.entries(groupVersions).flatMap(([group, versions]) =>
      versions.map(async version => {
        const groupVersion = `${group}/${version}`;
        try {
          const info: { resources?: APIResource[] } = await ApiProxy.request(
            `/apis/${groupVersion}`,
            params(cluster)
          );
          resources[groupVersion] = info?.resources || [];
        } catch {
          // A single group version failing (e.g. a broken aggregated API) must not break the rest.
          resources[groupVersion] = [];
        }
      })
    )
  );
  const allGroups = (list?.groups || []).map(g => g.name);
  return buildAvailability(groupVersions, resources, undefined, allGroups);
}

/**
 * Discovers the served OCM APIs of a cluster. Successful results are cached per cluster;
 * failures are not cached so the next call retries.
 */
export function discoverAvailability(cluster?: string | null): Promise<Availability> {
  const k = key(cluster);
  const cached = cache.get(k);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(k);
  if (running) return running;
  const promise = fetchAvailability(k)
    .then(result => {
      cache.set(k, result);
      return result;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, promise);
  return promise;
}

export function getCachedAvailability(cluster?: string | null): Availability | undefined {
  return cache.get(key(cluster));
}

/** Drops the cached result so the next discovery hits the API server again. */
export function invalidateAvailability(cluster?: string | null) {
  cache.delete(key(cluster));
  for (const k of Array.from(crdCache.keys())) {
    if (k.startsWith(`${key(cluster)}|`)) crdCache.delete(k);
  }
}

const crdCache = new Map<string, Promise<CRDJson | undefined>>();

/**
 * Reads one CustomResourceDefinition (for schema-based capabilities, deprecation notices and
 * the documentation tab). Needs `get` on CRDs, which many users lack: callers must treat a
 * rejection as "details unavailable". Resolves to undefined when the CRD does not exist.
 */
export function fetchCRD(
  cluster: string | null | undefined,
  meta: KindMeta
): Promise<CRDJson | undefined> {
  const cacheKey = `${key(cluster)}|${kindKey(meta)}`;
  const cached = crdCache.get(cacheKey);
  if (cached) return cached;
  const promise = (
    ApiProxy.request(
      `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${kindKey(meta)}`,
      params(key(cluster))
    ) as Promise<CRDJson>
  ).catch(err => {
    if (errorStatusOf(err) === 404) return undefined;
    throw err;
  });
  crdCache.set(cacheKey, promise);
  promise.catch(() => crdCache.delete(cacheKey));
  return promise;
}
