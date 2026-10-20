/**
 * Form model, validation and spec generation for QuotaPolicy (aigateway.envoyproxy.io/v1alpha1).
 * Pure (no Headlamp runtime imports) so it can be unit tested.
 *
 * Upstream rules (API v1.1.0 + "Quota Policy" docs):
 * - targetRefs: AIServiceBackends in the same namespace, at most 16.
 * - perModelQuotas[].modelName must equal the `modelNameOverride` of the AIGatewayRoute
 *   backendRef that sends traffic to the targeted backend, otherwise the quota is silently
 *   not applied.
 * - duration is exactly one of 1s / 1m / 1h / 1d.
 * - Cost expressions are CEL over unsigned token counters: integer literals need a `u`
 *   suffix (e.g. `output_tokens * 6u`). Empty means `total_tokens`.
 * - Bucket rule client selectors: only `headers` are honored (Exact, Distinct,
 *   RegularExpression); at most 8 selectors per rule. shadowMode exists only on rules.
 * - mode: only `Shared` exists (and is the default), so it is not written.
 * - serviceQuota is accepted by the API but NOT enforced yet.
 */
import type { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import type { QuotaPolicy } from '../../resources/quotaPolicy';
import { isAIServiceBackendRef } from '../../utils/crossReference';
import { validateName } from '../../utils/forms';

export type QuotaDuration = '1s' | '1m' | '1h' | '1d';

export const QUOTA_DURATIONS: Array<{ value: QuotaDuration; label: string }> = [
  { value: '1s', label: 'per second' },
  { value: '1m', label: 'per minute' },
  { value: '1h', label: 'per hour' },
  { value: '1d', label: 'per day' },
];

export type HeaderMatchType = 'Exact' | 'Distinct' | 'RegularExpression';

export interface HeaderConditionForm {
  name: string;
  type: HeaderMatchType;
  value: string;
  invert: boolean;
  /** False when an existing object relied on the default (Exact); keeps round-trips exact. */
  explicitType?: boolean;
}

export interface BucketRuleForm {
  headers: HeaderConditionForm[];
  limit: string;
  duration: QuotaDuration;
  shadowMode: boolean;
  /**
   * Set for existing rules the form cannot express (several selectors, or CIDR/method/path
   * selectors). They are shown read-only and written back unchanged.
   */
  preserved?: Record<string, unknown>;
}

export type CostPresetId = 'total' | 'inputOutput' | 'weighted' | 'custom';

export const COST_PRESETS: Array<{ id: CostPresetId; label: string; expression?: string }> = [
  { id: 'total', label: 'Total tokens (default)' },
  { id: 'inputOutput', label: 'Input + output tokens', expression: 'input_tokens + output_tokens' },
  {
    id: 'weighted',
    label: 'Weighted: cached input 1/10, output ×6',
    expression: 'input_tokens + cached_input_tokens / 10u + output_tokens * 6u',
  },
  { id: 'custom', label: 'Custom CEL expression' },
];

export interface QuotaCostForm {
  preset: CostPresetId;
  custom: string;
}

export interface ModelQuotaForm {
  modelName: string;
  cost: QuotaCostForm;
  limit: string;
  duration: QuotaDuration;
  rules: BucketRuleForm[];
  /** `quota.mode` of an existing object (only "Shared" exists); kept when it was explicit. */
  mode?: string;
}

export interface QuotaForm {
  name: string;
  namespace: string;
  targets: string[];
  models: ModelQuotaForm[];
  serviceQuota: { enabled: boolean; limit: string; duration: QuotaDuration; cost: QuotaCostForm };
}

export const newHeader = (): HeaderConditionForm => ({
  name: '',
  type: 'Exact',
  value: '',
  invert: false,
});

export const newBucketRule = (): BucketRuleForm => ({
  headers: [newHeader()],
  limit: '',
  duration: '1h',
  shadowMode: false,
});

export const newModelQuota = (): ModelQuotaForm => ({
  modelName: '',
  cost: { preset: 'total', custom: '' },
  limit: '',
  duration: '1h',
  rules: [],
});

export const newQuotaForm = (): QuotaForm => ({
  name: '',
  namespace: 'default',
  targets: [],
  models: [newModelQuota()],
  serviceQuota: {
    enabled: false,
    limit: '',
    duration: '1h',
    cost: { preset: 'total', custom: '' },
  },
});

/** Ready-made bucket rules for the most common multi-tenant setups. */
export const BUCKET_RULE_TEMPLATES: Array<{
  id: string;
  label: string;
  description: string;
  create: () => BucketRuleForm;
}> = [
  {
    id: 'per-user',
    label: 'Per user',
    description: 'A separate budget for every distinct value of x-user-id.',
    create: () => ({
      ...newBucketRule(),
      headers: [{ ...newHeader(), name: 'x-user-id', type: 'Distinct' }],
    }),
  },
  {
    id: 'per-tenant',
    label: 'Per tenant',
    description: 'A separate budget for every distinct value of x-tenant-id.',
    create: () => ({
      ...newBucketRule(),
      headers: [{ ...newHeader(), name: 'x-tenant-id', type: 'Distinct' }],
    }),
  },
  {
    id: 'one-tenant',
    label: 'Dedicated tenant',
    description: 'A dedicated budget for one tenant (x-tenant-id equals a value).',
    create: () => ({
      ...newBucketRule(),
      headers: [{ ...newHeader(), name: 'x-tenant-id', type: 'Exact' }],
    }),
  },
];

/** CEL expression for a cost selection; undefined means the upstream default (total_tokens). */
export function costExpressionOf(cost: QuotaCostForm): string | undefined {
  if (cost.preset === 'custom') return cost.custom.trim() || undefined;
  return COST_PRESETS.find(p => p.id === cost.preset)?.expression;
}

/**
 * Non-blocking hints for a cost expression. Token counters are unsigned, so plain integer
 * literals (e.g. `* 6` instead of `* 6u`) fail CEL type checking in the controller.
 */
export function costExpressionWarnings(expression: string | undefined): string[] {
  if (!expression) return [];
  const withoutStrings = expression.replace(/'[^']*'|"[^"]*"/g, '""');
  const bare = withoutStrings.match(/(?<![\w.])\d+(?![\w.])/g);
  return bare
    ? [
        `Integer literals must be unsigned (add a "u" suffix): ${bare
          .map(n => `${n} → ${n}u`)
          .join(', ')}.`,
      ]
    : [];
}

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function limitError(limit: string, field: string): string | null {
  const n = Number(limit);
  return limit !== '' && Number.isInteger(n) && n > 0
    ? null
    : `${field} must be a positive integer.`;
}

export function targetErrors(form: QuotaForm): string[] {
  const errors = [validateName(form.name), validateName(form.namespace, 'Namespace')].filter(
    (e): e is string => !!e
  );
  if (form.targets.length === 0) errors.push('Select at least one Service Backend.');
  if (form.targets.length > 16) errors.push('At most 16 Service Backends can be targeted.');
  return errors;
}

export function modelErrors(models: ModelQuotaForm[]): string[] {
  const errors: string[] = [];
  if (models.length === 0) errors.push('Add at least one model quota.');
  if (models.length > 128) errors.push('At most 128 model quotas are allowed.');
  const seen = new Set<string>();
  models.forEach((m, i) => {
    const label = `Model quota ${i + 1}`;
    if (!m.modelName.trim()) errors.push(`${label}: model name is required.`);
    else if (seen.has(m.modelName.trim()))
      errors.push(`${label}: model "${m.modelName}" is listed twice.`);
    seen.add(m.modelName.trim());
    if (m.cost.preset === 'custom' && !m.cost.custom.trim()) {
      errors.push(`${label}: enter a CEL cost expression or pick a preset.`);
    }
    const le = limitError(m.limit, `${label} default limit`);
    if (le) errors.push(le);
    m.rules.forEach((r, j) => {
      if (r.preserved) return;
      const rl = `${label}, rule ${j + 1}`;
      const re = limitError(r.limit, `${rl} limit`);
      if (re) errors.push(re);
      if (r.headers.length === 0) errors.push(`${rl}: add at least one header condition.`);
      r.headers.forEach((h, k) => {
        const hl = `${rl}, header ${k + 1}`;
        if (!HEADER_NAME.test(h.name)) errors.push(`${hl}: enter a valid header name.`);
        if (h.type !== 'Distinct' && !h.value) errors.push(`${hl}: a value is required.`);
        if (h.type === 'RegularExpression' && h.value) {
          try {
            new RegExp(h.value);
          } catch {
            errors.push(`${hl}: invalid regular expression.`);
          }
        }
      });
    });
  });
  return errors;
}

export function serviceQuotaErrors(form: QuotaForm): string[] {
  const sq = form.serviceQuota;
  if (!sq.enabled) return [];
  const errors: string[] = [];
  const le = limitError(sq.limit, 'Service quota limit');
  if (le) errors.push(le);
  if (sq.cost.preset === 'custom' && !sq.cost.custom.trim()) {
    errors.push('Service quota: enter a CEL cost expression or pick a preset.');
  }
  return errors;
}

/** Builds the QuotaPolicy spec (undefined values are pruned by the caller). */
export function toQuotaSpec(form: QuotaForm) {
  return {
    targetRefs: form.targets.map(name => ({
      group: 'aigateway.envoyproxy.io',
      kind: 'AIServiceBackend',
      name,
    })),
    serviceQuota: form.serviceQuota.enabled
      ? {
          costExpression: costExpressionOf(form.serviceQuota.cost),
          quota: { limit: Number(form.serviceQuota.limit), duration: form.serviceQuota.duration },
        }
      : undefined,
    perModelQuotas: form.models.map(m => ({
      modelName: m.modelName.trim(),
      quota: {
        costExpression: costExpressionOf(m.cost),
        defaultBucket: { limit: Number(m.limit), duration: m.duration },
        mode: m.mode,
        bucketRules: m.rules.map(r =>
          r.preserved
            ? r.preserved
            : {
                clientSelectors: [
                  {
                    headers: r.headers.map(h => ({
                      name: h.name,
                      type: h.explicitType === false && h.type === 'Exact' ? undefined : h.type,
                      value: h.type === 'Distinct' ? undefined : h.value,
                      invert: h.invert || undefined,
                    })),
                  },
                ],
                quota: { limit: Number(r.limit), duration: r.duration },
                shadowMode: r.shadowMode || undefined,
              }
        ),
      },
    })),
  };
}

/** A model name a quota can match: the modelNameOverride of a route backendRef. */
export interface ModelSuggestion {
  model: string;
  routes: string[];
}

/**
 * Model names routed to the targeted backends, taken from AIGatewayRoute backendRefs'
 * `modelNameOverride` (the value a perModelQuota must match).
 */
export function modelSuggestions(
  routes: AIGatewayRoute[] | null | undefined,
  targets: string[],
  namespace: string
): ModelSuggestion[] {
  const byModel = new Map<string, Set<string>>();
  for (const route of routes || []) {
    for (const rule of route.spec?.rules || []) {
      for (const ref of rule.backendRefs || []) {
        const ns = ref.namespace || route.metadata.namespace;
        if (!isAIServiceBackendRef(ref) || ns !== namespace || !targets.includes(ref.name)) {
          continue;
        }
        if (!ref.modelNameOverride) continue;
        const set = byModel.get(ref.modelNameOverride) || new Set<string>();
        set.add(`${route.metadata.namespace}/${route.metadata.name}`);
        byModel.set(ref.modelNameOverride, set);
      }
    }
  }
  return Array.from(byModel.entries())
    .map(([model, set]) => ({ model, routes: Array.from(set).sort() }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

/** Existing policies in the namespace that also define a quota for one of these models. */
export function conflictingPolicies(
  existing: QuotaPolicy[] | null | undefined,
  form: QuotaForm
): Array<{ policy: string; models: string[] }> {
  const models = new Set(form.models.map(m => m.modelName.trim()).filter(Boolean));
  return (existing || [])
    .filter(p => p.metadata.namespace === form.namespace && p.metadata.name !== form.name)
    .filter(p => (p.spec?.targetRefs || []).some(t => form.targets.includes(t.name)))
    .map(p => ({
      policy: p.metadata.name,
      models: (p.spec?.perModelQuotas || [])
        .map(pm => pm.modelName)
        .filter(name => models.has(name)),
    }))
    .filter(c => c.models.length > 0);
}

/**
 * Route rules that send traffic to a targeted backend without a modelNameOverride.
 * Per-model quotas can never match those requests, so the wizard warns about them.
 */
export function routesWithoutOverride(
  routes: AIGatewayRoute[] | null | undefined,
  targets: string[],
  namespace: string
): Array<{ route: string; backend: string }> {
  const found = new Map<string, { route: string; backend: string }>();
  for (const route of routes || []) {
    for (const rule of route.spec?.rules || []) {
      for (const ref of rule.backendRefs || []) {
        const ns = ref.namespace || route.metadata.namespace;
        if (!isAIServiceBackendRef(ref) || ns !== namespace || !targets.includes(ref.name)) {
          continue;
        }
        if (ref.modelNameOverride) continue;
        const entry = {
          route: `${route.metadata.namespace}/${route.metadata.name}`,
          backend: ref.name,
        };
        found.set(`${entry.route}|${entry.backend}`, entry);
      }
    }
  }
  return Array.from(found.values());
}

// ─── Edit support ──────────────────────────────────────────────────────────

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function costFromExpression(expression: string | undefined): QuotaCostForm {
  if (!expression) return { preset: 'total', custom: '' };
  const preset = COST_PRESETS.find(p => p.expression === expression);
  return preset ? { preset: preset.id, custom: '' } : { preset: 'custom', custom: expression };
}

const asDuration = (d: unknown): QuotaDuration =>
  (QUOTA_DURATIONS.some(x => x.value === d) ? d : '1h') as QuotaDuration;

function ruleToForm(rule: Json): BucketRuleForm {
  const selectors: Json[] = rule.clientSelectors || [];
  const headerOnly =
    selectors.length === 1 &&
    Object.keys(selectors[0] || {}).every(k => k === 'headers') &&
    (selectors[0].headers || []).length > 0;
  const base = {
    limit: String(rule.quota?.limit ?? ''),
    duration: asDuration(rule.quota?.duration),
    shadowMode: !!rule.shadowMode,
  };
  if (!headerOnly) return { ...base, headers: [], preserved: rule };
  return {
    ...base,
    headers: selectors[0].headers.map((h: Json) => ({
      name: h.name || '',
      type: (h.type || 'Exact') as HeaderMatchType,
      value: h.value ?? '',
      invert: !!h.invert,
      explicitType: !!h.type,
    })),
  };
}

/** Pre-fills the quota form from an existing QuotaPolicy. */
export function formFromQuotaPolicy(json: Json): QuotaForm {
  const spec: Json = json.spec || {};
  const sq: Json | undefined = spec.serviceQuota;
  return {
    name: json.metadata?.name || '',
    namespace: json.metadata?.namespace || '',
    targets: (spec.targetRefs || []).map((t: Json) => t.name),
    models: (spec.perModelQuotas || []).map((pm: Json) => ({
      modelName: pm.modelName || '',
      cost: costFromExpression(pm.quota?.costExpression),
      limit: String(pm.quota?.defaultBucket?.limit ?? ''),
      duration: asDuration(pm.quota?.defaultBucket?.duration),
      rules: (pm.quota?.bucketRules || []).map(ruleToForm),
      mode: pm.quota?.mode,
    })),
    serviceQuota: sq?.quota
      ? {
          enabled: true,
          limit: String(sq.quota.limit ?? ''),
          duration: asDuration(sq.quota.duration),
          cost: costFromExpression(sq.costExpression),
        }
      : { enabled: false, limit: '', duration: '1h', cost: { preset: 'total', custom: '' } },
  };
}

/**
 * Applies the form onto an existing spec: the managed fields come from the form, anything
 * else already in the spec (unknown fields) is kept.
 */
export function mergeQuotaSpec(original: Json | undefined, form: QuotaForm): Json {
  const spec: Json = { ...(original || {}) };
  const built: Json = toQuotaSpec(form);
  for (const key of ['targetRefs', 'serviceQuota', 'perModelQuotas']) {
    if (built[key] === undefined || (Array.isArray(built[key]) && built[key].length === 0)) {
      delete spec[key];
    } else {
      spec[key] = built[key];
    }
  }
  return spec;
}
