import { describe, expect, it } from 'vitest';
import type { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import type { QuotaPolicy } from '../../resources/quotaPolicy';
import { prune } from '../../utils/forms';
import {
  BUCKET_RULE_TEMPLATES,
  conflictingPolicies,
  costExpressionOf,
  costExpressionWarnings,
  formFromQuotaPolicy,
  mergeQuotaSpec,
  modelErrors,
  modelSuggestions,
  newBucketRule,
  newModelQuota,
  newQuotaForm,
  QuotaForm,
  routesWithoutOverride,
  serviceQuotaErrors,
  targetErrors,
  toQuotaSpec,
} from './quotaForm';

const form = (overrides: Partial<QuotaForm> = {}): QuotaForm => ({
  ...newQuotaForm(),
  name: 'gpt-quota',
  namespace: 'ai',
  targets: ['openai'],
  models: [{ ...newModelQuota(), modelName: 'gpt-4o', limit: '10000' }],
  ...overrides,
});

describe('toQuotaSpec', () => {
  it('builds a minimal per-model quota (default cost, no mode, no serviceQuota)', () => {
    expect(prune(toQuotaSpec(form()))).toEqual({
      targetRefs: [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' }],
      perModelQuotas: [
        { modelName: 'gpt-4o', quota: { defaultBucket: { limit: 10000, duration: '1h' } } },
      ],
    });
  });

  it('writes bucket rules with Distinct headers (no value) and shadow mode', () => {
    const rule = { ...BUCKET_RULE_TEMPLATES[0].create(), limit: '500', shadowMode: true };
    const spec = prune(toQuotaSpec(form({ models: [{ ...form().models[0], rules: [rule] }] })));
    expect(spec.perModelQuotas[0].quota.bucketRules).toEqual([
      {
        clientSelectors: [{ headers: [{ name: 'x-user-id', type: 'Distinct' }] }],
        quota: { limit: 500, duration: '1h' },
        shadowMode: true,
      },
    ]);
  });

  it('includes serviceQuota only when enabled', () => {
    const spec = prune(
      toQuotaSpec(
        form({
          serviceQuota: {
            enabled: true,
            limit: '1000000',
            duration: '1d',
            cost: { preset: 'inputOutput', custom: '' },
          },
        })
      )
    );
    expect(spec.serviceQuota).toEqual({
      costExpression: 'input_tokens + output_tokens',
      quota: { limit: 1000000, duration: '1d' },
    });
  });
});

describe('cost expressions', () => {
  it('maps presets and custom values', () => {
    expect(costExpressionOf({ preset: 'total', custom: '' })).toBeUndefined();
    expect(costExpressionOf({ preset: 'weighted', custom: '' })).toContain('output_tokens * 6u');
    expect(costExpressionOf({ preset: 'custom', custom: ' output_tokens ' })).toBe('output_tokens');
  });

  it('flags integer literals without the unsigned suffix', () => {
    expect(costExpressionWarnings('input_tokens + output_tokens * 6')[0]).toContain('6 → 6u');
    expect(costExpressionWarnings('input_tokens + output_tokens * 6u')).toEqual([]);
    expect(costExpressionWarnings('uint(double(cached_input_tokens) * 0.1)')).toEqual([]);
    expect(costExpressionWarnings("model == 'gpt-4' ? total_tokens : 0u")).toEqual([]);
  });
});

describe('validation', () => {
  it('requires a name, at least one target and at most 16', () => {
    expect(targetErrors(form())).toEqual([]);
    expect(targetErrors(form({ targets: [] }))).toContain('Select at least one Service Backend.');
    expect(
      targetErrors(form({ targets: Array.from({ length: 17 }, (_, i) => `b${i}`) }))
    ).toContain('At most 16 Service Backends can be targeted.');
  });

  it('validates model quotas and bucket rules', () => {
    const bad = modelErrors([
      { ...newModelQuota(), modelName: 'm', limit: '0' },
      { ...newModelQuota(), modelName: 'm', limit: '10', rules: [newBucketRule()] },
    ]);
    expect(bad).toContain('Model quota 1 default limit must be a positive integer.');
    expect(bad).toContain('Model quota 2: model "m" is listed twice.');
    expect(bad).toContain('Model quota 2, rule 1 limit must be a positive integer.');
    expect(bad).toContain('Model quota 2, rule 1, header 1: enter a valid header name.');
  });

  it('ignores the service quota unless enabled', () => {
    expect(serviceQuotaErrors(form())).toEqual([]);
    expect(
      serviceQuotaErrors(
        form({ serviceQuota: { ...newQuotaForm().serviceQuota, enabled: true, limit: 'x' } })
      )
    ).toEqual(['Service quota limit must be a positive integer.']);
  });
});

describe('modelSuggestions', () => {
  const route = {
    metadata: { name: 'chat', namespace: 'ai' },
    spec: {
      rules: [
        { backendRefs: [{ name: 'openai', modelNameOverride: 'gpt-4o' }] },
        { backendRefs: [{ name: 'openai' }, { name: 'other', modelNameOverride: 'x' }] },
      ],
    },
  } as unknown as AIGatewayRoute;

  it('returns modelNameOverride values routed to the targeted backends', () => {
    expect(modelSuggestions([route], ['openai'], 'ai')).toEqual([
      { model: 'gpt-4o', routes: ['ai/chat'] },
    ]);
    expect(modelSuggestions([route], ['openai'], 'other-ns')).toEqual([]);
  });
});

describe('conflictingPolicies', () => {
  it('reports other policies on the same backend with the same model', () => {
    const existing = {
      metadata: { name: 'a-first', namespace: 'ai' },
      spec: {
        targetRefs: [
          { group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' },
        ],
        perModelQuotas: [{ modelName: 'gpt-4o', quota: {} }],
      },
    } as unknown as QuotaPolicy;
    expect(conflictingPolicies([existing], form())).toEqual([
      { policy: 'a-first', models: ['gpt-4o'] },
    ]);
  });
});

describe('routesWithoutOverride', () => {
  it('lists route rules to targeted backends that lack a modelNameOverride', () => {
    const route = {
      metadata: { name: 'chat', namespace: 'ai' },
      spec: {
        rules: [{ backendRefs: [{ name: 'openai' }, { name: 'openai', modelNameOverride: 'm' }] }],
      },
    } as unknown as AIGatewayRoute;
    expect(routesWithoutOverride([route], ['openai'], 'ai')).toEqual([
      { route: 'ai/chat', backend: 'openai' },
    ]);
  });
});

describe('edit support', () => {
  const existing = {
    metadata: { name: 'q', namespace: 'ai' },
    spec: {
      targetRefs: [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'openai' }],
      perModelQuotas: [
        {
          modelName: 'gpt-4o',
          quota: {
            costExpression: 'input_tokens + cached_input_tokens / 10u + output_tokens * 6u',
            mode: 'Shared',
            defaultBucket: { limit: 10000, duration: '1h' },
            bucketRules: [
              {
                clientSelectors: [{ headers: [{ name: 'x-tenant-id', value: 'premium' }] }],
                quota: { limit: 50000, duration: '1h' },
              },
              {
                clientSelectors: [{ sourceCIDR: { type: 'Distinct', value: '10.0.0.0/8' } }],
                quota: { limit: 100, duration: '1m' },
                shadowMode: true,
              },
            ],
          },
        },
        {
          modelName: 'mini',
          quota: {
            costExpression: 'output_tokens * 2u',
            defaultBucket: { limit: 5, duration: '1d' },
          },
        },
      ],
    },
  };

  it('pre-fills presets, custom costs, header rules and marks other rules as preserved', () => {
    const f = formFromQuotaPolicy(existing);
    expect(f.targets).toEqual(['openai']);
    expect(f.models[0].cost).toEqual({ preset: 'weighted', custom: '' });
    expect(f.models[1].cost).toEqual({ preset: 'custom', custom: 'output_tokens * 2u' });
    expect(f.models[0].rules[0].headers[0]).toMatchObject({
      name: 'x-tenant-id',
      type: 'Exact',
      explicitType: false,
    });
    expect(f.models[0].rules[1].preserved).toBeDefined();
    expect(modelErrors(f.models)).toEqual([]);
  });

  it('round-trips an unchanged policy exactly', () => {
    expect(prune(mergeQuotaSpec(existing.spec, formFromQuotaPolicy(existing)))).toEqual(
      existing.spec
    );
  });

  it('applies edits and keeps preserved rules', () => {
    const f = formFromQuotaPolicy(existing);
    f.models[0].limit = '20000';
    const spec = prune(mergeQuotaSpec(existing.spec, f));
    expect(spec.perModelQuotas[0].quota.defaultBucket.limit).toBe(20000);
    expect(spec.perModelQuotas[0].quota.bucketRules[1]).toEqual(
      existing.spec.perModelQuotas?.[0].quota.bucketRules?.[1]
    );
  });
});
