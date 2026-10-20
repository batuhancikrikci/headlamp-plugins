/**
 * Label and claim selector evaluation, used by the placement preview, the cluster set
 * membership view and the forms.
 */
import {
  ClaimSelector,
  Labels,
  LabelSelector,
  SelectorRequirement,
} from '../resources/models/common';

export function matchesRequirement(values: Labels, req: SelectorRequirement): boolean {
  const has = Object.prototype.hasOwnProperty.call(values, req.key);
  const value = values[req.key];
  switch (req.operator) {
    case 'In':
      return has && (req.values || []).includes(value);
    case 'NotIn':
      return !has || !(req.values || []).includes(value);
    case 'Exists':
      return has;
    case 'DoesNotExist':
      return !has;
    default:
      // Unknown operators never match, like the API server rejecting them.
      return false;
  }
}

/**
 * Whether a label set matches a selector. An empty selector ({}) matches everything; a missing
 * selector (undefined) also matches everything, which is how OCM treats an omitted
 * labelSelector inside a predicate.
 */
export function matchesSelector(
  labels: Labels | undefined,
  selector?: LabelSelector | null
): boolean {
  if (!selector) return true;
  const values = labels || {};
  for (const [k, v] of Object.entries(selector.matchLabels || {})) {
    if (values[k] !== v) return false;
  }
  return (selector.matchExpressions || []).every(req => matchesRequirement(values, req));
}

export function matchesClaimSelector(claims: Labels, selector?: ClaimSelector | null): boolean {
  if (!selector) return true;
  return (selector.matchExpressions || []).every(req => matchesRequirement(claims, req));
}

export function isSelectorEmpty(selector?: LabelSelector | null): boolean {
  return (
    !selector ||
    (Object.keys(selector.matchLabels || {}).length === 0 &&
      (selector.matchExpressions || []).length === 0)
  );
}

/** Human readable requirement, e.g. "env in (prod, stage)". */
export function requirementText(req: SelectorRequirement): string {
  const values = (req.values || []).join(', ');
  switch (req.operator) {
    case 'Exists':
      return req.key;
    case 'DoesNotExist':
      return `!${req.key}`;
    case 'In':
      return `${req.key} in (${values})`;
    case 'NotIn':
      return `${req.key} notin (${values})`;
    default:
      return `${req.key} ${req.operator} (${values})`;
  }
}

/** Chips for a label selector: "key=value" for matchLabels plus one per expression. */
export function selectorTexts(selector?: LabelSelector | null): string[] {
  if (!selector) return [];
  return [
    ...Object.entries(selector.matchLabels || {}).map(([k, v]) => `${k}=${v}`),
    ...(selector.matchExpressions || []).map(requirementText),
  ];
}

const LABEL_NAME_RE = /^([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]$/;
const DNS_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** Kubernetes qualified name: optional DNS subdomain prefix + "/" + name (max 63). */
export function isValidLabelKey(key: string): boolean {
  if (!key) return false;
  const parts = key.split('/');
  if (parts.length > 2) return false;
  const name = parts[parts.length - 1];
  if (name.length > 63 || !LABEL_NAME_RE.test(name)) return false;
  if (parts.length === 2) {
    const prefix = parts[0];
    return prefix.length > 0 && prefix.length <= 253 && DNS_SUBDOMAIN_RE.test(prefix);
  }
  return true;
}

export function isValidLabelValue(value: string): boolean {
  return value === '' || (value.length <= 63 && LABEL_NAME_RE.test(value));
}

/** Problems of a selector, as messages with placeholders. */
export function selectorProblems(
  selector: LabelSelector | ClaimSelector | undefined,
  where: string
): Array<{ key: string; params?: Record<string, unknown> }> {
  const problems: Array<{ key: string; params?: Record<string, unknown> }> = [];
  if (!selector) return problems;
  const labels = (selector as LabelSelector).matchLabels || {};
  for (const [k, v] of Object.entries(labels)) {
    if (!isValidLabelKey(k))
      problems.push({ key: '{{where}}: invalid label key "{{k}}"', params: { where, k } });
    if (!isValidLabelValue(v)) {
      problems.push({ key: '{{where}}: invalid label value "{{v}}"', params: { where, v } });
    }
  }
  for (const req of selector.matchExpressions || []) {
    if (!req.key) {
      problems.push({ key: '{{where}}: every expression needs a key', params: { where } });
    }
    const needsValues = req.operator === 'In' || req.operator === 'NotIn';
    if (needsValues && (req.values || []).length === 0) {
      problems.push({
        key: '{{where}}: "{{key}}" with operator {{op}} needs at least one value',
        params: { where, key: req.key, op: req.operator },
      });
    }
    if (!needsValues && (req.values || []).length > 0) {
      problems.push({
        key: '{{where}}: "{{key}}" with operator {{op}} must not have values',
        params: { where, key: req.key, op: req.operator },
      });
    }
  }
  return problems;
}
