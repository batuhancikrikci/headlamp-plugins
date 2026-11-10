import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The cluster behind Headlamp's API proxy (and Prometheus behind its service proxy) is the
// external dependency: every GET is answered from the fixture with the longest matching prefix.
const api = vi.hoisted(() => {
  const old = '2020-01-01T00:00:00Z';
  const sample = (metric: Record<string, string>, value: number) => ({
    metric,
    value: [0, String(value)],
  });
  const promResults = (query: string) => {
    if (query === 'vector(1)') return [sample({}, 1)];
    if (query.includes('kubelet_volume_stats_used_bytes')) {
      return [sample({ namespace: 'shop', persistentvolumeclaim: 'data' }, 95)];
    }
    if (query.includes('kubelet_volume_stats_capacity_bytes')) {
      return [sample({ namespace: 'shop', persistentvolumeclaim: 'data' }, 100)];
    }
    if (query.includes('apiserver_requested_deprecated_apis')) {
      return [
        sample(
          {
            group: 'flowcontrol.apiserver.k8s.io',
            version: 'v1beta3',
            resource: 'flowschemas',
            removed_release: '1.35',
          },
          1
        ),
      ];
    }
    return [];
  };
  const fixtures: Record<string, unknown> = {
    '/api/v1/services': {
      items: [
        {
          metadata: {
            namespace: 'monitoring',
            name: 'prometheus-operated',
            creationTimestamp: old,
          },
          spec: { ports: [{ port: 9090 }], selector: { app: 'prometheus' } },
        },
        {
          metadata: { namespace: 'shop', name: 'web', creationTimestamp: old },
          spec: { type: 'LoadBalancer', selector: { app: 'web' } },
        },
      ],
    },
    '/apis/discovery.k8s.io/v1/endpointslices': {
      items: [
        {
          metadata: {
            namespace: 'monitoring',
            labels: { 'kubernetes.io/service-name': 'prometheus-operated' },
          },
          endpoints: [{ conditions: { ready: true } }],
        },
      ],
    },
    '/apis/networking.k8s.io/v1/ingresses': { items: [] },
    '/apis/networking.k8s.io/v1/networkpolicies': { items: [] },
    '/api/v1/persistentvolumeclaims': {
      items: [
        {
          metadata: { name: 'data', namespace: 'shop', creationTimestamp: old },
          spec: { storageClassName: 'fast', resources: { requests: { storage: '10Gi' } } },
          status: { phase: 'Bound' },
        },
      ],
    },
    '/api/v1/persistentvolumes': {
      items: [
        {
          metadata: { name: 'pv-old' },
          spec: { storageClassName: 'fast', capacity: { storage: '5Gi' } },
          status: { phase: 'Released' },
        },
      ],
    },
    '/apis/storage.k8s.io/v1/storageclasses': {
      items: [
        {
          metadata: {
            name: 'fast',
            annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' },
          },
          provisioner: 'csi.example.com',
        },
      ],
    },
    '/api/v1/pods': {
      items: [
        {
          metadata: {
            name: 'web-1',
            namespace: 'shop',
            labels: { 'pod-template-hash': 'abc12' },
            ownerReferences: [{ kind: 'ReplicaSet', name: 'web-abc12', controller: true }],
          },
          spec: {
            nodeName: 'worker-1',
            hostNetwork: true,
            containers: [
              {
                name: 'app',
                securityContext: { privileged: true },
                resources: { requests: { cpu: '2', memory: '2Gi' } },
              },
            ],
          },
          status: { phase: 'Running' },
        },
      ],
    },
    '/api/v1/namespaces': { items: [{ metadata: { name: 'shop' } }] },
    '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings': {
      items: [
        {
          metadata: { name: 'ci-admin' },
          roleRef: { kind: 'ClusterRole', name: 'cluster-admin' },
          subjects: [{ kind: 'ServiceAccount', name: 'deployer', namespace: 'ci' }],
        },
      ],
    },
    '/apis/batch/v1/cronjobs': {
      items: [
        {
          metadata: { name: 'backup', namespace: 'ops', creationTimestamp: old },
          spec: { schedule: '@hourly' },
          status: { lastScheduleTime: old },
        },
      ],
    },
    '/apis/batch/v1/jobs': { items: [] },
    '/version': { gitVersion: 'v1.34.2' },
    '/api/v1/nodes': {
      items: [
        { metadata: { name: 'worker-1' }, status: { nodeInfo: { kubeletVersion: 'v1.31.0' } } },
      ],
    },
    '/apis/policy/v1/poddisruptionbudgets': {
      items: [
        {
          metadata: { name: 'db', namespace: 'shop' },
          spec: { maxUnavailable: 0 },
          status: { expectedPods: 2, currentHealthy: 2, desiredHealthy: 2, disruptionsAllowed: 0 },
        },
      ],
    },
    '/apis/metrics.k8s.io/v1beta1/pods': {
      items: [
        {
          metadata: { name: 'web-1', namespace: 'shop' },
          containers: [{ usage: { cpu: '500m', memory: '1Gi' } }],
        },
      ],
    },
    '/apis/metrics.k8s.io/v1beta1/nodes/worker-1': {
      usage: { cpu: '1', memory: '4Gi' },
    },
  };
  return {
    respond: (path: string): unknown => {
      const query = path.match(/\/api\/v1\/query\?query=([^&]*)/);
      if (query) {
        return { status: 'success', data: { result: promResults(decodeURIComponent(query[1])) } };
      }
      if (path.includes('/query_range?')) return { status: 'success', data: { result: [] } };
      const key = Object.keys(fixtures)
        .filter(prefix => path === prefix || path.startsWith(`${prefix}?`))
        .sort((a, b) => b.length - a.length)[0];
      if (!key) throw Object.assign(new Error(`no fixture for ${path}`), { status: 404 });
      return fixtures[key];
    },
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: { request: async (path: string) => api.respond(path) },
  K8s: { useCluster: () => 'test' },
  Router: {
    createRouteURL: (name: string, params: Record<string, string> = {}) =>
      `/c/test/${name}/${Object.values(params).join('/')}`,
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: () => null,
}));
// recharts measures the DOM, which jsdom does not lay out; the chart itself is not under test.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ...actual,
    ResponsiveContainer: Passthrough,
    AreaChart: Passthrough,
    Area: Empty,
    CartesianGrid: Empty,
    ReferenceLine: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

import { EfficiencyDashboard } from './EfficiencyDashboard';
import { JobsDashboard } from './JobsDashboard';
import { NetworkDashboard } from './NetworkDashboard';
import { NodeOverview } from './NodeOverview';
import { SecurityDashboard } from './SecurityDashboard';
import { StorageDashboard } from './StorageDashboard';
import { UpgradeDashboard } from './UpgradeDashboard';

const inRouter = (element: React.ReactElement) => render(<MemoryRouter>{element}</MemoryRouter>);

describe('dashboards', () => {
  it('storage: released volumes, the default class and full volumes', async () => {
    inRouter(<StorageDashboard />);
    expect(await screen.findByText('Released')).toBeTruthy();
    expect(await screen.findByText('Volume 95% full')).toBeTruthy();
    expect(screen.getByText('default: fast')).toBeTruthy();
    expect(screen.getByText('csi.example.com')).toBeTruthy();
  });

  it('security: privileged pods and cluster-admin service accounts', async () => {
    inRouter(<SecurityDashboard />);
    expect((await screen.findAllByText('Privileged container')).length).toBeGreaterThan(1);
    expect(screen.getByText('ci/deployer')).toBeTruthy();
    expect(screen.getByText('1 error · 1 warning')).toBeTruthy();
  });

  it('network: services without endpoints and namespaces without policies', async () => {
    inRouter(<NetworkDashboard />);
    expect(await screen.findByText('No external address')).toBeTruthy();
    expect(screen.getByText('No ready endpoints')).toBeTruthy();
    expect(screen.getAllByText('shop').length).toBeGreaterThan(0);
  });

  it('jobs: a cron job behind its schedule', async () => {
    inRouter(<JobsDashboard />);
    expect(await screen.findByText('Missed a scheduled run')).toBeTruthy();
    expect(screen.getByText('@hourly')).toBeTruthy();
  });

  it('upgrade: kubelet skew, blocking budgets and deprecated APIs', async () => {
    inRouter(<UpgradeDashboard />);
    expect(
      await screen.findByText('Kubelet v1.31.0 is at the oldest supported version')
    ).toBeTruthy();
    expect(screen.getAllByText('Blocks node drains').length).toBeGreaterThan(0);
    expect(await screen.findByText('Deprecated, removed in 1.35')).toBeTruthy();
  });

  it('efficiency: requested against used per workload', async () => {
    inRouter(<EfficiencyDashboard />);
    expect(await screen.findByText('web')).toBeTruthy();
    expect(screen.getByText('Deployment')).toBeTruthy();
    expect(screen.getAllByText(/0\.5 \/ 2\.0/).length).toBe(2);
    fireEvent.click(screen.getByText('Last 24 hours (Prometheus)'));
    expect(await screen.findByText(/CPU 24h average/)).toBeTruthy();
  });

  it('node: allocation, usage and the heaviest pods', async () => {
    inRouter(
      <NodeOverview
        node={{
          metadata: { name: 'worker-1' },
          spec: { taints: [{ key: 'gpu', value: 'true', effect: 'NoSchedule' }] },
          status: {
            allocatable: { cpu: '4', memory: '8Gi', pods: '110' },
            conditions: [{ type: 'Ready', status: 'True' }],
          },
        }}
      />
    );
    expect(await screen.findByText('2.0 of 4.0 cores')).toBeTruthy();
    expect(await screen.findByText('1.0 cores')).toBeTruthy();
    expect(screen.getByText('gpu=true:NoSchedule')).toBeTruthy();
    expect(await screen.findByText('Heaviest pods (used)')).toBeTruthy();
  });
});
