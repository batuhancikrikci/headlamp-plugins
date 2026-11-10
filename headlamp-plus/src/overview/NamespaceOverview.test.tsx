import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

interface FixtureJson {
  metadata: { name: string; namespace?: string; uid?: string; [key: string]: unknown };
  [key: string]: unknown;
}

// Headlamp's runtime (cluster data, API proxy, shared components) is the external dependency;
// lists, pod metrics and Prometheus answers come from fixtures.
const data = vi.hoisted(() => {
  const object = (json: FixtureJson) => ({ jsonData: json, metadata: json.metadata });
  return {
    object,
    lists: {} as Record<string, [unknown[] | null, unknown]>,
    requests: [] as string[],
    respond: (path: string): unknown => {
      throw Object.assign(new Error(`no fixture for ${path}`), { status: 404 });
    },
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const cls = (kind: string) => ({ useList: () => data.lists[kind] ?? [[], null] });
  return {
    ApiProxy: {
      request: async (path: string) => {
        data.requests.push(path);
        return data.respond(path);
      },
    },
    K8s: {
      ResourceClasses: Object.fromEntries(
        [
          'Pod',
          'Deployment',
          'StatefulSet',
          'DaemonSet',
          'Job',
          'CronJob',
          'PersistentVolumeClaim',
          'ResourceQuota',
        ].map(kind => [kind, cls(kind)])
      ),
      useCluster: () => 'k8stest',
    },
    Router: { createRouteURL: (name: string) => `/c/k8stest/${name}` },
  };
});
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ kubeObject }: { kubeObject: { metadata: { name: string } } }) => (
    <a href="#object">{kubeObject.metadata.name}</a>
  ),
}));

import { NamespaceOverview } from './NamespaceOverview';

const old = '2020-01-01T00:00:00Z';

function pod(name: string, phase: string, cpu = '500m') {
  return data.object({
    metadata: { name, namespace: 'ml', uid: `pod-${name}`, creationTimestamp: old },
    spec: { containers: [{ resources: { requests: { cpu, memory: '1Gi' } } }] },
    status: { phase },
  });
}

beforeEach(() => {
  data.requests = [];
  data.lists = {
    Pod: [[pod('api-1', 'Running'), pod('api-2', 'Running'), pod('stuck', 'Pending')], null],
    Deployment: [
      [
        data.object({
          metadata: { name: 'api', namespace: 'ml', uid: 'd1' },
          spec: { replicas: 2 },
          status: { readyReplicas: 2 },
        }),
      ],
      null,
    ],
    PersistentVolumeClaim: [
      [
        data.object({
          metadata: { name: 'data', namespace: 'ml', uid: 'c1', creationTimestamp: old },
          spec: { storageClassName: 'fast' },
          status: { phase: 'Pending' },
        }),
      ],
      null,
    ],
    ResourceQuota: [
      [
        data.object({
          metadata: { name: 'team', namespace: 'ml' },
          status: { hard: { 'requests.cpu': '4' }, used: { 'requests.cpu': '3800m' } },
        }),
      ],
      null,
    ],
  };
  data.respond = (path: string) => {
    if (path.includes('metrics.k8s.io')) {
      return {
        items: [
          {
            metadata: { name: 'api-1' },
            containers: [{ usage: { cpu: '900m', memory: '700Mi' } }],
          },
          { metadata: { name: 'api-2' }, containers: [{ usage: { cpu: '100m', memory: '2Gi' } }] },
        ],
      };
    }
    throw Object.assign(new Error('forbidden'), { status: 403 });
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <NamespaceOverview namespace="ml" />
    </MemoryRouter>
  );
}

describe('NamespaceOverview', () => {
  it('reports pending pods, unbound claims and a nearly full quota', async () => {
    renderPage();
    expect(screen.getByText('Pod is pending')).toBeTruthy();
    expect(screen.getByText('Claim not bound')).toBeTruthy();
    expect(screen.getByText('requests.cpu quota nearly used')).toBeTruthy();
    expect(screen.getByText('1 not bound')).toBeTruthy();
    // The quota panel replaces the requests panel when a quota exists.
    expect(screen.getByText('Quota')).toBeTruthy();
    expect(screen.getByText('95%')).toBeTruthy();
  });

  it('shows usage and the busiest pods from the metrics API', async () => {
    renderPage();
    expect(await screen.findByText('cores · 1.5 requested')).toBeTruthy();
    expect(data.requests).toContain('/apis/metrics.k8s.io/v1beta1/namespaces/ml/pods');
    const top = screen.getByText('CPU (cores)').parentElement!;
    expect(top.textContent).toMatch(/api-1.*0\.9.*api-2.*0\.1/);
  });

  it('asks for a Prometheus service when none is found', async () => {
    renderPage();
    expect(await screen.findByText(/No Prometheus compatible service was found/)).toBeTruthy();
  });
});
