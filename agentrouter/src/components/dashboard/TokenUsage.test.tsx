import { render, screen } from '@testing-library/react';
import type { QuotaPolicyInterface } from '../../resources/quotaPolicy';
import { QuotaUsagePanel, TokenUsagePanel } from './TokenUsage';

// Prometheus is the external dependency: it answers the token and quota queries.
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ getCluster: () => 'test' }));
vi.mock('../../resources/quotaPolicy', () => ({
  formatQuota: (q: { limit: number; duration: string }) => `${q.limit} / ${q.duration}`,
}));
vi.mock('../../api/prometheus', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/prometheus')>()),
  discoverPrometheus: async () => ({ base: '/prom', label: 'monitoring/prometheus:9090' }),
  promQuery: async (_endpoint: unknown, query: string) => {
    const sample = (metric: Record<string, string>, value: number) => ({
      metric,
      value: [0, String(value)],
    });
    if (query.includes('_count')) return [sample({ gen_ai_request_model: 'qwen35-2b' }, 42)];
    if (query.includes('gen_ai_backend')) return [sample({}, 9500)];
    return [
      sample({ gen_ai_request_model: 'qwen35-2b', gen_ai_token_type: 'input' }, 12000),
      sample({ gen_ai_request_model: 'qwen35-2b', gen_ai_token_type: 'output' }, 3400),
    ];
  },
}));

const policy = {
  apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
  kind: 'QuotaPolicy',
  metadata: { name: 'budgets', namespace: 'ai' },
  spec: {
    targetRefs: [{ group: 'aigateway.envoyproxy.io', kind: 'AIServiceBackend', name: 'vllm' }],
    perModelQuotas: [
      { modelName: 'qwen35-2b', quota: { defaultBucket: { limit: 10000, duration: '1h' } } },
      {
        modelName: 'gpt',
        quota: {
          costExpression: 'output_tokens * 6u',
          defaultBucket: { limit: 5, duration: '1h' },
        },
      },
    ],
  },
} as unknown as QuotaPolicyInterface;

describe('Token usage', () => {
  it('lists tokens and requests per model', async () => {
    render(<TokenUsagePanel />);
    expect(await screen.findByText('qwen35-2b')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('From monitoring/prometheus:9090')).toBeTruthy();
  });

  it('estimates the quota fill and says which quotas cannot be estimated', async () => {
    render(<QuotaUsagePanel policies={[policy]} />);
    expect(await screen.findByText(/of 10000 \/ 1h \(95%\)/)).toBeTruthy();
    expect(screen.getByText(/near the limit/)).toBeTruthy();
    expect(screen.getByText(/Custom cost expression/)).toBeTruthy();
  });
});
