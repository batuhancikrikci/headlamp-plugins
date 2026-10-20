/**
 * Client-side preview of the clusters a Placement would select. It mirrors the scheduler's
 * filter stage: cluster sets bound to the placement namespace, label / claim predicates and
 * taints / tolerations (unreachable clusters carry the automatic
 * `cluster.open-cluster-management.io/unavailable|unreachable` NoSelect taints). Prioritizers and CEL selectors are not evaluated (the real decision can
 * differ); `numberOfClusters` caps the result in cluster name order.
 */
import {
  clusterClaims,
  clusterInSet,
  ManagedClusterJson,
  ManagedClusterSetJson,
  Taint,
} from '../resources/models/cluster';
import { PlacementSpec, Toleration } from '../resources/models/placement';
import { matchesClaimSelector, matchesSelector } from './selectors';

export type ExclusionReason = 'not-in-set' | 'predicate' | 'taint' | 'over-limit';

export interface PreviewCluster {
  name: string;
  selected: boolean;
  /** Why the cluster is not selected (empty when selected). */
  reasons: ExclusionReason[];
  /** Taints that block the cluster (for the reason text). */
  blockingTaints: Taint[];
  /** Sets (among the eligible ones) the cluster belongs to. */
  sets: string[];
}

export interface PlacementPreview {
  /** Cluster sets the placement may draw from (requested ∩ bound, or all bound). */
  eligibleSets: string[];
  /** Requested sets that are not bound to the placement namespace. */
  unboundSets: string[];
  /** Requested sets that do not exist. */
  missingSets: string[];
  clusters: PreviewCluster[];
  selectedCount: number;
  /** The spec uses rules the preview cannot evaluate (CEL, prioritizers). */
  approximate: boolean;
}

/**
 * Whether a toleration tolerates a taint (same semantics as the OCM scheduler):
 * an empty key with `Exists` tolerates everything; an empty effect matches every effect.
 */
export function tolerates(toleration: Toleration, taint: Taint): boolean {
  if (toleration.effect && toleration.effect !== taint.effect) return false;
  const operator = toleration.operator || 'Equal';
  if (!toleration.key) return operator === 'Exists';
  if (toleration.key !== taint.key) return false;
  if (operator === 'Exists') return true;
  return (toleration.value || '') === (taint.value || '');
}

/**
 * Taints that keep a cluster out of a new placement decision. `NoSelect` and `NoSelectIfNew`
 * exclude untolerated clusters from new decisions; `PreferNoSelect` only lowers the priority.
 */
export function blockingTaints(cluster: ManagedClusterJson, tolerations: Toleration[]): Taint[] {
  return (cluster.spec?.taints || []).filter(
    taint =>
      (taint.effect === 'NoSelect' || taint.effect === 'NoSelectIfNew') &&
      !tolerations.some(t => tolerates(t, taint))
  );
}

export function matchesPredicates(cluster: ManagedClusterJson, spec: PlacementSpec): boolean {
  const predicates = spec.predicates || [];
  if (predicates.length === 0) return true;
  const claims = clusterClaims(cluster);
  // Predicates are ORed; inside one predicate the label and claim selectors are ANDed.
  return predicates.some(p => {
    const selector = p.requiredClusterSelector;
    if (!selector) return true;
    return (
      matchesSelector(cluster.metadata.labels, selector.labelSelector) &&
      matchesClaimSelector(claims, selector.claimSelector)
    );
  });
}

export function previewPlacement(
  spec: PlacementSpec,
  input: {
    clusters: ManagedClusterJson[];
    sets: ManagedClusterSetJson[];
    /** Cluster sets bound to the placement namespace. */
    boundSets: string[];
  }
): PlacementPreview {
  const existing = new Set(input.sets.map(s => s.metadata.name));
  const bound = new Set(input.boundSets);
  const requested = spec.clusterSets || [];
  const missingSets = requested.filter(s => !existing.has(s));
  const unboundSets = requested.filter(s => existing.has(s) && !bound.has(s));
  const eligibleSets =
    requested.length > 0
      ? requested.filter(s => existing.has(s) && bound.has(s))
      : input.boundSets.filter(s => existing.has(s));
  const eligible = input.sets.filter(s => eligibleSets.includes(s.metadata.name));
  const tolerations = spec.tolerations || [];

  const clusters: PreviewCluster[] = [...input.clusters]
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
    .map(cluster => {
      const sets = eligible.filter(s => clusterInSet(cluster, s)).map(s => s.metadata.name);
      const reasons: ExclusionReason[] = [];
      if (sets.length === 0) reasons.push('not-in-set');
      if (!matchesPredicates(cluster, spec)) reasons.push('predicate');
      const blocking = blockingTaints(cluster, tolerations);
      if (blocking.length > 0) reasons.push('taint');
      return {
        name: cluster.metadata.name,
        selected: reasons.length === 0,
        reasons,
        blockingTaints: blocking,
        sets,
      };
    });

  const limit = spec.numberOfClusters;
  if (typeof limit === 'number' && limit >= 0) {
    let taken = 0;
    for (const cluster of clusters) {
      if (!cluster.selected) continue;
      if (taken < limit) taken++;
      else {
        cluster.selected = false;
        cluster.reasons.push('over-limit');
      }
    }
  }

  const approximate =
    (spec.predicates || []).some(
      p => (p.requiredClusterSelector?.celSelector?.celExpressions || []).length > 0
    ) ||
    ((spec.prioritizerPolicy?.configurations || []).length > 0 && typeof limit === 'number');

  return {
    eligibleSets,
    unboundSets,
    missingSets,
    clusters,
    selectedCount: clusters.filter(c => c.selected).length,
    approximate,
  };
}

export const EXCLUSION_TEXT: Record<ExclusionReason, string> = {
  'not-in-set': 'Not in an eligible cluster set',
  predicate: 'Does not match the predicates',
  taint: 'Has a taint that is not tolerated',
  'over-limit': 'Over the number of clusters',
};
