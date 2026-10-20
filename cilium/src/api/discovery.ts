/**
 * Runtime discovery of the Cilium API: which CRDs are installed and which version of each is
 * served. Nothing in the plugin assumes a fixed version; `cilium.io/v2` and `v2alpha1` resources
 * are resolved per cluster.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { compareKubeVersions } from '../common/kubeVersion';
import { CRDS } from '../resources/registry';
import { API_GROUP } from '../resources/types';
import {
  APIResource,
  Availability,
  buildAvailability,
  CRDMeta,
  CRDObject,
  EMPTY_AVAILABILITY,
  ServedResource,
  toCRDMeta,
} from './availability';

export * from './availability';

const cache = new Map<string, Availability>();
const inflight = new Map<string, Promise<Availability>>();

function clusterKey(cluster?: string | null): string {
  return cluster || '';
}

export function isNotFound(err: unknown): boolean {
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
    if (isNotFound(err)) return EMPTY_AVAILABILITY;
    throw err;
  }

  // Stability wins over the group's preferred version: a kind served as both v2 and v2alpha1
  // must resolve to v2 even when the group prefers the alpha version.
  const ordered = (groupInfo?.versions || []).map(v => v.groupVersion).sort(compareKubeVersions);
  const byVersion: Record<string, APIResource[]> = {};
  await Promise.all(
    ordered.map(async version => {
      try {
        const info: { resources?: APIResource[] } = await ApiProxy.request(
          `/apis/${version}`,
          params
        );
        byVersion[version] = info?.resources || [];
      } catch {
        // A single version failing (e.g. a removed alpha version) must not break discovery.
        byVersion[version] = [];
      }
    })
  );
  return buildAvailability(ordered, byVersion);
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

/** Drops the cached result so the next discovery hits the API server again. */
export function invalidateAvailability(cluster?: string | null) {
  cache.delete(clusterKey(cluster));
}

/** Writes the discovered versions to the resource classes. */
export function applyVersions(availability: Availability) {
  for (const crd of CRDS) {
    const version = availability.versions[crd.plural] || crd.defaultVersion;
    if (crd.cls.apiVersion !== version) {
      crd.cls.apiVersion = version;
      // Headlamp caches the endpoint built from apiVersion; rebuild it for the new version.
      crd.cls._internalApiEndpoint = undefined;
    }
  }
}

export function isAvailable(availability: Availability | undefined, plural: string): boolean {
  return !!availability?.versions[plural];
}

/** Returns the served apiVersion for a resource (falls back to the registry default). */
export function servedApiVersion(plural: string, cluster?: string | null): string {
  const served = getCachedAvailability(cluster)?.versions[plural];
  if (served) return served;
  return CRDS.find(c => c.plural === plural)?.defaultVersion || `${API_GROUP}/v2`;
}

/** Served resources of the group that have no dedicated views in this plugin. */
export function unknownResources(availability: Availability): ServedResource[] {
  const known = new Set(CRDS.map(c => c.plural));
  return Object.values(availability.resources)
    .filter(r => !known.has(r.plural))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

const crdMetaCache = new Map<string, Promise<CRDMeta | undefined>>();

/**
 * Reads one CustomResourceDefinition object for its deprecation and storage-version details.
 * This needs `get` on CRDs, which regular users often lack; callers must treat a rejection as
 * "details unavailable", never as a fatal error. Resolves to undefined when the CRD is missing.
 */
export function fetchCRDMeta(
  cluster: string | null | undefined,
  plural: string
): Promise<CRDMeta | undefined> {
  const key = `${clusterKey(cluster)}/${plural}`;
  const cached = crdMetaCache.get(key);
  if (cached) return cached;
  const params = cluster ? { cluster } : {};
  const promise = (
    ApiProxy.request(
      `/apis/apiextensions.k8s.io/v1/customresourcedefinitions/${plural}.${API_GROUP}`,
      params
    ) as Promise<CRDObject>
  )
    .then(toCRDMeta)
    .catch(err => {
      if (isNotFound(err)) return undefined;
      throw err;
    });
  crdMetaCache.set(key, promise);
  promise.catch(() => crdMetaCache.delete(key));
  return promise;
}

/** CRD details for several resources; rejects when CRDs cannot be read at all. */
export async function fetchAllCRDMeta(
  cluster: string | null | undefined,
  plurals: string[]
): Promise<Record<string, CRDMeta>> {
  const list = await Promise.all(plurals.map(plural => fetchCRDMeta(cluster, plural)));
  const out: Record<string, CRDMeta> = {};
  for (const meta of list) if (meta) out[meta.plural] = meta;
  return out;
}
