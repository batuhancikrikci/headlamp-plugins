import { describe, expect, it } from 'vitest';
import { prune } from '../../utils/forms';
import {
  formFromRoute,
  hasCrossNamespaceRefs,
  newBackend,
  newRule,
  ruleErrors,
  RuleForm,
  toRouteRules,
  toRouteSpec,
} from './routeForm';

const serviceRule = (overrides: Partial<RuleForm> = {}): RuleForm => ({
  ...newRule(),
  models: 'gpt-4o',
  backends: [{ ...newBackend(), name: 'openai', weight: '3', priority: '1' }],
  ...overrides,
});

const poolRule = (name: string, namespace = ''): RuleForm => ({
  ...newRule(),
  models: 'llama-3',
  backendType: 'InferencePool',
  // Stale Service Backend input must not leak into a pool rule.
  backends: [{ ...newBackend(), name: 'leftover' }],
  pool: { name, namespace },
});

describe('toRouteRules', () => {
  it('builds AIServiceBackend refs without group/kind and omits the local namespace', () => {
    const [rule] = prune(
      toRouteRules(
        [
          serviceRule({
            backends: [
              { ...newBackend(), name: 'openai', namespace: 'ai', weight: '3', priority: '1' },
            ],
          }),
        ],
        'ai'
      )
    );
    expect(rule).toEqual({
      matches: [{ headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: 'gpt-4o' }] }],
      backendRefs: [{ name: 'openai', weight: 3, priority: 1 }],
    });
  });

  it('builds a single InferencePool ref with group and kind', () => {
    const [rule] = prune(toRouteRules([poolRule('vllm-llama3', 'models')], 'ai'));
    expect(rule.backendRefs).toEqual([
      {
        group: 'inference.networking.k8s.io',
        kind: 'InferencePool',
        name: 'vllm-llama3',
        namespace: 'models',
      },
    ]);
  });

  it('matches every request when no models are given', () => {
    const [rule] = prune(toRouteRules([serviceRule({ models: '' })], 'ai'));
    expect(rule.matches).toBeUndefined();
  });
});

describe('ruleErrors', () => {
  it('accepts a valid Service Backend rule and a valid pool rule', () => {
    expect(ruleErrors([serviceRule(), poolRule('vllm')])).toEqual([]);
  });

  it('requires a pool name for InferencePool rules', () => {
    expect(ruleErrors([poolRule('')])).toEqual(['Rule 1 InferencePool is required.']);
  });

  it('rejects negative weights and bad timeouts', () => {
    const errors = ruleErrors([
      serviceRule({
        backends: [{ ...newBackend(), name: 'openai', weight: '-1' }],
        requestTimeout: '10 seconds',
      }),
    ]);
    expect(errors).toContain('Rule 1 backend #1 weight must be an integer ≥ 0.');
    expect(errors).toContain('Rule 1: timeout must be a duration such as 60s or 2m.');
  });
});

describe('hasCrossNamespaceRefs', () => {
  it('detects references outside the route namespace', () => {
    expect(hasCrossNamespaceRefs([serviceRule()], 'ai')).toBe(false);
    expect(hasCrossNamespaceRefs([poolRule('vllm', 'models')], 'ai')).toBe(true);
    expect(hasCrossNamespaceRefs([poolRule('vllm', 'ai')], 'ai')).toBe(false);
  });
});

describe('route edit support', () => {
  const existing: Parameters<typeof formFromRoute>[0] = {
    metadata: { name: 'chat', namespace: 'ai' },
    spec: {
      parentRefs: [{ name: 'gw', kind: 'Gateway', group: 'gateway.networking.k8s.io' }],
      rules: [
        {
          matches: [{ headers: [{ name: 'x-ai-eg-model', value: 'gpt-4o' }] }],
          backendRefs: [
            {
              name: 'openai',
              namespace: 'ai',
              modelNameOverride: 'gpt-4o-2024',
              headerMutation: { set: [{ name: 'x-a', value: 'b' }] },
            },
          ],
          timeouts: { request: '60s', backendRequest: '30s' },
          streamIdleTimeout: '5m',
        },
        {
          matches: [
            {
              headers: [
                { type: 'Exact', name: 'x-ai-eg-model', value: 'llama' },
                { type: 'Exact', name: 'Authorization', value: 'sk-x' },
              ],
            },
          ],
          backendRefs: [
            { group: 'inference.networking.k8s.io', kind: 'InferencePool', name: 'vllm' },
          ],
        },
      ],
      llmRequestCosts: [{ metadataKey: 'total', type: 'TotalToken' }],
    },
  };

  it('pre-fills models, backends, pools and marks complex matches as advanced', () => {
    const f = formFromRoute(existing);
    expect(f.rules[0]).toMatchObject({
      models: 'gpt-4o',
      advancedMatches: false,
      requestTimeout: '60s',
    });
    expect(f.rules[0].backends[0]).toMatchObject({
      name: 'openai',
      modelNameOverride: 'gpt-4o-2024',
    });
    expect(f.rules[1]).toMatchObject({ advancedMatches: true, backendType: 'InferencePool' });
    expect(f.rules[1].pool.name).toBe('vllm');
    expect(ruleErrors(f.rules)).toEqual([]);
  });

  it('round-trips an unchanged route exactly', () => {
    expect(toRouteSpec(formFromRoute(existing), existing.spec)).toEqual(existing.spec);
  });

  it('applies edits and keeps mutations, extra timeouts and advanced matches', () => {
    const f = formFromRoute(existing);
    f.rules[0].models = 'gpt-4o, gpt-4.1';
    f.rules[0].backends[0].weight = '2';
    f.rules[0].requestTimeout = '';
    const spec = toRouteSpec(f, existing.spec);
    expect(spec.rules[0].matches).toHaveLength(2);
    expect(spec.rules[0].backendRefs[0]).toMatchObject({
      weight: 2,
      namespace: 'ai',
      headerMutation: existing.spec.rules[0].backendRefs[0].headerMutation,
    });
    expect(spec.rules[0].timeouts).toEqual({ backendRequest: '30s' });
    expect(spec.rules[0].streamIdleTimeout).toBe('5m');
    expect(spec.rules[1].matches).toEqual(existing.spec.rules[1].matches);
  });
});
