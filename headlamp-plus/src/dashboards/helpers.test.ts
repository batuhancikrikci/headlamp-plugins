import { usageFromMetrics, workloadOf, workloadRows } from './efficiency';
import { age, duration } from './format';
import { cronIssues, cronRows, parseCron, previousRun, runningJobs } from './jobs';
import { ingressIssues, policyCoverage, serviceIssues } from './network';
import { heaviest, nodeAllocation, podLoads, taintLabel } from './node';
import { clusterAdmins, podFindings, podSecurityRows, securityRows } from './security';
import {
  classRows,
  defaultClassIssues,
  fillIssues,
  pvIssues,
  StorageClassJson,
  volumeFill,
} from './storage';
import {
  blockingPdbs,
  deprecatedApis,
  deprecatedIssues,
  kubeletVersions,
  skewIssues,
} from './upgrade';

const old = '2020-01-01T00:00:00Z';
const at = (iso: string) => Date.parse(iso);

describe('cron schedules', () => {
  it('finds the previous run of common schedules', () => {
    const now = at('2026-11-11T10:17:30Z');
    expect(previousRun(parseCron('*/15 * * * *')!, now)).toBe(at('2026-11-11T10:15:00Z'));
    expect(previousRun(parseCron('@daily')!, now)).toBe(at('2026-11-11T00:00:00Z'));
    expect(previousRun(parseCron('30 2 * * MON-FRI')!, now)).toBe(at('2026-11-11T02:30:00Z'));
    // 2026-11-11 is a Wednesday; the last Sunday 03:00 is 2026-11-08.
    expect(previousRun(parseCron('0 3 * * 0')!, now)).toBe(at('2026-11-08T03:00:00Z'));
    expect(previousRun(parseCron('0 0 1 jan *')!, now)).toBe(at('2026-01-01T00:00:00Z'));
  });

  it('matches day of month or day of week when both are set', () => {
    // The 1st, or any Friday: Friday 2026-11-06 is later than 2026-11-01.
    expect(previousRun(parseCron('0 0 1 * 5')!, at('2026-11-11T00:00:00Z'))).toBe(
      at('2026-11-06T00:00:00Z')
    );
  });

  it('rejects what it does not understand', () => {
    expect(parseCron('CRON_TZ=Europe/Istanbul 0 * * * *')).toBeUndefined();
    expect(parseCron('61 * * * *')).toBeUndefined();
    expect(parseCron('* * *')).toBeUndefined();
  });
});

describe('cron jobs', () => {
  const now = at('2026-11-11T10:17:30Z');
  const job = (name: string, created: string, state: 'failed' | 'complete' | 'active') => ({
    metadata: {
      name,
      namespace: 'ops',
      creationTimestamp: created,
      ownerReferences: [{ kind: 'CronJob', name: 'backup' }],
    },
    status: {
      startTime: created,
      active: state === 'active' ? 1 : 0,
      conditions:
        state === 'active'
          ? []
          : [{ type: state === 'failed' ? 'Failed' : 'Complete', status: 'True' }],
    },
  });
  const cronJob = (status: Record<string, unknown>, spec: Record<string, unknown> = {}) => ({
    metadata: { name: 'backup', namespace: 'ops', creationTimestamp: old },
    spec: { schedule: '0 * * * *', ...spec },
    status,
  });

  it('reports failing streaks, missed runs and runs outlasting the schedule', () => {
    const jobs = [
      job('backup-1', '2026-11-11T06:00:00Z', 'complete'),
      job('backup-2', '2026-11-11T07:00:00Z', 'failed'),
      job('backup-3', '2026-11-11T08:00:00Z', 'failed'),
      job('backup-4', '2026-11-11T08:30:00Z', 'active'),
    ];
    const [row] = cronRows([cronJob({ lastScheduleTime: '2026-11-11T08:00:00Z' })], jobs, now);
    expect(row.runs).toEqual(['complete', 'failed', 'failed', 'active']);
    expect(row.failingStreak).toBe(2);
    expect(row.missedAt).toBe(at('2026-11-11T10:00:00Z'));
    expect(row.overdue).toEqual(['backup-4']);
    expect(cronIssues([row]).map(i => i.title)).toEqual([
      'Failed 2 runs in a row',
      'Missed a scheduled run',
      'Still running when the next run was due',
    ]);
  });

  it('accepts a recent run and does not judge suspended or zoned schedules', () => {
    const fine = cronRows([cronJob({ lastScheduleTime: '2026-11-11T10:00:00Z' })], [], now);
    expect(cronIssues(fine)).toEqual([]);
    const suspended = cronRows([cronJob({}, { suspend: true })], [], now);
    expect(suspended[0].missedAt).toBeUndefined();
    const zoned = cronRows([cronJob({}, { timeZone: 'Europe/Istanbul' })], [], now);
    expect(zoned[0]).toMatchObject({ checked: false, missedAt: undefined });
  });

  it('lists running jobs longest first', () => {
    const jobs = [
      job('a', '2026-11-11T10:00:00Z', 'active'),
      job('b', '2026-11-11T09:00:00Z', 'active'),
      job('c', '2026-11-11T08:00:00Z', 'complete'),
    ];
    expect(runningJobs(jobs, now).map(j => j.name)).toEqual(['b', 'a']);
  });
});

describe('storage', () => {
  const sc = (name: string, isDefault = false): StorageClassJson => ({
    metadata: {
      name,
      annotations: isDefault ? { 'storageclass.kubernetes.io/is-default-class': 'true' } : {},
    },
    provisioner: 'csi.example.com',
  });

  it('reports released and failed volumes and the default class', () => {
    expect(
      pvIssues({
        metadata: { name: 'pv1' },
        spec: { claimRef: { namespace: 'db', name: 'data' } },
        status: { phase: 'Released' },
      })[0]
    ).toMatchObject({ level: 'warning', title: 'Released' });
    expect(pvIssues({ metadata: { name: 'pv2' }, status: { phase: 'Failed' } })[0].level).toBe(
      'error'
    );
    expect(defaultClassIssues([sc('a'), sc('b')])[0].title).toBe('No default storage class');
    expect(defaultClassIssues([sc('a', true), sc('b', true)])[0].title).toBe(
      'Several default storage classes'
    );
    expect(defaultClassIssues([sc('a', true), sc('b')])).toEqual([]);
  });

  it('sums claims and volumes per class', () => {
    const rows = classRows(
      [sc('fast', true), sc('slow')],
      [
        { spec: { storageClassName: 'fast', resources: { requests: { storage: '10Gi' } } } },
        {
          spec: { storageClassName: 'fast', resources: { requests: { storage: '5Gi' } } },
          status: { phase: 'Pending' },
        },
        { spec: { resources: { requests: { storage: '1Gi' } } } },
      ],
      [{ spec: { storageClassName: 'fast', capacity: { storage: '10Gi' } } }]
    );
    expect(rows.map(r => r.name)).toEqual(['fast', '(no class)', 'slow']);
    expect(rows[0]).toMatchObject({
      isDefault: true,
      claims: 2,
      pending: 1,
      requested: 15 * 2 ** 30,
      volumes: 1,
    });
  });

  it('joins the volume stats and reports full volumes', () => {
    const sample = (claim: string, value: number) => ({
      metric: { namespace: 'db', persistentvolumeclaim: claim },
      value: [0, String(value)] as [number, string],
    });
    const rows = volumeFill(
      [sample('a', 50), sample('b', 95), sample('c', 85)],
      [sample('a', 100), sample('b', 100), sample('c', 100)]
    );
    expect(rows.map(r => r.claim)).toEqual(['b', 'c', 'a']);
    expect(fillIssues(rows).map(i => [i.name, i.level])).toEqual([
      ['b', 'error'],
      ['c', 'warning'],
    ]);
  });
});

describe('security', () => {
  const pod = (namespace: string, spec: Record<string, unknown>) => ({
    metadata: { name: 'p', namespace },
    spec,
    status: { phase: 'Running' },
  });

  it('finds what weakens the isolation of a pod', () => {
    const findings = podFindings({
      spec: {
        hostNetwork: true,
        securityContext: { runAsUser: 0 },
        volumes: [{ name: 'root', hostPath: { path: '/' } }],
        containers: [
          {
            name: 'app',
            securityContext: { privileged: true, capabilities: { add: ['NET_ADMIN', 'CHOWN'] } },
          },
          {
            name: 'side',
            securityContext: { runAsUser: 1000 },
            resources: { limits: { memory: '1Gi' } },
          },
        ],
      },
    });
    expect(Object.fromEntries(findings.map(f => [f.kind, f.detail]))).toEqual({
      privileged: 'app',
      hostNamespaces: 'network',
      hostPath: '/',
      capabilities: 'app: NET_ADMIN',
      root: 'UID 0: app',
      noMemoryLimit: 'app',
    });
  });

  it('leaves system namespaces out unless asked', () => {
    const pods = [pod('kube-system', { hostNetwork: true }), pod('shop', { hostPID: true })];
    expect(securityRows(pods, false).map(r => r.namespace)).toEqual(['shop']);
    expect(securityRows(pods, true)).toHaveLength(2);
  });

  it('reads Pod Security labels and cluster-admin subjects', () => {
    const rows = podSecurityRows(
      [
        { metadata: { name: 'a', labels: { 'pod-security.kubernetes.io/enforce': 'restricted' } } },
        { metadata: { name: 'b' } },
      ],
      false
    );
    expect(rows.map(r => [r.name, r.enforce])).toEqual([
      ['b', undefined],
      ['a', 'restricted'],
    ]);
    expect(
      clusterAdmins([
        {
          metadata: { name: 'cluster-admin' },
          roleRef: { kind: 'ClusterRole', name: 'cluster-admin' },
          subjects: [{ kind: 'Group', name: 'system:masters' }],
        },
        {
          metadata: { name: 'ci' },
          roleRef: { kind: 'ClusterRole', name: 'cluster-admin' },
          subjects: [{ kind: 'ServiceAccount', name: 'deployer', namespace: 'ci' }],
        },
      ])
    ).toEqual([{ binding: 'ci', kind: 'ServiceAccount', name: 'deployer', namespace: 'ci' }]);
  });
});

describe('network', () => {
  const now = at('2026-11-11T10:00:00Z');
  const svc = (name: string, spec: Record<string, unknown>, status = {}) => ({
    metadata: { name, namespace: 'shop', creationTimestamp: old },
    spec,
    status,
  });

  it('reports load balancers without address and services without ready endpoints', () => {
    const services = [
      svc('web', { type: 'LoadBalancer', selector: { app: 'web' } }),
      svc('api', { selector: { app: 'api' } }),
      svc('external', { type: 'ExternalName' }),
    ];
    const slices = [
      {
        metadata: { namespace: 'shop', labels: { 'kubernetes.io/service-name': 'web' } },
        endpoints: [{ conditions: { ready: true } }],
      },
      {
        metadata: { namespace: 'shop', labels: { 'kubernetes.io/service-name': 'api' } },
        endpoints: [{ conditions: { ready: false } }],
      },
    ];
    expect(serviceIssues(services, slices, now).map(i => `${i.name}: ${i.title}`)).toEqual([
      'web: No external address',
      'api: No ready endpoints',
    ]);
  });

  it('reports ingresses without address or with missing backends', () => {
    const issues = ingressIssues(
      [
        {
          metadata: { name: 'site', namespace: 'shop', creationTimestamp: old },
          spec: { rules: [{ http: { paths: [{ backend: { service: { name: 'gone' } } }] } }] },
        },
      ],
      [svc('web', {})],
      now
    );
    expect(issues.map(i => i.title)).toEqual(['Backend service missing', 'No address']);
  });

  it('counts network policies of namespaces with pods', () => {
    const rows = policyCoverage(
      [
        { metadata: { namespace: 'a' } },
        { metadata: { namespace: 'a' } },
        { metadata: { namespace: 'b' } },
        { metadata: { namespace: 'kube-system' } },
      ],
      [{ metadata: { namespace: 'b' } }]
    );
    expect(rows).toEqual([
      { namespace: 'a', pods: 2, policies: 0 },
      { namespace: 'b', pods: 1, policies: 1 },
    ]);
  });
});

describe('upgrade readiness', () => {
  const node = (name: string, version: string) => ({
    metadata: { name },
    status: { nodeInfo: { kubeletVersion: version } },
  });

  it('compares the kubelets with the API server', () => {
    const rows = kubeletVersions(
      [node('a', 'v1.34.1'), node('b', 'v1.31.0'), node('c', 'v1.30.2'), node('d', 'v1.35.0')],
      'v1.34.2'
    );
    expect(rows.map(r => [r.version, r.behind])).toEqual([
      ['v1.30.2', 4],
      ['v1.31.0', 3],
      ['v1.34.1', 0],
      ['v1.35.0', -1],
    ]);
    expect(skewIssues(rows, 'v1.34.2').map(i => [i.name, i.level])).toEqual([
      ['c', 'error'],
      ['b', 'warning'],
      ['d', 'error'],
    ]);
  });

  it('finds budgets that block drains and deprecated APIs', () => {
    const blocking = blockingPdbs([
      { metadata: { name: 'db' }, status: { expectedPods: 1, disruptionsAllowed: 0 } },
      { metadata: { name: 'web' }, status: { expectedPods: 3, disruptionsAllowed: 1 } },
      { metadata: { name: 'empty' }, status: { expectedPods: 0, disruptionsAllowed: 0 } },
    ]);
    expect(blocking.map(p => p.metadata?.name)).toEqual(['db']);
    const apis = deprecatedApis([
      {
        metric: {
          group: 'flowcontrol.apiserver.k8s.io',
          version: 'v1beta3',
          resource: 'flowschemas',
          removed_release: '1.35',
        },
        value: [0, '1'],
      },
    ]);
    expect(deprecatedIssues(apis, 'v1.34.0')[0]).toMatchObject({
      level: 'error',
      title: 'Deprecated, removed in 1.35',
    });
  });
});

describe('resource efficiency', () => {
  const pod = (name: string, owner: Record<string, unknown> | undefined, cpu: string) => ({
    metadata: {
      name,
      namespace: 'shop',
      labels: { 'pod-template-hash': '5d8f9' },
      ownerReferences: owner ? [owner] : undefined,
    },
    spec: { containers: [{ resources: { requests: { cpu, memory: '1Gi' } } }] },
    status: { phase: 'Running' },
  });

  it('groups pods by workload with requests and usage', () => {
    expect(workloadOf(pod('web-1', { kind: 'ReplicaSet', name: 'web-5d8f9' }, '1'))).toEqual({
      kind: 'Deployment',
      namespace: 'shop',
      name: 'web',
    });
    const usage = usageFromMetrics([
      { metadata: { namespace: 'shop', name: 'web-1' }, containers: [{ usage: { cpu: '100m' } }] },
      { metadata: { namespace: 'shop', name: 'web-2' }, containers: [{ usage: { cpu: '300m' } }] },
    ]);
    const rows = workloadRows(
      [
        pod('web-1', { kind: 'ReplicaSet', name: 'web-5d8f9' }, '1'),
        pod('web-2', { kind: 'ReplicaSet', name: 'web-5d8f9' }, '1'),
        pod('db-0', { kind: 'StatefulSet', name: 'db' }, '2'),
      ],
      usage
    );
    expect(rows[0]).toMatchObject({ kind: 'Deployment', name: 'web', pods: 2 });
    expect(rows[0].requested.cpu).toBeCloseTo(2);
    expect(rows[0].used?.cpu).toBeCloseTo(0.4);
    expect(rows[1]).toMatchObject({ kind: 'StatefulSet', name: 'db' });
    expect(rows[1].used).toBeUndefined();
  });
});

describe('node', () => {
  it('sums the requests of the pods holding resources', () => {
    const pods = [
      {
        metadata: { name: 'a', namespace: 'x' },
        spec: { containers: [{ resources: { requests: { cpu: '500m', memory: '1Gi' } } }] },
        status: { phase: 'Running' },
      },
      {
        metadata: { name: 'b', namespace: 'x' },
        spec: { containers: [{ resources: { requests: { cpu: '2' } } }] },
        status: { phase: 'Succeeded' },
      },
    ];
    const allocation = nodeAllocation(
      { status: { allocatable: { cpu: '4', memory: '8Gi', pods: '110' } } },
      pods
    );
    expect(allocation).toMatchObject({
      allocatable: { cpu: 4, memory: 8 * 2 ** 30, pods: 110 },
      requests: { cpu: 0.5, memory: 2 ** 30 },
      pods: 1,
    });
    expect(heaviest(podLoads(pods), 'cpu').map(l => l.name)).toEqual(['a']);
    expect(taintLabel({ key: 'gpu', value: 'true', effect: 'NoSchedule' })).toBe(
      'gpu=true:NoSchedule'
    );
  });
});

describe('time formatting', () => {
  it('formats ages and durations', () => {
    const now = at('2026-11-11T10:00:00Z');
    expect(age('2026-11-11T09:59:30Z', now)).toBe('30s ago');
    expect(age('2026-11-11T07:00:00Z', now)).toBe('3h ago');
    expect(age(undefined, now)).toBe('—');
    expect(duration(3 * 3600 + 300)).toBe('3h 5m');
    expect(duration(3 * 86400 + 7200)).toBe('3d 2h');
  });
});
