import {
  checkQuotas,
  hasDefaultCpuLimit,
  kueueQueues,
  LocalQueueJson,
  QuotaJson,
  usageOfPods,
} from './quotaCheck';

const pod = { cpu: 4, memory: 32 * 2 ** 30, gpuResource: 'nvidia.com/gpu', gpus: 2 };

function quota(hard: Record<string, string>, used: Record<string, string> = {}): QuotaJson {
  return {
    apiVersion: 'v1',
    kind: 'ResourceQuota',
    metadata: { name: 'team', namespace: 'ml' },
    spec: { hard },
    status: { hard, used },
  };
}

describe('checkQuotas', () => {
  it('passes when the pods fit in what is left', () => {
    const { rows } = checkQuotas(
      [quota({ 'requests.nvidia.com/gpu': '8' }, { 'requests.nvidia.com/gpu': '2' })],
      pod,
      { min: 2, max: 3 }
    );
    expect(rows).toEqual([
      expect.objectContaining({
        resource: 'requests.nvidia.com/gpu',
        used: 2,
        need: 4,
        needMax: 6,
      }),
    ]);
    expect(rows[0].verdict).toBe('ok');
  });

  it('separates the minimum from the autoscaling maximum', () => {
    const { rows } = checkQuotas(
      [quota({ 'requests.nvidia.com/gpu': '8' }, { 'requests.nvidia.com/gpu': '2' })],
      pod,
      { min: 2, max: 4 }
    );
    expect(rows[0].verdict).toBe('max-exceeds');
    const tight = checkQuotas(
      [quota({ 'requests.nvidia.com/gpu': '4' }, { 'requests.nvidia.com/gpu': '2' })],
      pod,
      { min: 2, max: 2 }
    );
    expect(tight.rows[0].verdict).toBe('exceeds');
  });

  it('checks CPU, memory and pod counts with their quantities', () => {
    const { rows } = checkQuotas(
      [quota({ 'requests.cpu': '12', memory: '64Gi', pods: '3' }, { 'requests.cpu': '2500m' })],
      pod,
      { min: 2, max: 2 }
    );
    const byKey = Object.fromEntries(rows.map(r => [r.resource, r]));
    expect(byKey['requests.cpu']).toMatchObject({ used: 2.5, need: 8, verdict: 'ok' });
    expect(byKey.memory).toMatchObject({ need: 64 * 2 ** 30, verdict: 'ok' });
    expect(byKey.pods).toMatchObject({ need: 2, verdict: 'ok' });
  });

  it('releases the usage of the edited endpoint', () => {
    const q = quota({ 'requests.nvidia.com/gpu': '4' }, { 'requests.nvidia.com/gpu': '4' });
    expect(checkQuotas([q], pod, { min: 2, max: 2 }).rows[0].verdict).toBe('exceeds');
    const own = { 'requests.nvidia.com/gpu': 4 };
    expect(checkQuotas([q], pod, { min: 2, max: 2 }, own).rows[0]).toMatchObject({
      used: 0,
      verdict: 'ok',
    });
  });

  it('flags a CPU limit quota, unless a LimitRange supplies a default', () => {
    const q = quota({ 'limits.cpu': '16' });
    expect(checkQuotas([q], pod, { min: 1, max: 1 }).rows[0].verdict).toBe('needs-limit');
    expect(checkQuotas([q], pod, { min: 1, max: 1 }, {}, true).rows).toEqual([]);
  });

  it('sets scoped quotas aside', () => {
    const q = { ...quota({ pods: '1' }), spec: { hard: { pods: '1' }, scopes: ['BestEffort'] } };
    expect(checkQuotas([q], pod, { min: 1, max: 1 })).toEqual({ rows: [], scoped: ['team'] });
  });
});

describe('usageOfPods', () => {
  it('sums container requests and limits', () => {
    const container = {
      resources: {
        requests: { cpu: '500m', memory: '1Gi', 'nvidia.com/gpu': '1' },
        limits: { memory: '1Gi', 'nvidia.com/gpu': '1' },
      },
    };
    expect(usageOfPods([{ spec: { containers: [container, container] } }])).toEqual({
      pods: 1,
      cpu: 1,
      'requests.cpu': 1,
      memory: 2 * 2 ** 30,
      'requests.memory': 2 * 2 ** 30,
      'limits.memory': 2 * 2 ** 30,
      'requests.nvidia.com/gpu': 2,
      'limits.nvidia.com/gpu': 2,
    });
  });
});

describe('hasDefaultCpuLimit', () => {
  it('finds a container default CPU limit', () => {
    expect(
      hasDefaultCpuLimit([{ spec: { limits: [{ type: 'Container', default: { cpu: '1' } }] } }])
    ).toBe(true);
    expect(
      hasDefaultCpuLimit([{ spec: { limits: [{ type: 'Pod', default: { cpu: '1' } }] } }])
    ).toBe(false);
  });
});

describe('kueueQueues', () => {
  const lq: LocalQueueJson = {
    apiVersion: 'kueue.x-k8s.io/v1beta2',
    kind: 'LocalQueue',
    metadata: { name: 'team-queue', namespace: 'ml' },
    spec: { clusterQueue: 'gpu' },
    status: {
      pendingWorkloads: 1,
      flavorsUsage: [{ name: 'h100', resources: [{ name: 'nvidia.com/gpu', total: '3' }] }],
    },
  };
  const cq = {
    apiVersion: 'kueue.x-k8s.io/v1beta2',
    kind: 'ClusterQueue',
    metadata: { name: 'gpu' },
    spec: {
      resourceGroups: [
        {
          flavors: [
            { name: 'h100', resources: [{ name: 'nvidia.com/gpu', nominalQuota: '8' }] },
            { name: 'a100', resources: [{ name: 'nvidia.com/gpu', nominalQuota: '4' }] },
          ],
        },
      ],
    },
    status: {
      flavorsUsage: [
        { name: 'h100', resources: [{ name: 'nvidia.com/gpu', total: '6' }] },
        { name: 'a100', resources: [{ name: 'nvidia.com/gpu', total: '1' }] },
      ],
    },
  };

  it('adds up the GPU quota and usage over the flavors', () => {
    expect(kueueQueues([lq], [cq], 'nvidia.com/gpu')).toEqual([
      {
        localQueue: 'team-queue',
        clusterQueue: 'gpu',
        namespaceUsed: 3,
        pending: 1,
        nominal: 12,
        clusterUsed: 7,
        noGpuQuota: false,
      },
    ]);
  });

  it('reads the v1beta1 status field and works without ClusterQueue access', () => {
    const old = { ...lq, status: { flavorUsage: lq.status!.flavorsUsage } };
    expect(kueueQueues([old], null, 'nvidia.com/gpu')[0]).toEqual({
      localQueue: 'team-queue',
      clusterQueue: 'gpu',
      namespaceUsed: 3,
      pending: 0,
    });
  });

  it('notices a ClusterQueue without GPU quota', () => {
    const cpuOnly = {
      ...cq,
      spec: {
        resourceGroups: [
          { flavors: [{ name: 'cpu', resources: [{ name: 'cpu', nominalQuota: '64' }] }] },
        ],
      },
    };
    expect(kueueQueues([lq], [cpuOnly], 'nvidia.com/gpu')[0].noGpuQuota).toBe(true);
  });
});
