/**
 * ManagedCluster, ManagedClusterSet, ManagedClusterSetBinding, ClusterClaim and
 * CertificateSigningRequest models (cluster.open-cluster-management.io, certificates.k8s.io).
 */
import { matchesSelector } from '../../utils/selectors';
import {
  Condition,
  findCondition,
  Health,
  isConditionTrue,
  KubeJson,
  Labels,
  LabelSelector,
  Metadata,
} from './common';

export const CLUSTER_SET_LABEL = 'cluster.open-cluster-management.io/clusterset';
export const CLUSTER_NAME_LABEL = 'open-cluster-management.io/cluster-name';

export const COND_HUB_ACCEPTED = 'HubAcceptedManagedCluster';
export const COND_HUB_DENIED = 'HubDeniedManagedCluster';
export const COND_JOINED = 'ManagedClusterJoined';
export const COND_AVAILABLE = 'ManagedClusterConditionAvailable';
export const COND_CLOCK_SYNCED = 'ManagedClusterConditionClockSynced';

export const TAINT_EFFECTS = ['NoSelect', 'PreferNoSelect', 'NoSelectIfNew'] as const;
export type TaintEffect = (typeof TAINT_EFFECTS)[number];

export interface Taint {
  key: string;
  value?: string;
  effect: TaintEffect | string;
  timeAdded?: string;
}

export interface ClientConfig {
  url: string;
  caBundle?: string;
}

export interface ClusterClaimValue {
  name: string;
  value: string;
}

export interface ManagedClusterJson extends KubeJson {
  spec?: {
    hubAcceptsClient?: boolean;
    leaseDurationSeconds?: number;
    managedClusterClientConfigs?: ClientConfig[];
    taints?: Taint[];
  };
  status?: {
    conditions?: Condition[];
    clusterClaims?: ClusterClaimValue[];
    version?: { kubernetes?: string };
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    managedNamespaces?: Array<{ name: string; clusterSet: string; conditions?: Condition[] }>;
  };
}

/**
 * Lifecycle state of a managed cluster, from first registration to steady state:
 * - `pending-accept`: the cluster registered but the hub has not accepted it yet;
 * - `pending-join`: accepted, but the agent has not joined (usually a CSR waits for approval);
 * - `available` / `unavailable` / `unknown`: joined, with the agent's lease status;
 * - `denied`: the hub denied the cluster; `deleting`: being detached.
 */
export type ClusterState =
  | 'available'
  | 'unavailable'
  | 'unknown'
  | 'pending-accept'
  | 'pending-join'
  | 'denied'
  | 'deleting';

export function clusterState(cluster: ManagedClusterJson): ClusterState {
  if (cluster.metadata.deletionTimestamp) return 'deleting';
  const conditions = cluster.status?.conditions;
  if (isConditionTrue(conditions, COND_HUB_DENIED)) return 'denied';
  if (!cluster.spec?.hubAcceptsClient) return 'pending-accept';
  if (!isConditionTrue(conditions, COND_JOINED)) return 'pending-join';
  const available = findCondition(conditions, COND_AVAILABLE);
  if (available?.status === 'True') return 'available';
  if (available?.status === 'False') return 'unavailable';
  return 'unknown';
}

export const CLUSTER_STATE_LABEL: Record<ClusterState, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
  'pending-accept': 'Pending acceptance',
  'pending-join': 'Pending join',
  denied: 'Denied',
  deleting: 'Detaching',
};

export const CLUSTER_STATE_HEALTH: Record<ClusterState, Health> = {
  available: 'success',
  unavailable: 'error',
  unknown: 'warning',
  'pending-accept': 'warning',
  'pending-join': 'warning',
  denied: 'error',
  deleting: 'unknown',
};

export function clusterSetOf(cluster: { metadata: Metadata }): string | undefined {
  return cluster.metadata.labels?.[CLUSTER_SET_LABEL] || undefined;
}

/** Cluster claims (`status.clusterClaims`) as a name → value map. */
export function clusterClaims(cluster: ManagedClusterJson): Labels {
  const out: Labels = {};
  for (const claim of cluster.status?.clusterClaims || []) out[claim.name] = claim.value;
  return out;
}

export function clusterURL(cluster: ManagedClusterJson): string | undefined {
  return cluster.spec?.managedClusterClientConfigs?.[0]?.url;
}

export function kubernetesVersion(cluster: ManagedClusterJson): string | undefined {
  return cluster.status?.version?.kubernetes;
}

export interface ClusterCounts {
  total: number;
  available: number;
  unavailable: number;
  unknown: number;
  pendingAccept: number;
  pendingJoin: number;
  denied: number;
  deleting: number;
  joined: number;
}

export function clusterCounts(clusters: ManagedClusterJson[]): ClusterCounts {
  const counts: ClusterCounts = {
    total: clusters.length,
    available: 0,
    unavailable: 0,
    unknown: 0,
    pendingAccept: 0,
    pendingJoin: 0,
    denied: 0,
    deleting: 0,
    joined: 0,
  };
  for (const cluster of clusters) {
    const state = clusterState(cluster);
    if (state === 'available') counts.available++;
    else if (state === 'unavailable') counts.unavailable++;
    else if (state === 'unknown') counts.unknown++;
    else if (state === 'pending-accept') counts.pendingAccept++;
    else if (state === 'pending-join') counts.pendingJoin++;
    else if (state === 'denied') counts.denied++;
    else counts.deleting++;
    if (isConditionTrue(cluster.status?.conditions, COND_JOINED)) counts.joined++;
  }
  return counts;
}

// ----- ManagedClusterSet -----

export type SetSelectorType = 'ExclusiveClusterSetLabel' | 'LabelSelector';

export interface ManagedClusterSetJson extends KubeJson {
  spec?: {
    clusterSelector?: { selectorType?: SetSelectorType | string; labelSelector?: LabelSelector };
    managedNamespaces?: Array<{ name: string }>;
  };
  status?: { conditions?: Condition[] };
}

export function setSelectorType(set: ManagedClusterSetJson): SetSelectorType {
  return set.spec?.clusterSelector?.selectorType === 'LabelSelector'
    ? 'LabelSelector'
    : 'ExclusiveClusterSetLabel';
}

/**
 * Whether a cluster belongs to a set. Sets with `ExclusiveClusterSetLabel` select clusters
 * labelled `cluster.open-cluster-management.io/clusterset=<set>`; `LabelSelector` sets select
 * by label selector (an empty selector selects every cluster, as the "global" set does).
 */
export function clusterInSet(cluster: ManagedClusterJson, set: ManagedClusterSetJson): boolean {
  if (setSelectorType(set) === 'LabelSelector') {
    return matchesSelector(cluster.metadata.labels, set.spec?.clusterSelector?.labelSelector || {});
  }
  return clusterSetOf(cluster) === set.metadata.name;
}

export function setMembers(
  set: ManagedClusterSetJson,
  clusters: ManagedClusterJson[]
): ManagedClusterJson[] {
  return clusters.filter(c => clusterInSet(c, set));
}

/** Names of the sets a cluster belongs to. */
export function setsOfCluster(
  cluster: ManagedClusterJson,
  sets: ManagedClusterSetJson[]
): string[] {
  return sets.filter(s => clusterInSet(cluster, s)).map(s => s.metadata.name);
}

export interface ManagedClusterSetBindingJson extends KubeJson {
  spec?: { clusterSet?: string };
  status?: { conditions?: Condition[] };
}

/** Cluster sets bound to a namespace. */
export function boundSets(bindings: ManagedClusterSetBindingJson[], namespace: string): string[] {
  return bindings
    .filter(b => b.metadata.namespace === namespace && b.spec?.clusterSet)
    .map(b => b.spec!.clusterSet!);
}

/** A binding's status: `Bound` condition when reported, otherwise unknown. */
export function bindingBound(binding: ManagedClusterSetBindingJson): boolean | undefined {
  const bound = findCondition(binding.status?.conditions, 'Bound');
  if (!bound) return undefined;
  return bound.status === 'True';
}

// ----- CertificateSigningRequest -----

export interface CSRJson extends KubeJson {
  spec?: {
    signerName?: string;
    username?: string;
    groups?: string[];
    usages?: string[];
    request?: string;
    expirationSeconds?: number;
  };
  status?: {
    conditions?: Array<Condition & { lastUpdateTime?: string }>;
    certificate?: string;
  };
}

export type CSRState = 'pending' | 'approved' | 'issued' | 'denied' | 'failed';

export function csrState(csr: CSRJson): CSRState {
  const conditions = csr.status?.conditions || [];
  if (conditions.some(c => c.type === 'Denied' && c.status === 'True')) return 'denied';
  if (conditions.some(c => c.type === 'Failed' && c.status === 'True')) return 'failed';
  if (conditions.some(c => c.type === 'Approved' && c.status === 'True')) {
    return csr.status?.certificate ? 'issued' : 'approved';
  }
  return 'pending';
}

/** Name of the managed cluster an OCM registration CSR belongs to. */
export function csrCluster(csr: CSRJson): string | undefined {
  return csr.metadata.labels?.[CLUSTER_NAME_LABEL] || undefined;
}

/** OCM registration CSRs are labelled with the cluster name. */
export function isClusterCSR(csr: CSRJson): boolean {
  return !!csrCluster(csr);
}

export function pendingCSRsByCluster(csrs: CSRJson[]): Record<string, CSRJson[]> {
  const out: Record<string, CSRJson[]> = {};
  for (const csr of csrs) {
    const cluster = csrCluster(csr);
    if (!cluster || csrState(csr) !== 'pending') continue;
    (out[cluster] = out[cluster] || []).push(csr);
  }
  return out;
}

/**
 * Body of an update to the `approval` subresource: the CSR with an `Approved` or `Denied`
 * condition (replacing a previous one of the same type).
 */
export function csrDecisionBody(
  csr: CSRJson,
  decision: 'Approved' | 'Denied',
  message: string,
  now: string
): CSRJson {
  const conditions = (csr.status?.conditions || []).filter(c => c.type !== decision);
  return {
    apiVersion: csr.apiVersion || 'certificates.k8s.io/v1',
    kind: 'CertificateSigningRequest',
    metadata: { ...csr.metadata },
    spec: csr.spec,
    status: {
      ...(csr.status || {}),
      conditions: [
        ...conditions,
        {
          type: decision,
          status: 'True',
          reason: decision === 'Approved' ? 'ApprovedByMulticlusterHub' : 'DeniedByMulticlusterHub',
          message,
          lastUpdateTime: now,
          lastTransitionTime: now,
        },
      ],
    },
  };
}

/** Merge patch that assigns a cluster to a set (null removes the label). */
export function clusterSetPatch(set: string | null) {
  return { metadata: { labels: { [CLUSTER_SET_LABEL]: set } } };
}

/** Claims the registration agent always reports (`cluster/v1alpha1.ReservedClusterClaimNames`). */
export const RESERVED_CLAIMS = [
  'id.k8s.io',
  'kubeversion.open-cluster-management.io',
  'platform.open-cluster-management.io',
  'product.open-cluster-management.io',
];

/** Label keys and claim names seen on the given clusters, for selector suggestions. */
export function selectorSuggestions(clusters: ManagedClusterJson[]): {
  labels: string[];
  claims: string[];
} {
  const labels = new Set<string>();
  const claims = new Set<string>(RESERVED_CLAIMS);
  for (const c of clusters) {
    Object.keys(c.metadata.labels || {}).forEach(k => labels.add(k));
    (c.status?.clusterClaims || []).forEach(claim => claims.add(claim.name));
  }
  return { labels: Array.from(labels).sort(), claims: Array.from(claims).sort() };
}
