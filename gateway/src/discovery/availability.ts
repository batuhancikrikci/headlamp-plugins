/**
 * Pure logic that turns API discovery documents into "which Gateway API kinds can be used on this
 * cluster, and with which version". Kept free of I/O so it can be unit tested.
 */
import { compareKubeVersions } from '../common/kubeVersion';
import { KindInfo, KindName, KINDS } from '../resources/registry';

/** One `APIResourceList` entry, reduced to what the plugin needs. */
export interface DiscoveredResource {
  name: string;
  kind?: string;
  namespaced?: boolean;
  verbs?: string[];
}

export interface DiscoveredVersion {
  /** Version name without the group, e.g. `v1`. */
  version: string;
  resources: DiscoveredResource[];
}

export interface DiscoveredGroup {
  group: string;
  /** Version the API server prefers for the group, when reported. */
  preferredVersion?: string;
  versions: DiscoveredVersion[];
}

export interface KindAvailability {
  /** Version the plugin reads and writes, e.g. `v1`. */
  version: string;
  /** `group/version`. */
  apiVersion: string;
  /** Every served version, most preferred first. */
  servedVersions: string[];
  verbs: string[];
}

export type Channel = 'standard' | 'experimental';

export interface Availability {
  /** Whether any Gateway API resource is served. */
  installed: boolean;
  kinds: Partial<Record<KindName, KindAvailability>>;
  /** Gateway API bundle version read from the CRD annotations, when readable. */
  bundleVersion?: string;
  /** Release channel read from the CRD annotations, when readable. */
  channel?: Channel;
}

/** Distinct versions ordered by Kubernetes version priority (most stable first). */
export function sortKubeVersions(versions: string[]): string[] {
  return [...new Set(versions)].sort(compareKubeVersions);
}

/**
 * Picks the version to use for a kind: the most stable served version. This matches the order the
 * API server itself advertises, and it does not need permission to read the CRD (which is where
 * the storage version lives). For conversion-free CRDs such as the Gateway API ones every served
 * version reads and writes the same stored object.
 */
export function preferredVersion(servedVersions: string[]): string | undefined {
  return sortKubeVersions(servedVersions)[0];
}

function isSubresource(name: string): boolean {
  return name.includes('/');
}

/** Resolves the availability of every known kind from the discovery documents of its group. */
export function resolveAvailability(
  groups: DiscoveredGroup[],
  kinds: KindInfo[] = KINDS
): Availability {
  const result: Availability = { installed: false, kinds: {} };

  for (const info of kinds) {
    const group = groups.find(g => g.group === info.group);
    if (!group) continue;

    const served: string[] = [];
    const verbsByVersion = new Map<string, string[]>();
    for (const version of group.versions) {
      const resource = version.resources.find(
        r => !isSubresource(r.name) && r.name === info.plural
      );
      if (!resource) continue;
      served.push(version.version);
      verbsByVersion.set(version.version, resource.verbs || []);
    }
    if (served.length === 0) continue;

    const servedVersions = sortKubeVersions(served);
    const version = servedVersions[0];
    result.kinds[info.kind] = {
      version,
      apiVersion: `${info.group}/${version}`,
      servedVersions,
      verbs: verbsByVersion.get(version) || [],
    };
    result.installed = true;
  }

  return result;
}

export function isKindAvailable(availability: Availability | undefined, kind: KindName): boolean {
  return !!availability?.kinds[kind];
}

/** `group/version` to use for a kind: the served one, or the newest known one as a fallback. */
export function apiVersionFor(availability: Availability | undefined, info: KindInfo): string {
  return availability?.kinds[info.kind]?.apiVersion || `${info.group}/${info.knownVersions[0]}`;
}

/** Normalizes the channel annotation of a Gateway API CRD. */
export function parseChannel(value: unknown): Channel | undefined {
  return value === 'standard' || value === 'experimental' ? value : undefined;
}
