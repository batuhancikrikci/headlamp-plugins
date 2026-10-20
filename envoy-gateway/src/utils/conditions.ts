import { PolicyCondition, PolicyStatus } from '../resources/types';

export type Health = 'success' | 'warning' | 'error' | 'unknown';

/** Condition types that describe the "main" state of an Envoy Gateway resource, in priority order. */
const PRIMARY_TYPES = ['Accepted', 'Programmed', 'Ready', 'ResolvedRefs'];

export interface ConditionSummary {
  health: Health;
  /** Primary condition (worst one when there are several ancestors). */
  primary?: PolicyCondition;
  /** Number of ancestors that accepted the policy (only for policy-attachment CRDs). */
  acceptedCount: number;
  /** Number of ancestors reported in status (0 if the CRD does not use ancestors). */
  ancestorCount: number;
}

/** Picks the most relevant condition from a list. */
export function getPrimaryCondition(conditions?: PolicyCondition[]): PolicyCondition | undefined {
  if (!conditions || conditions.length === 0) return undefined;
  for (const type of PRIMARY_TYPES) {
    const found = conditions.find(c => c.type === type);
    if (found) return found;
  }
  return conditions[0];
}

export function conditionHealth(condition?: PolicyCondition): Health {
  if (!condition) return 'unknown';
  if (condition.status === 'True') return 'success';
  if (condition.status === 'False') return 'error';
  return 'warning';
}

const HEALTH_RANK: Record<Health, number> = { error: 3, warning: 2, unknown: 1, success: 0 };

/** Returns the worse of two health values. */
export function worstHealth(a: Health, b: Health): Health {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

/**
 * Summarizes the status of an Envoy Gateway resource. For policy CRDs every ancestor is taken
 * into account, so a policy that is rejected by one of several Gateways is reported as failing.
 */
export function summarizeStatus(status?: PolicyStatus): ConditionSummary {
  const ancestors = status?.ancestors || [];
  let health: Health = 'unknown';
  let primary: PolicyCondition | undefined;
  let acceptedCount = 0;

  if (ancestors.length > 0) {
    for (const ancestor of ancestors) {
      const cond = getPrimaryCondition(ancestor.conditions);
      const h = conditionHealth(cond);
      if (cond?.type === 'Accepted' && cond.status === 'True') acceptedCount++;
      if (!primary || HEALTH_RANK[h] > HEALTH_RANK[conditionHealth(primary)]) {
        primary = cond;
      }
      health = health === 'unknown' ? h : worstHealth(health, h);
    }
  }

  const own = getPrimaryCondition(status?.conditions);
  if (own) {
    const h = conditionHealth(own);
    if (!primary || HEALTH_RANK[h] > HEALTH_RANK[conditionHealth(primary)]) {
      primary = own;
    }
    health = health === 'unknown' ? h : worstHealth(health, h);
  }

  return { health, primary, acceptedCount, ancestorCount: ancestors.length };
}

/** A stable sort/search value for the status column. */
export function statusSortValue(summary: ConditionSummary): string {
  const rank = { error: 0, warning: 1, unknown: 2, success: 3 }[summary.health];
  return `${rank}-${summary.primary?.type || ''}-${summary.primary?.reason || ''}`;
}

/** Flattens own and ancestor conditions into a single list (used for problem detection). */
export function allConditions(status?: PolicyStatus): PolicyCondition[] {
  return [
    ...(status?.conditions || []),
    ...(status?.ancestors || []).flatMap(a => a.conditions || []),
  ];
}
