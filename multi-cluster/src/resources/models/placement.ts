/**
 * Placement, PlacementDecision, AddOnPlacementScore and the legacy PlacementRule.
 */
import {
  ClaimSelector,
  Condition,
  findCondition,
  Health,
  KubeJson,
  LabelSelector,
  ObjectReference,
} from './common';

export const PLACEMENT_LABEL = 'cluster.open-cluster-management.io/placement';
export const DECISION_GROUP_NAME_LABEL = 'cluster.open-cluster-management.io/decision-group-name';
export const DECISION_GROUP_INDEX_LABEL = 'cluster.open-cluster-management.io/decision-group-index';

export const COND_PLACEMENT_SATISFIED = 'PlacementSatisfied';
export const COND_PLACEMENT_MISCONFIGURED = 'PlacementMisconfigured';

export const BUILTIN_PRIORITIZERS = [
  'Balance',
  'Steady',
  'ResourceAllocatableCPU',
  'ResourceAllocatableMemory',
  'Spread',
] as const;

export interface ClusterPredicate {
  requiredClusterSelector?: {
    labelSelector?: LabelSelector;
    claimSelector?: ClaimSelector;
    celSelector?: { celExpressions?: string[] };
  };
}

export interface Toleration {
  key?: string;
  operator?: 'Equal' | 'Exists' | string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

export interface PrioritizerConfig {
  scoreCoordinate: {
    type: 'BuiltIn' | 'AddOn' | string;
    builtIn?: string;
    addOn?: { resourceName: string; scoreName: string };
  };
  weight?: number;
}

export interface SpreadConstraint {
  topologyKey: string;
  topologyKeyType: 'Label' | 'Claim' | string;
  maxSkew?: number;
  whenUnsatisfiable?: 'DoNotSchedule' | 'ScheduleAnyway' | string;
}

export interface DecisionGroup {
  groupName: string;
  groupClusterSelector: { labelSelector?: LabelSelector; claimSelector?: ClaimSelector };
}

export interface PlacementSpec {
  clusterSets?: string[];
  numberOfClusters?: number;
  predicates?: ClusterPredicate[];
  prioritizerPolicy?: {
    mode?: 'Additive' | 'Exact' | string;
    configurations?: PrioritizerConfig[];
  };
  spreadPolicy?: { spreadConstraints?: SpreadConstraint[] };
  tolerations?: Toleration[];
  decisionStrategy?: {
    groupStrategy?: {
      clustersPerDecisionGroup?: string | number;
      decisionGroups?: DecisionGroup[];
    };
  };
  sortBy?: 'ClusterName' | 'Score' | string;
  scoreRateLimit?: string;
}

export interface PlacementJson extends KubeJson {
  spec?: PlacementSpec;
  status?: {
    conditions?: Condition[];
    numberOfSelectedClusters?: number;
    decisionGroups?: Array<{
      decisionGroupIndex?: number;
      decisionGroupName?: string;
      decisions?: string[];
      clusterCount?: number;
    }>;
    lastScoreUpdateTime?: string;
  };
}

export interface PlacementDecisionJson extends KubeJson {
  status?: { decisions?: Array<{ clusterName: string; reason?: string; score?: number }> };
}

export type PlacementState = 'satisfied' | 'unsatisfied' | 'misconfigured' | 'pending';

export function placementState(placement: PlacementJson): PlacementState {
  const conditions = placement.status?.conditions;
  if (findCondition(conditions, COND_PLACEMENT_MISCONFIGURED)?.status === 'True') {
    return 'misconfigured';
  }
  const satisfied = findCondition(conditions, COND_PLACEMENT_SATISFIED);
  if (!satisfied) return 'pending';
  return satisfied.status === 'True' ? 'satisfied' : 'unsatisfied';
}

export const PLACEMENT_STATE_HEALTH: Record<PlacementState, Health> = {
  satisfied: 'success',
  unsatisfied: 'warning',
  misconfigured: 'error',
  pending: 'unknown',
};

export const PLACEMENT_STATE_LABEL: Record<PlacementState, string> = {
  satisfied: 'Satisfied',
  unsatisfied: 'Not satisfied',
  misconfigured: 'Misconfigured',
  pending: 'Pending',
};

/** Decisions that belong to a placement (by the placement label, in the same namespace). */
export function decisionsOfPlacement(
  placement: { metadata: { name: string; namespace?: string } },
  decisions: PlacementDecisionJson[]
): PlacementDecisionJson[] {
  return decisions.filter(
    d =>
      d.metadata.namespace === placement.metadata.namespace &&
      d.metadata.labels?.[PLACEMENT_LABEL] === placement.metadata.name
  );
}

/** Selected cluster names of a set of decisions, without duplicates, in decision order. */
export function decidedClusters(decisions: PlacementDecisionJson[]): string[] {
  const out: string[] = [];
  for (const decision of decisions) {
    for (const d of decision.status?.decisions || []) {
      if (d.clusterName && !out.includes(d.clusterName)) out.push(d.clusterName);
    }
  }
  return out;
}

/** Placement name of a decision (from its label or its owner reference). */
export function placementOfDecision(decision: PlacementDecisionJson): string | undefined {
  return (
    decision.metadata.labels?.[PLACEMENT_LABEL] ||
    decision.metadata.ownerReferences?.find(o => o.kind === 'Placement')?.name
  );
}

/** Short human readable summary of a placement's selection rules. */
export function predicateCount(spec?: PlacementSpec): number {
  return (spec?.predicates || []).length;
}

// ----- AddOnPlacementScore -----

export interface AddOnPlacementScoreJson extends KubeJson {
  status?: {
    conditions?: Condition[];
    scores?: Array<{ name: string; value: number }>;
    validUntil?: string;
  };
}

// ----- PlacementRule (apps.open-cluster-management.io, legacy) -----

export interface PlacementRuleJson extends KubeJson {
  spec?: {
    clusterSelector?: LabelSelector;
    clusters?: Array<{ name: string }>;
    clusterReplicas?: number;
    clusterConditions?: Array<{ type?: string; status?: string }>;
    schedulerName?: string;
    policies?: ObjectReference[];
    resourceHint?: { type?: string; order?: string };
  };
  status?: { decisions?: Array<{ clusterName?: string; clusterNamespace?: string }> };
}
