import {
  podResources,
  podUsage,
  pvcIssues,
  quotaCapacity,
  quotaIssues,
  quotaKind,
  quotaRows,
  topPods,
  totalUsage,
} from './namespaceHealth';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const old = '2026-11-10T11:00:00Z';

describe('pvcIssues', () => {
  it('reports lost claims and claims pending for long', () => {
    expect(pvcIssues({ metadata: { name: 'a' }, status: { phase: 'Lost' } }, NOW)[0]).toMatchObject(
      {
        level: 'error',
        title: 'Volume lost',
      }
    );
    expect(
      pvcIssues(
        {
          metadata: { name: 'b', creationTimestamp: old },
          spec: { storageClassName: 'fast' },
          status: { phase: 'Pending' },
        },
        NOW
      )[0]
    ).toMatchObject({ level: 'warning', title: 'Claim not bound' });
  });

  it('gives new and bound claims time', () => {
    expect(
      pvcIssues(
        { metadata: { creationTimestamp: '2026-11-10T11:58:00Z' }, status: { phase: 'Pending' } },
        NOW
      )
    ).toEqual([]);
    expect(pvcIssues({ status: { phase: 'Bound' } }, NOW)).toEqual([]);
  });
});

describe('quotas', () => {
  const quota = {
    metadata: { name: 'team' },
    status: {
      hard: {
        'requests.cpu': '10',
        'limits.memory': '64Gi',
        pods: '20',
        'requests.nvidia.com/gpu': '4',
      },
      used: {
        'requests.cpu': '9500m',
        'limits.memory': '16Gi',
        pods: '20',
        'requests.nvidia.com/gpu': '1',
      },
    },
  };

  it('parses every resource and puts the fullest first', () => {
    const rows = quotaRows([quota]);
    expect(rows.map(r => r.resource)).toEqual([
      'pods',
      'requests.cpu',
      'limits.memory',
      'requests.nvidia.com/gpu',
    ]);
    expect(rows[1]).toMatchObject({ kind: 'cpu', used: 9.5, hard: 10 });
    expect(rows[2]).toMatchObject({ kind: 'memory', used: 16 * 2 ** 30 });
    expect(quotaKind('requests.storage')).toBe('memory');
    expect(quotaKind('count/deployments.apps')).toBe('count');
  });

  it('warns at 90 % and reports a used-up quota as an error', () => {
    const issues = quotaIssues(quotaRows([quota]), 'ml');
    expect(issues).toEqual([
      expect.objectContaining({ level: 'error', title: 'pods quota used up', namespace: 'ml' }),
      expect.objectContaining({ level: 'warning', title: 'requests.cpu quota nearly used' }),
    ]);
  });

  it('prefers limits for the capacity line', () => {
    expect(quotaCapacity(quotaRows([quota]))).toEqual({ cpu: 10, memory: 64 * 2 ** 30 });
    expect(quotaCapacity([])).toEqual({ cpu: undefined, memory: undefined });
  });
});

describe('requests and usage', () => {
  it('sums the requests of pods that hold resources', () => {
    const container = {
      resources: { requests: { cpu: '250m', memory: '1Gi' }, limits: { cpu: '1' } },
    };
    expect(
      podResources([
        { spec: { containers: [container, container] }, status: { phase: 'Running' } },
        { spec: { containers: [container] }, status: { phase: 'Succeeded' } },
      ])
    ).toEqual({
      requests: { cpu: 0.5, memory: 2 * 2 ** 30 },
      limits: { cpu: 2, memory: 0 },
    });
  });

  it('adds up pod metrics and ranks the pods', () => {
    const usage = podUsage([
      { metadata: { name: 'a' }, containers: [{ usage: { cpu: '100m', memory: '1Gi' } }] },
      {
        metadata: { name: 'b' },
        containers: [
          { usage: { cpu: '1500m', memory: '256Mi' } },
          { usage: { cpu: '500m', memory: '256Mi' } },
        ],
      },
    ]);
    expect(totalUsage(usage)).toEqual({ cpu: 2.1, memory: 1.5 * 2 ** 30 });
    expect(topPods(usage, 'cpu').map(p => p.name)).toEqual(['b', 'a']);
    expect(topPods(usage, 'memory', 1).map(p => p.name)).toEqual(['a']);
  });
});
