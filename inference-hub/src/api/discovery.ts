/**
 * Runtime API discovery.
 *
 * Inference Hub never assumes an API version. For the current cluster it reads the API group list,
 * then the resource list of every served version of the groups it cares about, and records
 * where each resource is served. Results are cached per cluster; failures are not cached.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { orderVersions } from '../common/kubeVersion';
import { ALL_GROUPS, RESOURCE_LIST, ResourceId, StackId, STACKS } from '../resources/definitions';

export interface ResourceLocation {
  group: string;
  version: string;
  /** "group/version", as used in apiVersion fields. */
  apiVersion: string;
}

export interface Discovery {
  /** Where each resource is served, in the definition's group preference order. */
  resources: Partial<Record<ResourceId, ResourceLocation[]>>;
  /** Served versions per API group (preferred version first). */
  groups: Record<string, string[]>;
  /** Resource lists that could not be read (e.g. RBAC or a broken aggregated API). */
  warnings: string[];
  discoveredAt: number;
}

export interface APIGroupList {
  groups?: Array<{
    name: string;
    versions?: Array<{ groupVersion: string; version: string }>;
    preferredVersion?: { groupVersion: string; version: string };
  }>;
}

export interface APIResourceList {
  resources?: Array<{ name: string }>;
}

/** Served versions of the groups Inference Hub uses, preferred version first. */
export function relevantGroupVersions(groupList: APIGroupList): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const group of groupList.groups || []) {
    if (!ALL_GROUPS.includes(group.name)) continue;
    const versions = (group.versions || []).map(v => v.version);
    result[group.name] = orderVersions(versions, group.preferredVersion?.version);
  }
  return result;
}

/**
 * Resolves resource locations from the group versions and their resource lists
 * (keyed by "group/version"). A resource is located at the highest priority version of each
 * candidate group that serves it.
 */
export function resolveResources(
  groups: Record<string, string[]>,
  resourceLists: Record<string, APIResourceList | undefined>
): Partial<Record<ResourceId, ResourceLocation[]>> {
  const result: Partial<Record<ResourceId, ResourceLocation[]>> = {};
  for (const def of RESOURCE_LIST) {
    const locations: ResourceLocation[] = [];
    for (const group of def.groups) {
      for (const version of groups[group] || []) {
        const apiVersion = `${group}/${version}`;
        const served = (resourceLists[apiVersion]?.resources || []).some(
          r => r.name === def.plural
        );
        if (served) {
          locations.push({ group, version, apiVersion });
          break;
        }
      }
    }
    if (locations.length > 0) result[def.id] = locations;
  }
  return result;
}

async function fetchDiscovery(cluster: string): Promise<Discovery> {
  const params = cluster ? { cluster } : {};
  const groupList: APIGroupList = await ApiProxy.request('/apis', params);
  const groups = relevantGroupVersions(groupList);
  const warnings: string[] = [];

  const groupVersions = Object.entries(groups).flatMap(([group, versions]) =>
    versions.map(version => `${group}/${version}`)
  );
  const lists = await Promise.all(
    groupVersions.map(gv =>
      (ApiProxy.request(`/apis/${gv}`, params) as Promise<APIResourceList>).catch(
        (err: unknown) => {
          warnings.push(`${gv}: ${(err as Error)?.message || String(err)}`);
          return undefined;
        }
      )
    )
  );
  const resourceLists: Record<string, APIResourceList | undefined> = {};
  groupVersions.forEach((gv, i) => (resourceLists[gv] = lists[i]));

  return {
    resources: resolveResources(groups, resourceLists),
    groups,
    warnings,
    discoveredAt: Date.now(),
  };
}

const cache = new Map<string, Discovery>();
const inflight = new Map<string, Promise<Discovery>>();
const listeners = new Set<() => void>();

function key(cluster?: string | null): string {
  return cluster || '';
}

export function subscribeDiscovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Discovers the APIs of a cluster, reusing the cached result unless `force` is set. */
export function discover(cluster?: string | null, force = false): Promise<Discovery> {
  const k = key(cluster);
  const cached = cache.get(k);
  if (cached && !force) return Promise.resolve(cached);
  const running = inflight.get(k);
  if (running) return running;

  const promise = fetchDiscovery(k)
    .then(result => {
      cache.set(k, result);
      listeners.forEach(l => l());
      return result;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, promise);
  return promise;
}

export function getCachedDiscovery(cluster?: string | null): Discovery | undefined {
  return cache.get(key(cluster));
}

export function locationsOf(discovery: Discovery | undefined, id: ResourceId): ResourceLocation[] {
  return discovery?.resources[id] || [];
}

export function isServed(discovery: Discovery | undefined, id: ResourceId): boolean {
  return locationsOf(discovery, id).length > 0;
}

export function isStackInstalled(discovery: Discovery | undefined, stack: StackId): boolean {
  const info = STACKS.find(s => s.id === stack);
  return !!info && info.anyOf.some(id => isServed(discovery, id));
}
