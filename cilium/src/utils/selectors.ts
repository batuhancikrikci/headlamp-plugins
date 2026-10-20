/**
 * Label selector helpers with Cilium semantics: keys may carry a label source prefix
 * ("k8s:app", "any:app") and selectors written against "reserved:" labels never match pods.
 */
import { Labels, LabelSelector, LabelSelectorRequirement } from '../resources/types';

/**
 * What a missing (null/undefined) selector means depends on the field, e.g. a missing
 * `serviceSelector` on an LB IP pool selects every service, while a missing `advertisements`
 * selector on a BGP family selects nothing. An empty selector ({}) always selects everything.
 */
export type NilSelectorMeaning = 'all' | 'none';

const SOURCE_RE = /^(k8s|any|unspec):/;
const RESERVED_RE = /^reserved:/;

/** Removes the label source prefix that Cilium allows in selector keys. */
export function normalizeKey(key: string): string {
  return key.replace(SOURCE_RE, '');
}

export function isSelectorEmpty(selector?: LabelSelector | null): boolean {
  if (!selector) return true;
  const labels = selector.matchLabels ? Object.keys(selector.matchLabels).length : 0;
  const exprs = selector.matchExpressions ? selector.matchExpressions.length : 0;
  return labels === 0 && exprs === 0;
}

/** Keys a selector constrains, without label source prefixes. */
export function selectorKeys(selector?: LabelSelector | null): string[] {
  if (!selector) return [];
  return [
    ...Object.keys(selector.matchLabels || {}),
    ...(selector.matchExpressions || []).map(e => e.key),
  ].map(normalizeKey);
}

function matchesRequirement(req: LabelSelectorRequirement, labels: Labels): boolean {
  if (RESERVED_RE.test(req.key)) return false;
  const key = normalizeKey(req.key);
  const has = Object.prototype.hasOwnProperty.call(labels, key);
  const value = labels[key];
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
  for (const [rawKey, value] of Object.entries(selector.matchLabels || {})) {
    if (RESERVED_RE.test(rawKey)) return false;
    if (l[normalizeKey(rawKey)] !== value) return false;
  }
  for (const req of selector.matchExpressions || []) {
    if (!matchesRequirement(req, l)) return false;
  }
  return true;
}

/** Human readable form, e.g. `app=foo, tier in (a,b), !legacy`. */
export function selectorToString(selector?: LabelSelector | null): string {
  if (!selector) return '';
  const parts: string[] = Object.entries(selector.matchLabels || {}).map(([k, v]) =>
    v === '' ? k : `${k}=${v}`
  );
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

/** Qualified label key: optional source prefix, optional DNS prefix, then the name. */
const KEY_RE =
  /^([a-z0-9]+:)?([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const VALUE_RE = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;

export function isValidLabelKey(key: string): boolean {
  return key.length > 0 && key.length <= 317 && KEY_RE.test(key);
}

export function isValidLabelValue(value: string): boolean {
  return value.length <= 63 && VALUE_RE.test(value);
}

/** Returns the problems of a selector as plain messages (empty when valid). */
export function selectorProblems(selector?: LabelSelector | null): string[] {
  const problems: string[] = [];
  if (!selector) return problems;
  for (const [key, value] of Object.entries(selector.matchLabels || {})) {
    if (!isValidLabelKey(key)) problems.push(`Invalid label key "${key}"`);
    else if (!isValidLabelValue(value)) problems.push(`Invalid value for label "${key}"`);
  }
  for (const req of selector.matchExpressions || []) {
    if (!req.key || !isValidLabelKey(req.key)) {
      problems.push(`Invalid expression key "${req.key || ''}"`);
      continue;
    }
    const needsValues = req.operator === 'In' || req.operator === 'NotIn';
    if (needsValues && !(req.values || []).length) {
      problems.push(`Expression "${req.key} ${req.operator}" needs at least one value`);
    }
    if (!needsValues && (req.values || []).length) {
      problems.push(`Expression "${req.key} ${req.operator}" must not have values`);
    }
  }
  return problems;
}
