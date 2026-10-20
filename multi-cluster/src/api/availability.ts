/**
 * Pure model of API discovery: which supported kinds are served, and in which version the plugin
 * talks to them. The fetching lives in discovery.ts.
 */
import { bareVersion, compareKubeVersions } from '../common/kubeVersion';
import { GROUPS, kindKey, KindMeta, kindMeta, KINDS } from './kinds';

export interface APIResource {
  name: string;
  kind?: string;
  namespaced?: boolean;
  verbs?: string[];
}

export type KindState =
  | {
      status: 'available';
      /** Chosen group version, e.g. "cluster.open-cluster-management.io/v1beta1". */
      apiVersion: string;
      /** Every served version of the kind, highest priority first. */
      served: string[];
      verbs: string[];
    }
  | { status: 'missing' }
  | { status: 'unsupported'; served: string[] };

export interface Availability {
  /** Served versions per API group (bare versions, highest priority first). */
  groups: Record<string, string[]>;
  /** State per kind key (`plural.group`). */
  kinds: Record<string, KindState>;
  /** Every API group the cluster serves (from `/apis`), for detecting related components. */
  allGroups: string[];
}

export const EMPTY_AVAILABILITY: Availability = { groups: {}, kinds: {}, allGroups: [] };

/** Whether the cluster serves an API group (any version). */
export function servesGroup(availability: Availability | undefined, group: string): boolean {
  return !!availability?.allGroups.includes(group);
}

/**
 * Picks the version the plugin uses: the most stable served version that the plugin supports.
 * Returns undefined when none of the served versions is supported.
 */
export function chooseVersion(served: string[], supported: string[]): string | undefined {
  const usable = served.map(bareVersion).filter(v => supported.includes(v));
  return usable.sort(compareKubeVersions)[0];
}

/**
 * Builds the availability of every known kind.
 *
 * @param groupVersions - served versions per API group (from `/apis`).
 * @param resources - resource list per group version (`group/version` → resources).
 * @param kinds - the kinds to resolve (defaults to all supported kinds).
 */
export function buildAvailability(
  groupVersions: Record<string, string[]>,
  resources: Record<string, APIResource[]>,
  kinds: KindMeta[] = KINDS,
  allGroups: string[] = Object.keys(groupVersions)
): Availability {
  const groups: Record<string, string[]> = {};
  for (const [group, versions] of Object.entries(groupVersions)) {
    groups[group] = [...versions].map(bareVersion).sort(compareKubeVersions);
  }

  const states: Record<string, KindState> = {};
  for (const meta of kinds) {
    const served: string[] = [];
    let verbs: string[] = [];
    for (const version of groups[meta.group] || []) {
      const list = resources[`${meta.group}/${version}`] || [];
      const resource = list.find(r => r.name === meta.plural);
      if (!resource) continue;
      served.push(version);
      if (verbs.length === 0) verbs = resource.verbs || [];
    }
    if (served.length === 0) {
      states[kindKey(meta)] = { status: 'missing' };
      continue;
    }
    const version = chooseVersion(served, meta.versions);
    states[kindKey(meta)] = version
      ? { status: 'available', apiVersion: `${meta.group}/${version}`, served, verbs }
      : { status: 'unsupported', served };
  }
  return { groups, kinds: states, allGroups: [...allGroups].sort() };
}

export function kindState(availability: Availability | undefined, meta: KindMeta): KindState {
  return availability?.kinds[kindKey(meta)] || { status: 'missing' };
}

export function isKindAvailable(availability: Availability | undefined, meta: KindMeta): boolean {
  return kindState(availability, meta).status === 'available';
}

/** Chosen apiVersion of a kind, or undefined when it is not usable. */
export function chosenApiVersion(
  availability: Availability | undefined,
  meta: KindMeta
): string | undefined {
  const state = kindState(availability, meta);
  return state.status === 'available' ? state.apiVersion : undefined;
}

/**
 * Whether the cluster is an OCM hub. ManagedCluster is only installed by the cluster manager;
 * managed clusters serve ClusterClaim and AppliedManifestWork but not ManagedCluster.
 */
export function isHub(availability: Availability | undefined): boolean {
  return isKindAvailable(availability, kindMeta('ManagedCluster'));
}

/** Whether any kind of the plugin is served at all. */
export function anyOcmKind(availability: Availability | undefined): boolean {
  return KINDS.some(k => k.group !== GROUPS.certificates && isKindAvailable(availability, k));
}
