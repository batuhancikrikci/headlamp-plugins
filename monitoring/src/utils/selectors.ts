import {
  Labels,
  LabelSelector,
  LabelSelectorRequirement,
  MonitorNamespaceSelector,
} from '../types';

/**
 * What a missing (null/undefined) selector means depends on the field:
 *  - Prometheus.spec.serviceMonitorSelector (and friends): nil selects NOTHING.
 *  - Prometheus.spec.serviceMonitorNamespaceSelector: nil selects only the
 *    Prometheus object's own namespace (handled in relations.ts).
 *  - ServiceMonitor.spec.selector: required; {} selects EVERYTHING.
 * An empty selector ({}) always selects everything.
 */
export type NilSelectorMeaning = 'all' | 'none';

export function isSelectorEmpty(selector?: LabelSelector | null): boolean {
  if (!selector) return true;
  const labels = selector.matchLabels ? Object.keys(selector.matchLabels).length : 0;
  const exprs = selector.matchExpressions ? selector.matchExpressions.length : 0;
  return labels === 0 && exprs === 0;
}

function matchesRequirement(req: LabelSelectorRequirement, labels: Labels): boolean {
  const has = Object.prototype.hasOwnProperty.call(labels, req.key);
  const value = labels[req.key];
  const values = req.values || [];
  switch (req.operator) {
    case 'In':
      return has && values.includes(value);
    case 'NotIn':
      return !has || !values.includes(value);
    case 'Exists':
      return has;
    case 'DoesNotExist':
      return !has;
    default:
      return false;
  }
}

/** Kubernetes label selector semantics (matchLabels AND matchExpressions). */
export function matchesLabelSelector(
  selector: LabelSelector | null | undefined,
  labels: Labels | undefined,
  nilMeaning: NilSelectorMeaning = 'all'
): boolean {
  if (selector === null || selector === undefined) return nilMeaning === 'all';
  const l = labels || {};
  for (const [k, v] of Object.entries(selector.matchLabels || {})) {
    if (l[k] !== v) return false;
  }
  for (const req of selector.matchExpressions || []) {
    if (!matchesRequirement(req, l)) return false;
  }
  return true;
}

/** Human readable form, e.g. `app=foo, tier in (a,b), !legacy`. */
export function selectorToString(selector?: LabelSelector | null): string {
  if (!selector) return '';
  const parts: string[] = Object.entries(selector.matchLabels || {}).map(([k, v]) => `${k}=${v}`);
  for (const req of selector.matchExpressions || []) {
    const values = (req.values || []).join(',');
    switch (req.operator) {
      case 'In':
        parts.push(`${req.key} in (${values})`);
        break;
      case 'NotIn':
        parts.push(`${req.key} notin (${values})`);
        break;
      case 'Exists':
        parts.push(req.key);
        break;
      case 'DoesNotExist':
        parts.push(`!${req.key}`);
        break;
      default:
        parts.push(`${req.key} ${req.operator} (${values})`);
    }
  }
  return parts.join(', ');
}

/**
 * ServiceMonitor/PodMonitor/Probe namespaceSelector:
 *  - any: true         -> every namespace
 *  - matchNames: [...]  -> the listed namespaces
 *  - otherwise          -> only the monitor's own namespace
 */
export function monitorNamespaceMatches(
  monitorNamespace: string | undefined,
  nsSelector: MonitorNamespaceSelector | undefined,
  targetNamespace: string | undefined
): boolean {
  if (nsSelector?.any) return true;
  if (nsSelector?.matchNames && nsSelector.matchNames.length > 0) {
    return !!targetNamespace && nsSelector.matchNames.includes(targetNamespace);
  }
  return monitorNamespace === targetNamespace;
}

/** Converts a selector's matchLabels into a Service/Pod labels object for previews. */
export function selectorLabels(selector?: LabelSelector | null): Labels {
  return { ...(selector?.matchLabels || {}) };
}
