/**
 * ManifestWork, ManifestWorkReplicaSet and AppliedManifestWork (work.open-cluster-management.io).
 */
import { Condition, findCondition, Health, KubeJson, Labels } from './common';

export const UPDATE_STRATEGIES = ['Update', 'CreateOnly', 'ServerSideApply', 'ReadOnly'] as const;
export const PROPAGATION_POLICIES = ['Foreground', 'Orphan', 'SelectivelyOrphan'] as const;
export const ROLLOUT_TYPES = ['All', 'Progressive', 'ProgressivePerGroup'] as const;
export const CASCADE_POLICIES = ['Background', 'Foreground'] as const;

export interface ResourceIdentifier {
  group?: string;
  resource: string;
  name: string;
  namespace?: string;
}

export interface ManifestConfig {
  resourceIdentifier: ResourceIdentifier;
  updateStrategy?: { type: string; serverSideApply?: { fieldManager?: string; force?: boolean } };
  feedbackRules?: Array<{ type: string; jsonPaths?: Array<{ name: string; path: string }> }>;
  [key: string]: unknown;
}

export interface ManifestWorkSpec {
  workload?: { manifests?: KubeJson[] };
  deleteOption?: {
    propagationPolicy?: string;
    selectivelyOrphans?: { orphaningRules?: ResourceIdentifier[] };
    ttlSecondsAfterFinished?: number;
  };
  manifestConfigs?: ManifestConfig[];
  executor?: { subject?: { type: string; serviceAccount?: { name: string; namespace: string } } };
}

export interface ManifestStatus {
  resourceMeta: {
    ordinal: number;
    group?: string;
    version?: string;
    kind?: string;
    resource?: string;
    name?: string;
    namespace?: string;
  };
  conditions?: Condition[];
  statusFeedback?: { values?: Array<{ name: string; fieldValue: FieldValue }> };
}

export interface FieldValue {
  type: 'Integer' | 'String' | 'Boolean' | 'JsonRaw' | string;
  integer?: number;
  string?: string;
  boolean?: boolean;
  jsonRaw?: string;
}

/** Display value of a status feedback field. */
export function feedbackValue(value: FieldValue | undefined): string {
  if (!value) return '';
  switch (value.type) {
    case 'Integer':
      return String(value.integer ?? '');
    case 'String':
      return value.string ?? '';
    case 'Boolean':
      return String(value.boolean ?? '');
    case 'JsonRaw':
      return value.jsonRaw ?? '';
    default:
      return '';
  }
}

export interface ManifestWorkJson extends KubeJson {
  spec?: ManifestWorkSpec;
  status?: {
    conditions?: Condition[];
    resourceStatus?: { manifests?: ManifestStatus[] };
  };
}

export type WorkState = 'available' | 'applied' | 'degraded' | 'failed' | 'progressing' | 'pending';

/**
 * Overall state of a ManifestWork from its conditions. A work that is applied but not (yet)
 * available is `applied`; Applied=False means the agent could not apply the manifests.
 */
export function workState(work: ManifestWorkJson): WorkState {
  const conditions = work.status?.conditions;
  if (findCondition(conditions, 'Degraded')?.status === 'True') return 'degraded';
  const applied = findCondition(conditions, 'Applied');
  if (applied?.status === 'False') return 'failed';
  const available = findCondition(conditions, 'Available');
  if (applied?.status === 'True' && available?.status === 'True') return 'available';
  if (findCondition(conditions, 'Progressing')?.status === 'True') return 'progressing';
  if (applied?.status === 'True') return 'applied';
  return 'pending';
}

export const WORK_STATE_HEALTH: Record<WorkState, Health> = {
  available: 'success',
  applied: 'success',
  degraded: 'error',
  failed: 'error',
  progressing: 'unknown',
  pending: 'warning',
};

export const WORK_STATE_LABEL: Record<WorkState, string> = {
  available: 'Available',
  applied: 'Applied',
  degraded: 'Degraded',
  failed: 'Apply failed',
  progressing: 'Progressing',
  pending: 'Pending',
};

/** The managed cluster a ManifestWork targets: works live in the cluster's namespace. */
export function workCluster(work: { metadata: { namespace?: string } }): string | undefined {
  return work.metadata.namespace;
}

export function manifestCount(work: ManifestWorkJson): number {
  return (work.spec?.workload?.manifests || []).length;
}

/** "Kind name" of each manifest, for compact lists. */
export function manifestSummaries(manifests: KubeJson[] | undefined): string[] {
  return (manifests || []).map(m => {
    const name = m?.metadata?.name || '?';
    const ns = m?.metadata?.namespace;
    return `${m?.kind || '?'} ${ns ? `${ns}/` : ''}${name}`;
  });
}

// ----- ManifestWorkReplicaSet -----

export const MWRS_LABEL = 'work.open-cluster-management.io/manifestworkreplicaset';

export interface MWRSSummary {
  total: number;
  applied: number;
  available: number;
  degraded: number;
  progressing: number;
  desiredTotal?: number;
  updated?: number;
}

export interface RolloutStrategy {
  type?: string;
  all?: { progressDeadline?: string; maxFailures?: string | number; minSuccessTime?: string };
  progressive?: {
    maxConcurrency?: string | number;
    mandatoryDecisionGroups?: Array<{ groupName?: string; groupIndex?: number }>;
    progressDeadline?: string;
    maxFailures?: string | number;
    minSuccessTime?: string;
  };
  progressivePerGroup?: {
    mandatoryDecisionGroups?: Array<{ groupName?: string; groupIndex?: number }>;
    progressDeadline?: string;
    maxFailures?: string | number;
    minSuccessTime?: string;
  };
}

export interface ManifestWorkReplicaSetJson extends KubeJson {
  spec?: {
    manifestWorkTemplate?: ManifestWorkSpec;
    placementRefs?: Array<{ name: string; rolloutStrategy?: RolloutStrategy }>;
    cascadeDeletionPolicy?: string;
  };
  status?: {
    conditions?: Condition[];
    summary?: Record<string, number>;
    placementSummary?: Array<{
      name?: string;
      availableDecisionGroups?: string;
      summary?: Record<string, number>;
    }>;
  };
}

/**
 * Normalizes an MWRS summary. OCM v1.1.0 renamed `Applied` to `applied`; older hubs report the
 * capitalized field, so both spellings are read.
 */
export function normalizeSummary(raw: Record<string, number> | undefined): MWRSSummary {
  const r = raw || {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const optional = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    total: num(r.total),
    applied: num(r.applied ?? r.Applied),
    available: num(r.available),
    degraded: num(r.degraded),
    progressing: num(r.progressing),
    desiredTotal: optional(r.desiredTotal),
    updated: optional(r.updated),
  };
}

export type MWRSState = 'available' | 'progressing' | 'degraded' | 'placement-missing' | 'pending';

export function mwrsState(mwrs: ManifestWorkReplicaSetJson): MWRSState {
  const conditions = mwrs.status?.conditions;
  if (findCondition(conditions, 'PlacementVerified')?.status === 'False') {
    return 'placement-missing';
  }
  const summary = normalizeSummary(mwrs.status?.summary);
  if (summary.degraded > 0) return 'degraded';
  if (summary.total > 0 && summary.available === summary.total) return 'available';
  if (summary.total > 0) return 'progressing';
  return 'pending';
}

export const MWRS_STATE_HEALTH: Record<MWRSState, Health> = {
  available: 'success',
  progressing: 'unknown',
  degraded: 'error',
  'placement-missing': 'error',
  pending: 'warning',
};

export const MWRS_STATE_LABEL: Record<MWRSState, string> = {
  available: 'Available',
  progressing: 'Progressing',
  degraded: 'Degraded',
  'placement-missing': 'Placement not found',
  pending: 'Pending',
};

/** ManifestWorks created by an MWRS (labelled with "<namespace>.<name>"). */
export function worksOfReplicaSet(
  mwrs: { metadata: { name: string; namespace?: string } },
  works: Array<{ metadata: { labels?: Labels } }>
) {
  const value = `${mwrs.metadata.namespace}.${mwrs.metadata.name}`;
  return works.filter(w => w.metadata.labels?.[MWRS_LABEL] === value);
}

// ----- AppliedManifestWork -----

export interface AppliedManifestWorkJson extends KubeJson {
  spec?: { hubHash?: string; agentID?: string; manifestWorkName?: string };
  status?: {
    appliedResources?: Array<{
      group?: string;
      version?: string;
      resource?: string;
      namespace?: string;
      name?: string;
      uid?: string;
    }>;
    evictionStartTime?: string;
  };
}
