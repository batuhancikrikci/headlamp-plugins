import { describe, expect, it } from 'vitest';
import { parseService, rankPrometheusServices } from '../api/prometheus';
import type { QuotaPolicyInterface } from '../resources/quotaPolicy';
import { fill, modelUsage, quotaRows, tokenUsageQueries } from './tokenUsage';

const sample = (metric: Record<string, string>, value: number) => ({
  metric,
  value: [0, String(value)] as [number, string],
});

describe('modelUsage', () => {
  it('adds up input and output tokens and requests per model, busiest first', () => {
    const rows = modelUsage(
      [
        sample({ gen_ai_request_model: 'small', gen_ai_token_type: 'input' }, 100),
        sample({ gen_ai_request_model: 'large', gen_ai_token_type: 'input' }, 900),
        sample({ gen_ai_request_model: 'large', gen_ai_token_type: 'output' }, 300),
      ],
      [sample({ gen_ai_request_model: 'large' }, 12), sample({ gen_ai_request_model: 'small' }, 3)]
    );
    expect(rows).toEqual([
      { model: 'large', input: 900, output: 300, requests: 12 },
      { model: 'small', input: 100, output: 0, requests: 3 },
    ]);
  });

  it('queries input/output token sums and request counts over the window', () => {
    expect(tokenUsageQueries('24h').tokens).toBe(
      'sum by (gen_ai_request_model, gen_ai_token_type) (increase(gen_ai_client_token_usage_sum{gen_ai_token_type=~"input|output"}[24h]))'
    );
  });
});

describe('quotaRows', () => {
  const policy: QuotaPolicyInterface = {
    apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
    kind: 'QuotaPolicy',
    metadata: { name: 'budgets', namespace: 'ai' } as QuotaPolicyInterface['metadata'],
    spec: {
      targetRefs: [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'vllm' }],
      serviceQuota: { quota: { limit: 1000000, duration: '1d' } },
      perModelQuotas: [
        { modelName: 'qwen35-2b', quota: { defaultBucket: { limit: 10000, duration: '1h' } } },
        {
          modelName: 'gpt',
          quota: {
            costExpression: 'output_tokens * 6u',
            defaultBucket: { limit: 5, duration: '1h' },
          },
        },
        { modelName: 'tiny', quota: { defaultBucket: { limit: 5, duration: '1s' } } },
      ],
    },
  };

  it('estimates the default buckets from the total tokens of the backend and model', () => {
    const rows = quotaRows([policy]);
    expect(rows.map(r => [r.backend, r.model, r.query ?? r.reason])).toEqual([
      [
        'ai/vllm',
        undefined,
        'sum(increase(gen_ai_client_token_usage_sum{gen_ai_token_type="total",gen_ai_backend="ai/vllm"}[1d]))',
      ],
      [
        'ai/vllm',
        'qwen35-2b',
        'sum(increase(gen_ai_client_token_usage_sum{gen_ai_token_type="total",gen_ai_backend="ai/vllm",gen_ai_request_model="qwen35-2b"}[1h]))',
      ],
      ['ai/vllm', 'gpt', 'Custom cost expression: not comparable with token counts.'],
      ['ai/vllm', 'tiny', 'A one-second window is too short to estimate from Prometheus.'],
    ]);
    expect(fill(7500, 10000)).toBe(0.75);
  });
});

describe('Prometheus services', () => {
  it('ranks known query services and parses a service typed by hand', () => {
    const svc = (namespace: string, name: string, port: number) => ({
      metadata: { name, namespace },
      spec: { ports: [{ port }] },
    });
    expect(
      rankPrometheusServices([
        svc('monitoring', 'prometheus-operated', 9090),
        svc('obs', 'thanos-query', 10902),
        svc('x', 'grafana', 3000),
      ]).map(s => s.name)
    ).toEqual(['thanos-query', 'prometheus-operated']);
    expect(parseService('monitoring/prometheus-k8s:9090')).toEqual({
      namespace: 'monitoring',
      name: 'prometheus-k8s',
      port: 9090,
      pathPrefix: undefined,
    });
    expect(parseService('nonsense')).toBeUndefined();
  });
});
