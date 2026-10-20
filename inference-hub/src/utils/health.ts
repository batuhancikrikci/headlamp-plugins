/**
 * Health model shared by all Inference Hub views: one of five states with consistent colors.
 */
import { Condition } from '../resources/types';

export type Health = 'ready' | 'progressing' | 'failed' | 'stopped' | 'unknown';

export interface HealthSummary {
  health: Health;
  /** Short reason, e.g. "MinimumReplicasUnavailable". */
  reason?: string;
  message?: string;
}

export const HEALTH_META: Record<
  Health,
  { label: string; color: 'success' | 'info' | 'error' | 'default' | 'warning'; icon: string }
> = {
  ready: { label: 'Ready', color: 'success', icon: 'mdi:check-circle' },
  progressing: { label: 'Deploying', color: 'info', icon: 'mdi:progress-clock' },
  failed: { label: 'Failed', color: 'error', icon: 'mdi:alert-circle' },
  stopped: { label: 'Stopped', color: 'default', icon: 'mdi:stop-circle-outline' },
  unknown: { label: 'Unknown', color: 'warning', icon: 'mdi:help-circle-outline' },
};

/** Reasons and messages that indicate a failure rather than a rollout in progress. */
const FAILURE_RE =
  /fail|error|invalid|crashloop|backoff|deadline|unschedulable|imagepull|errimage|oomkilled|forbidden|notfound|not found|denied|quota|insufficient|conflict|refused/i;

export function findCondition(conditions: Condition[] | undefined, type: string) {
  return conditions?.find(c => c.type === type);
}

export function isFailure(text?: string): boolean {
  return !!text && FAILURE_RE.test(text);
}

/**
 * Classifies an object from its conditions.
 *
 * - Ready=True → ready.
 * - A failing Ready condition, or another False condition whose reason/message looks like a
 *   failure → failed (the most specific condition is reported).
 * - Ready=False/Unknown otherwise → progressing.
 * - No conditions → progressing when the object is new (< 2 min), unknown otherwise.
 */
export function classifyConditions(
  conditions: Condition[] | undefined,
  opts: { readyType?: string; createdAt?: string; now?: number } = {}
): HealthSummary {
  const readyType = opts.readyType || 'Ready';
  const ready = findCondition(conditions, readyType);
  if (ready?.status === 'True') return { health: 'ready', reason: ready.reason };

  const failing = (conditions || []).find(
    c =>
      c.type !== readyType &&
      c.status === 'False' &&
      c.severity !== 'Info' &&
      c.severity !== 'Warning' &&
      (isFailure(c.reason) || isFailure(c.message))
  );
  if (failing)
    return { health: 'failed', reason: failing.reason || failing.type, message: failing.message };
  if (ready && (isFailure(ready.reason) || isFailure(ready.message))) {
    return { health: 'failed', reason: ready.reason, message: ready.message };
  }
  if (ready) return { health: 'progressing', reason: ready.reason, message: ready.message };

  const created = opts.createdAt ? Date.parse(opts.createdAt) : NaN;
  const now = opts.now ?? Date.now();
  if (!conditions?.length && isFinite(created) && now - created < 120000) {
    return { health: 'progressing', reason: 'Pending' };
  }
  return { health: 'unknown' };
}
