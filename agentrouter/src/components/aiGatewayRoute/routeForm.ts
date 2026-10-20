/**
 * Form model, validation and spec generation for AIGatewayRoute rules.
 * Pure (no Headlamp runtime imports) so it can be unit tested.
 *
 * Upstream constraints (AIGatewayRouteRuleBackendRef, v0.5 – v1.1):
 * - A backendRef is either an AIServiceBackend (group/kind omitted) or an InferencePool
 *   (group inference.networking.k8s.io, kind InferencePool); nothing else is accepted.
 * - A rule that references an InferencePool must contain exactly that one backendRef.
 * - modelNameOverride, priority and mutations are ignored for InferencePool references.
 * - Cross-namespace references require a ReferenceGrant in the target namespace.
 */
import type { AIGatewayRouteRule } from '../../resources/aiGatewayRoute';
import { AI_MODEL_HEADER, INFERENCE_POOL_GROUP, INFERENCE_POOL_KIND } from '../../resources/common';
import type { CostForm } from '../../utils/costForm';
import { toLLMRequestCosts } from '../../utils/costForm';
import { splitList, validateName } from '../../utils/forms';
import { GatewayRefForm, gatewayRefsFromSpec, toParentRefs } from '../../utils/gatewayRefs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type RuleBackendType = 'AIServiceBackend' | 'InferencePool';

export interface BackendRefForm {
  name: string;
  namespace: string;
  weight: string;
  priority: string;
  modelNameOverride: string;
  /** backendRef this row was loaded from (keeps header/body mutations etc.). */
  original?: Json;
}

export interface InferencePoolRefForm {
  name: string;
  namespace: string;
  original?: Json;
}

export interface RuleForm {
  name: string;
  models: string;
  backendType: RuleBackendType;
  /** Used when backendType is AIServiceBackend. */
  backends: BackendRefForm[];
  /** Used when backendType is InferencePool. */
  pool: InferencePoolRefForm;
  requestTimeout: string;
  /** Rule this row was loaded from; fields the form does not manage are kept. */
  original?: Json;
  /**
   * True when the existing matches are more than exact model-name matches (several headers,
   * other headers, regular expressions). They are shown read-only and kept.
   */
  advancedMatches?: boolean;
}

/** Gateway API Duration, e.g. 30s, 1m, 500ms, 1h30m. */
const DURATION = /^([0-9]{1,5}(h|m|s|ms)){1,4}$/;

export const newBackend = (): BackendRefForm => ({
  name: '',
  namespace: '',
  weight: '',
  priority: '',
  modelNameOverride: '',
});

export const newRule = (): RuleForm => ({
  name: '',
  models: '',
  backendType: 'AIServiceBackend',
  backends: [newBackend()],
  pool: { name: '', namespace: '' },
  requestTimeout: '',
});

function optionalInt(v: string, field: string, errors: string[]) {
  if (v === '') return;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) errors.push(`${field} must be an integer ≥ 0.`);
}

function optionalNamespace(ns: string, field: string, errors: string[]) {
  const e = ns && validateName(ns, field);
  if (e) errors.push(e);
}

export function ruleErrors(rules: RuleForm[]): string[] {
  const errors: string[] = [];
  if (rules.length === 0) errors.push('At least one rule is required.');
  rules.forEach((r, i) => {
    const label = `Rule ${i + 1}`;
    if (r.backendType === 'InferencePool') {
      const e = validateName(r.pool.name, `${label} InferencePool`);
      if (e) errors.push(e);
      optionalNamespace(r.pool.namespace, `${label} InferencePool namespace`, errors);
    } else {
      const named = r.backends.filter(b => b.name);
      if (named.length === 0) errors.push(`${label}: at least one Service Backend is required.`);
      r.backends.forEach((b, j) => {
        const field = `${label} backend #${j + 1}`;
        if (b.name) {
          const e = validateName(b.name, `${field} name`);
          if (e) errors.push(e);
        }
        optionalNamespace(b.namespace, `${field} namespace`, errors);
        optionalInt(b.weight, `${field} weight`, errors);
        optionalInt(b.priority, `${field} priority`, errors);
      });
    }
    if (r.requestTimeout && !DURATION.test(r.requestTimeout)) {
      errors.push(`${label}: timeout must be a duration such as 60s or 2m.`);
    }
  });
  return errors;
}

/** Namespace to write on a backendRef: omitted when it equals the route's namespace. */
const refNamespace = (ns: string, routeNamespace: string) =>
  ns && ns !== routeNamespace ? ns : undefined;

/** True when any rule points outside the route namespace (a ReferenceGrant is then needed). */
export function hasCrossNamespaceRefs(rules: RuleForm[], routeNamespace: string): boolean {
  return rules.some(r =>
    r.backendType === 'InferencePool'
      ? !!refNamespace(r.pool.namespace, routeNamespace)
      : r.backends.some(b => b.name && !!refNamespace(b.namespace, routeNamespace))
  );
}

function setOrDelete(obj: Json, key: string, value: unknown) {
  const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) delete obj[key];
  else obj[key] = value;
}

/** namespace field for a ref: keeps the original spelling when the target did not change. */
function refNamespaceField(ref: Json, ns: string, original: Json | undefined, routeNs: string) {
  const want = ns || routeNs;
  if (original && (original.namespace || routeNs) === want) return;
  setOrDelete(ref, 'namespace', refNamespace(ns, routeNs));
}

/** Exact model names of a rule, or null when its matches are not plain model matches. */
export function ruleModels(rule: Json): string[] | null {
  const matches: Json[] = rule.matches || [];
  const models: string[] = [];
  for (const m of matches) {
    const headers: Json[] = m.headers || [];
    const h = headers[0];
    const plain =
      Object.keys(m).length === 1 &&
      headers.length === 1 &&
      h.name?.toLowerCase() === AI_MODEL_HEADER &&
      (!h.type || h.type === 'Exact') &&
      h.value;
    if (!plain) return null;
    models.push(h.value);
  }
  return models;
}

function buildRule(r: RuleForm, routeNamespace: string): Json {
  const rule: Json = JSON.parse(JSON.stringify(r.original || {}));
  setOrDelete(rule, 'name', r.name);

  if (!r.advancedMatches) {
    const models = splitList(r.models);
    const before = r.original ? ruleModels(r.original) : null;
    const unchanged = before && before.join('\n') === models.join('\n');
    if (!unchanged) {
      setOrDelete(
        rule,
        'matches',
        models.map(model => ({
          headers: [{ type: 'Exact' as const, name: AI_MODEL_HEADER, value: model }],
        }))
      );
    }
  }

  if (r.backendType === 'InferencePool') {
    const o = r.pool.original;
    const ref: Json = {
      ...(o || {}),
      group: INFERENCE_POOL_GROUP,
      kind: INFERENCE_POOL_KIND,
      name: r.pool.name,
    };
    refNamespaceField(ref, r.pool.namespace, o, routeNamespace);
    rule.backendRefs = [ref];
  } else {
    rule.backendRefs = r.backends
      .filter(b => b.name)
      .map(b => {
        const ref: Json = JSON.parse(JSON.stringify(b.original || {}));
        ref.name = b.name;
        refNamespaceField(ref, b.namespace, b.original, routeNamespace);
        setOrDelete(ref, 'weight', b.weight === '' ? undefined : Number(b.weight));
        setOrDelete(ref, 'priority', b.priority === '' ? undefined : Number(b.priority));
        setOrDelete(ref, 'modelNameOverride', b.modelNameOverride);
        return ref;
      });
  }

  const timeouts: Json = { ...(rule.timeouts || {}) };
  setOrDelete(timeouts, 'request', r.requestTimeout);
  if (Object.keys(timeouts).length > 0) rule.timeouts = timeouts;
  else delete rule.timeouts;
  return rule;
}

/** Converts the form rules to AIGatewayRoute spec rules (layered over loaded rules). */
export function toRouteRules(rules: RuleForm[], routeNamespace: string): AIGatewayRouteRule[] {
  return rules.map(r => buildRule(r, routeNamespace) as AIGatewayRouteRule);
}

// ─── Edit support ──────────────────────────────────────────────────────────

export interface RouteForm {
  name: string;
  namespace: string;
  gateways: GatewayRefForm[];
  hostnames: string;
  rules: RuleForm[];
  costs: CostForm[];
}

function ruleFromSpec(rule: Json): RuleForm {
  const refs: Json[] = rule.backendRefs || [];
  const models = ruleModels(rule);
  const pool = refs.length === 1 && refs[0].kind === INFERENCE_POOL_KIND ? refs[0] : undefined;
  return {
    ...newRule(),
    name: rule.name || '',
    models: (models || []).join(', '),
    advancedMatches: models === null,
    backendType: pool ? 'InferencePool' : 'AIServiceBackend',
    pool: pool
      ? { name: pool.name, namespace: pool.namespace || '', original: pool }
      : { name: '', namespace: '' },
    backends: pool
      ? [newBackend()]
      : refs.map(ref => ({
          name: ref.name || '',
          namespace: ref.namespace || '',
          weight: ref.weight !== undefined ? String(ref.weight) : '',
          priority: ref.priority !== undefined ? String(ref.priority) : '',
          modelNameOverride: ref.modelNameOverride || '',
          original: ref,
        })),
    requestTimeout: rule.timeouts?.request || '',
    original: rule,
  };
}

/** Pre-fills the route form from an existing AIGatewayRoute. */
export function formFromRoute(json: Json): RouteForm {
  const spec: Json = json.spec || {};
  return {
    name: json.metadata?.name || '',
    namespace: json.metadata?.namespace || '',
    gateways: gatewayRefsFromSpec(spec.parentRefs),
    hostnames: (spec.hostnames || []).join(', '),
    rules: (spec.rules || []).map(ruleFromSpec),
    costs: (spec.llmRequestCosts || []).map((c: Json) => ({
      metadataKey: c.metadataKey || '',
      type: c.type || 'TotalToken',
      cel: c.cel || '',
    })),
  };
}

/** Spec for the form, layered over `original` (empty when creating). */
export function toRouteSpec(form: RouteForm, original?: Json): Json {
  const spec: Json = JSON.parse(JSON.stringify(original || {}));
  spec.parentRefs = toParentRefs(form.gateways, form.namespace);
  setOrDelete(spec, 'hostnames', splitList(form.hostnames));
  spec.rules = toRouteRules(form.rules, form.namespace);
  setOrDelete(
    spec,
    'llmRequestCosts',
    toLLMRequestCosts(form.costs).map(c =>
      c.cel ? c : { metadataKey: c.metadataKey, type: c.type }
    )
  );
  return spec;
}

/** One-line description of a rule's targets for the review summary. */
export function describeRuleTargets(r: RuleForm): string {
  if (r.backendType === 'InferencePool') {
    return r.pool.name ? `InferencePool ${r.pool.name}` : '-';
  }
  return (
    r.backends
      .filter(b => b.name)
      .map(b => b.name)
      .join(', ') || '-'
  );
}
