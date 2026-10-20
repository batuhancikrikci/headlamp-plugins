import {
  clusterCapacity,
  isNodeReady,
  jobIssues,
  jobState,
  nodeIssues,
  nodeRoles,
  nodeUsage,
  parseCpu,
  parseMemory,
  podIssues,
  podPhases,
  sortIssues,
  totalReplicas,
  usageTone,
  workloadIssues,
  workloadReplicas,
} from './clusterHealth';

const NOW = Date.parse('2026-10-03T12:00:00Z');

function node(name: string, overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name, uid: `uid-${name}`, labels: {} },
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
      allocatable: { cpu: '4', memory: '16Gi', pods: '110' },
    },
    ...overrides,
  };
}

describe('quantities', () => {
  it('parses CPU quantities into cores', () => {
    expect(parseCpu('2')).toBe(2);
    expect(parseCpu('250m')).toBe(0.25);
    expect(parseCpu('1500000000n')).toBeCloseTo(1.5);
    expect(parseCpu('500000u')).toBeCloseTo(0.5);
    expect(parseCpu(undefined)).toBe(0);
  });

  it('parses memory quantities into bytes', () => {
    expect(parseMemory('1Ki')).toBe(1024);
    expect(parseMemory('16Gi')).toBe(16 * 2 ** 30);
    expect(parseMemory('1G')).toBe(1e9);
    expect(parseMemory('2048')).toBe(2048);
    expect(parseMemory('garbage!')).toBe(0);
  });
});

describe('nodes', () => {
  it('reads readiness and roles', () => {
    expect(isNodeReady(node('a'))).toBe(true);
    expect(isNodeReady({ status: { conditions: [{ type: 'Ready', status: 'Unknown' }] } })).toBe(
      false
    );
    expect(nodeRoles(node('a'))).toEqual(['worker']);
    expect(
      nodeRoles({
        metadata: {
          labels: {
            'node-role.kubernetes.io/control-plane': '',
            'node-role.kubernetes.io/etcd': '',
          },
        },
      })
    ).toEqual(['control-plane', 'etcd']);
  });

  it('reports not-ready nodes, pressure conditions and cordoned nodes', () => {
    expect(nodeIssues(node('ok'))).toEqual([]);

    const issues = nodeIssues({
      metadata: { name: 'bad' },
      spec: { unschedulable: true },
      status: {
        conditions: [
          { type: 'Ready', status: 'False', message: 'kubelet stopped posting status' },
          { type: 'DiskPressure', status: 'True', message: 'low disk' },
          { type: 'MemoryPressure', status: 'False' },
        ],
      },
    });
    expect(issues.map(i => [i.level, i.title])).toEqual([
      ['error', 'Node is not ready'],
      ['warning', 'Disk pressure'],
      ['warning', 'Scheduling disabled'],
    ]);
    expect(issues[0].detail).toBe('kubelet stopped posting status');
  });
});

describe('pods', () => {
  const pod = (status: Record<string, unknown>, ageMinutes = 60) => ({
    metadata: {
      name: 'p',
      namespace: 'ns',
      creationTimestamp: new Date(NOW - ageMinutes * 60_000).toISOString(),
    },
    status,
  });

  it('counts phases', () => {
    expect(
      podPhases([
        pod({ phase: 'Running' }),
        pod({ phase: 'Running' }),
        pod({ phase: 'Pending' }),
        pod({ phase: 'Succeeded' }),
        pod({ phase: 'Failed' }),
        pod({}),
      ])
    ).toEqual({ running: 2, pending: 1, succeeded: 1, failed: 1, unknown: 1 });
  });

  it('ignores healthy and completed pods', () => {
    expect(podIssues(pod({ phase: 'Running' }), NOW)).toEqual([]);
    expect(podIssues(pod({ phase: 'Succeeded' }), NOW)).toEqual([]);
  });

  it('reports failed pods and failing containers', () => {
    expect(podIssues(pod({ phase: 'Failed', reason: 'Evicted' }), NOW)[0]).toMatchObject({
      level: 'error',
      title: 'Pod failed (Evicted)',
    });

    const crash = podIssues(
      pod({
        phase: 'Running',
        containerStatuses: [
          { name: 'app', restartCount: 12, state: { waiting: { reason: 'CrashLoopBackOff' } } },
        ],
      }),
      NOW
    )[0];
    expect(crash).toMatchObject({ level: 'error', title: 'CrashLoopBackOff' });
    expect(crash.detail).toContain('Container app · 12 restarts');
  });

  it('reports pods pending for more than five minutes only', () => {
    expect(podIssues(pod({ phase: 'Pending' }, 2), NOW)).toEqual([]);
    expect(podIssues(pod({ phase: 'Pending' }, 10), NOW)[0]).toMatchObject({
      level: 'warning',
      title: 'Pod is pending',
    });
    // A starting container (ContainerCreating) is not a failure.
    expect(
      podIssues(
        pod(
          {
            phase: 'Pending',
            containerStatuses: [{ name: 'a', state: { waiting: { reason: 'ContainerCreating' } } }],
          },
          1
        ),
        NOW
      )
    ).toEqual([]);
  });
});

describe('workloads', () => {
  it('reads replicas of deployments and daemon sets', () => {
    expect(workloadReplicas({ spec: { replicas: 3 }, status: { readyReplicas: 2 } })).toEqual({
      desired: 3,
      ready: 2,
    });
    expect(workloadReplicas({ status: { desiredNumberScheduled: 5, numberReady: 5 } })).toEqual({
      desired: 5,
      ready: 5,
    });
  });

  it('reports workloads with missing replicas', () => {
    const meta = { metadata: { name: 'web', namespace: 'ns' } };
    expect(workloadIssues('Deployment', { ...meta, spec: { replicas: 0 }, status: {} })).toEqual(
      []
    );
    expect(
      workloadIssues('Deployment', { ...meta, spec: { replicas: 3 }, status: { readyReplicas: 1 } })
    ).toMatchObject([{ level: 'warning', detail: '1 of 3 ready' }]);
    expect(
      workloadIssues('StatefulSet', { ...meta, spec: { replicas: 2 }, status: {} })
    ).toMatchObject([{ level: 'error', title: 'No replica is ready' }]);
  });
});

describe('aggregation', () => {
  it('sorts errors first, then nodes, workloads and pods', () => {
    const sorted = sortIssues([
      { level: 'warning', kind: 'Node', name: 'n', title: '' },
      { level: 'error', kind: 'Pod', name: 'p', title: '' },
      { level: 'error', kind: 'Deployment', name: 'd', title: '' },
      { level: 'error', kind: 'Node', name: 'n', title: '' },
    ]);
    expect(sorted.map(i => `${i.level}:${i.kind}`)).toEqual([
      'error:Node',
      'error:Deployment',
      'error:Pod',
      'warning:Node',
    ]);
  });

  it('sums capacity and usage', () => {
    const nodes = [node('a'), node('b')];
    const metrics = [
      { metadata: { name: 'a' }, usage: { cpu: '1000m', memory: '4Gi' } },
      { metadata: { name: 'b' }, usage: { cpu: '500m', memory: '4Gi' } },
    ];

    const capacity = clusterCapacity(nodes, metrics);
    expect(capacity.cpu).toEqual({ total: 8, used: 1.5 });
    expect(capacity.memory).toEqual({ total: 32 * 2 ** 30, used: 8 * 2 ** 30 });
    expect(capacity.podSlots).toBe(220);

    expect(clusterCapacity(nodes, null).cpu.used).toBeUndefined();
    expect(nodeUsage(nodes[0], metrics)?.cpu).toEqual({ used: 1, total: 4 });
    expect(nodeUsage(node('c'), metrics)).toBeUndefined();
  });

  it('maps utilisation to a tone', () => {
    expect(usageTone(1, 10)).toBe('success');
    expect(usageTone(8, 10)).toBe('warning');
    expect(usageTone(9.5, 10)).toBe('error');
    expect(usageTone(1, 0)).toBe('success');
  });
});

describe('jobs', () => {
  const job = (
    conditions: { type: string; status: string; reason?: string; message?: string }[]
  ) => ({
    metadata: { name: 'import', namespace: 'data' },
    status: { conditions },
  });

  it('reads the state of jobs and job sets', () => {
    expect(jobState(job([]))).toBe('active');
    expect(jobState(job([{ type: 'Complete', status: 'True' }]))).toBe('complete');
    expect(jobState(job([{ type: 'Completed', status: 'True' }]))).toBe('complete');
    expect(jobState(job([{ type: 'Failed', status: 'False' }]))).toBe('active');
    expect(jobState(job([{ type: 'Failed', status: 'True' }]))).toBe('failed');
  });

  it('reports failed jobs only', () => {
    expect(jobIssues('Job', job([{ type: 'Complete', status: 'True' }]))).toEqual([]);
    expect(
      jobIssues(
        'Job',
        job([
          {
            type: 'Failed',
            status: 'True',
            reason: 'BackoffLimitExceeded',
            message: 'too many retries',
          },
        ])
      )
    ).toMatchObject([
      { level: 'error', title: 'Job failed (BackoffLimitExceeded)', detail: 'too many retries' },
    ]);
  });

  it('sums replicas without counting surplus ready pods', () => {
    expect(
      totalReplicas([
        { spec: { replicas: 3 }, status: { readyReplicas: 2 } },
        { spec: { replicas: 1 }, status: { readyReplicas: 2 } },
        { status: { desiredNumberScheduled: 5, numberReady: 5 } },
      ])
    ).toEqual({ desired: 9, ready: 8 });
  });
});
