import { describe, expect, it } from 'vitest';
import type { ModelEndpoint } from '../resources/endpoint';
import type { GpuWorkload } from '../resources/gpu';
import { efficiencyQueries, efficiencyRows, efficiencyTotals, usageFromProm } from './efficiency';

const sample = (metric: Record<string, string>, value: number) => ({
  metric,
  value: [0, String(value)] as [number, string],
});

function endpoint(name: string, health: ModelEndpoint['status']['health'] = 'ready') {
  return {
    kind: 'LLMInferenceService',
    name,
    namespace: 'llm',
    status: { health },
    totalGpus: 1,
  } as ModelEndpoint;
}

function pod(name: string, endpointName: string | undefined, gpus = 1): GpuWorkload {
  return {
    namespace: 'llm',
    pod: name,
    node: 'gpu-1',
    phase: 'Running',
    requests: { 'nvidia.com/gpu': gpus },
    ...(endpointName
      ? { endpoint: { kind: 'LLMInferenceService' as const, name: endpointName } }
      : {}),
  };
}

describe('efficiencyQueries', () => {
  it('uses the window in every query', () => {
    const q = efficiencyQueries('24h');
    expect(q.util).toContain('[24h]');
    expect(q.requests).toBe('sum by (namespace, pod) (increase(vllm:request_success_total[24h]))');
  });
});

describe('usageFromProm', () => {
  it('reads pod and exported_pod labels and averages the GPUs of a pod', () => {
    const usage = usageFromProm({
      util: [
        sample(
          {
            namespace: 'gpu-operator',
            pod: 'dcgm-x',
            exported_namespace: 'llm',
            exported_pod: 'a-0',
          },
          10
        ),
        sample(
          {
            namespace: 'gpu-operator',
            pod: 'dcgm-x',
            exported_namespace: 'llm',
            exported_pod: 'a-0',
          },
          20
        ),
        sample(
          {
            namespace: 'gpu-operator',
            pod: 'dcgm-x',
            exported_namespace: 'llm',
            exported_pod: 'a-0',
          },
          60
        ),
        sample({ namespace: 'llm', pod: 'b-0' }, 80),
      ],
      requests: [sample({ namespace: 'llm', pod: 'a-0' }, 12)],
      tokens: [sample({ namespace: 'llm', pod: 'a-0' }, 3600)],
    });
    expect(usage.get('llm/a-0')).toEqual({ util: 30, requests: 12, tokens: 3600 });
    expect(usage.get('llm/b-0')).toEqual({ util: 80 });
  });
});

describe('efficiencyRows', () => {
  const endpoints = [
    endpoint('idle'),
    endpoint('busy'),
    endpoint('quiet'),
    endpoint('unknown'),
    endpoint('stopped', 'stopped'),
  ];
  const workloads = [
    pod('idle-0', 'idle', 2),
    pod('busy-0', 'busy'),
    pod('quiet-0', 'quiet'),
    pod('unknown-0', 'unknown'),
    pod('notebook', undefined),
  ];
  const usage = usageFromProm({
    util: [
      sample({ namespace: 'llm', pod: 'idle-0' }, 1),
      sample({ namespace: 'llm', pod: 'busy-0' }, 70),
      sample({ namespace: 'llm', pod: 'quiet-0' }, 2),
      sample({ namespace: 'llm', pod: 'notebook' }, 0),
    ],
    requests: [
      sample({ namespace: 'llm', pod: 'busy-0' }, 500),
      sample({ namespace: 'llm', pod: 'quiet-0' }, 3),
    ],
    tokens: [sample({ namespace: 'llm', pod: 'busy-0' }, 7200)],
  });
  const rows = efficiencyRows(endpoints, workloads, usage, 2);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));

  it('classifies endpoints and other GPU workloads', () => {
    expect(byId['llm/idle']).toMatchObject({ state: 'idle', gpus: 2, util: 1 });
    expect(byId['llm/busy']).toMatchObject({ state: 'busy', requests: 500 });
    expect(byId['llm/quiet']).toMatchObject({ state: 'underused', requests: 3 });
    expect(byId['llm/unknown']).toMatchObject({ state: 'unknown' });
    expect(byId['llm/stopped']).toMatchObject({ state: 'stopped', gpus: 0 });
    expect(byId['llm/notebook']).toMatchObject({ state: 'idle' });
    expect(byId['llm/notebook'].endpoint).toBeUndefined();
  });

  it('computes tokens per GPU-hour and puts idle GPUs first', () => {
    expect(byId['llm/busy'].tokensPerGpuHour).toBe(3600);
    expect(rows[0].id).toBe('llm/idle');
    expect(rows[rows.length - 1].state).toBe('stopped');
  });

  it('totals allocated and idle GPUs', () => {
    expect(efficiencyTotals(rows, 2)).toMatchObject({
      gpus: 6,
      idleGpus: 3,
      tokensPerGpuHour: 3600,
    });
    expect(efficiencyTotals(rows, 2).util).toBeCloseTo((1 * 2 + 70 + 2 + 0) / 5);
  });

  it('falls back to the GPUs of the spec when pods cannot be listed', () => {
    const [row] = efficiencyRows([endpoint('x')], [], new Map(), 1);
    expect(row).toMatchObject({ gpus: 1, state: 'unknown' });
  });
});
