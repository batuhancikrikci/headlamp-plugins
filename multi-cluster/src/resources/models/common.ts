/**
 * Shared JSON types and helpers. Everything under resources/models is free of Headlamp runtime
 * imports so it can be unit tested.
 */

export type Labels = Record<string, string>;

export type SelectorOperator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';

export interface SelectorRequirement {
  key: string;
  operator: SelectorOperator | string;
  values?: string[];
}

export interface LabelSelector {
  matchLabels?: Labels;
  matchExpressions?: SelectorRequirement[];
}

/** Selector on cluster claims (`status.clusterClaims`); only expressions are supported. */
export interface ClaimSelector {
  matchExpressions?: SelectorRequirement[];
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export type Health = 'success' | 'warning' | 'error' | 'unknown';

export interface Metadata {
  name: string;
  namespace?: string;
  labels?: Labels;
  annotations?: Labels;
  uid?: string;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  generation?: number;
  ownerReferences?: Array<{ kind: string; name: string; apiVersion?: string; uid?: string }>;
  [key: string]: unknown;
}

/** An object as edited by the forms and the YAML editor. */
export type { KubeJson } from '../../common/form/types';

export interface ObjectReference {
  apiVersion?: string;
  kind?: string;
  name?: string;
  namespace?: string;
}

export function findCondition(
  conditions: Condition[] | undefined,
  type: string
): Condition | undefined {
  return (conditions || []).find(c => c.type === type);
}

export function isConditionTrue(conditions: Condition[] | undefined, type: string): boolean {
  return findCondition(conditions, type)?.status === 'True';
}

export type ConditionPolarity = 'positive' | 'problem' | 'info';

/**
 * Health of a single condition. `problem` conditions are bad when True (e.g. Degraded); `info`
 * conditions (e.g. Progressing) describe activity and are never colored as good or bad.
 */
export function conditionHealth(condition: Condition, polarity: ConditionPolarity): Health {
  if (condition.status === 'Unknown' || polarity === 'info') return 'unknown';
  const isTrue = condition.status === 'True';
  if (polarity === 'problem') return isTrue ? 'error' : 'success';
  return isTrue ? 'success' : 'error';
}

/** Condition types that describe problems (True is bad). */
const PROBLEM_CONDITIONS = new Set([
  'Degraded',
  'HubDeniedManagedCluster',
  'HubRegistrationDegraded',
  'HubPlacementDegraded',
  'PlacementMisconfigured',
  'HubConnectionDegraded',
  'RegistrationDesiredDegraded',
  'WorkDesiredDegraded',
]);

/** Condition types that describe activity rather than health. */
const INFO_CONDITIONS = new Set(['Progressing', 'ClusterSetEmpty', 'Deleting', 'Complete']);

export function conditionPolarity(type: string): ConditionPolarity {
  if (PROBLEM_CONDITIONS.has(type)) return 'problem';
  if (INFO_CONDITIONS.has(type)) return 'info';
  return 'positive';
}

/** Parses an integer-like value (several OCM summaries store counts as strings). */
export function toCount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return 0;
}

/** "namespace/name" or "name". */
export function qualifiedName(meta: { name: string; namespace?: string }): string {
  return meta.namespace ? `${meta.namespace}/${meta.name}` : meta.name;
}
