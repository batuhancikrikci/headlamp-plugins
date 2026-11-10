import { summarize } from './benchmark';
import {
  inClusterPrometheus,
  meetsGoal,
  recommendedLevel,
  scalingAdvice,
  scalingSpec,
  SweepLevel,
  sweepLevels,
} from './sweep';

function level(concurrency: number, ttftMs: number, failed = 0): SweepLevel {
  const ok = Array.from({ length: 10 - failed }, () => ({
    ok: true,
    ttftMs,
    totalMs: ttftMs + 1000,
    outputTokens: 100,
  }));
  const bad = Array.from({ length: failed }, () => ({ ok: false, totalMs: 10, error: 'HTTP 503' }));
  return { concurrency, summary: summarize([...ok, ...bad], 5000) };
}

const goal = { ttftP95Ms: 1000, maxErrorRate: 0.01 };

describe('sweepLevels', () => {
  it('doubles up to the maximum and always includes it', () => {
    expect(sweepLevels(32)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(sweepLevels(12)).toEqual([1, 2, 4, 8, 12]);
    expect(sweepLevels(1)).toEqual([1]);
  });
});

describe('recommendedLevel', () => {
  it('picks the highest level within the goal', () => {
    const levels = [level(1, 200), level(2, 300), level(4, 600), level(8, 1500), level(16, 3000)];
    expect(recommendedLevel(levels, goal)?.concurrency).toBe(4);
  });

  it('does not skip over a level that missed the goal', () => {
    const levels = [level(1, 200), level(2, 1200), level(4, 900)];
    expect(recommendedLevel(levels, goal)?.concurrency).toBe(1);
  });

  it('counts errors against the goal', () => {
    expect(meetsGoal(level(4, 200, 1), goal)).toBe(false);
    expect(recommendedLevel([level(1, 1500)], goal)).toBeUndefined();
  });
});

describe('scalingAdvice', () => {
  it('splits the concurrency over the replicas and sizes for the peak', () => {
    expect(scalingAdvice(16, 2, 50)).toEqual({ perReplica: 8, replicasForPeak: 7 });
    expect(scalingAdvice(1, 4)).toEqual({ perReplica: 1, replicasForPeak: undefined });
  });
});

describe('inClusterPrometheus', () => {
  it('turns the service proxy path into an in-cluster URL', () => {
    expect(
      inClusterPrometheus({
        kind: 'proxy',
        base: '/api/v1/namespaces/monitoring/services/prometheus-operated:9090/proxy',
      })
    ).toBe('http://prometheus-operated.monitoring.svc:9090');
    expect(
      inClusterPrometheus({
        kind: 'proxy',
        base: '/api/v1/namespaces/obs/services/https:thanos-query:9091/proxy/prom/',
      })
    ).toBe('https://thanos-query.obs.svc:9091/prom');
    expect(inClusterPrometheus({ kind: 'url', base: 'https://prom.example.com/' })).toBe(
      'https://prom.example.com'
    );
    expect(inClusterPrometheus(undefined)).toBe('<prometheus-url>');
  });
});

describe('scalingSpec', () => {
  const advice = { perReplica: 8 };

  it('adds a KEDA trigger on the queue of the decode pods of an LLM service', () => {
    const spec = scalingSpec(
      'LLMInferenceService',
      { namespace: 'ai', name: 'qwen' },
      advice,
      1,
      4,
      'http://prom.monitoring.svc:9090'
    );
    expect(spec).toEqual({
      scaling: {
        minReplicas: 1,
        maxReplicas: 4,
        keda: {
          triggers: [
            {
              type: 'prometheus',
              metadata: {
                serverAddress: 'http://prom.monitoring.svc:9090',
                query:
                  'sum(vllm:num_requests_running{namespace="ai",pod=~"qwen-kserve-.*",pod!~"qwen-kserve-prefill-.*"}) + sum(vllm:num_requests_waiting{namespace="ai",pod=~"qwen-kserve-.*",pod!~"qwen-kserve-prefill-.*"})',
                threshold: '8',
              },
            },
          ],
        },
      },
    });
  });

  it('sets the concurrency target of an InferenceService predictor', () => {
    expect(
      scalingSpec('InferenceService', { namespace: 'ai', name: 'm' }, advice, 1, 3, '')
    ).toEqual({
      predictor: { minReplicas: 1, maxReplicas: 3, scaleMetric: 'concurrency', scaleTarget: 8 },
    });
  });
});
