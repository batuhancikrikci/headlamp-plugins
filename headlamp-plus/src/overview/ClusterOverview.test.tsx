import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Plain JSON standing in for Kubernetes objects, and the KubeObject-like wrapper around it.
interface FixtureJson {
  metadata: { name: string; namespace?: string; uid?: string; [key: string]: unknown };
  [key: string]: unknown;
}
interface Fixture {
  jsonData: FixtureJson;
  metadata: FixtureJson['metadata'];
}
type SelectorState = { filter: { namespaces: Set<string> } };

// Headlamp's runtime (cluster data, shared components) is the external dependency here; it is
// replaced by fixtures so the page can be rendered on its own.
const data = vi.hoisted(() => {
  const object = (json: FixtureJson): Fixture => ({ jsonData: json, metadata: json.metadata });
  return {
    object,
    lists: {} as Record<string, [Fixture[] | null, unknown]>,
    metrics: [null, null] as [unknown[] | null, unknown],
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => {
  const cls = (kind: string) => ({ useList: () => data.lists[kind] ?? [[], null] });
  return {
    K8s: {
      ResourceClasses: {
        Node: { ...cls('Node'), useMetrics: () => data.metrics },
        Pod: cls('Pod'),
        Namespace: cls('Namespace'),
        Deployment: cls('Deployment'),
        StatefulSet: cls('StatefulSet'),
        DaemonSet: cls('DaemonSet'),
      },
      event: { default: { maxLimit: 2000, useList: () => ({ items: [], errors: null }) } },
      useCluster: () => 'k8stest',
      getVersion: () => Promise.resolve({ gitVersion: 'v1.33.1' }),
    },
    Router: { createRouteURL: (name: string) => `/c/k8stest/${name}` },
  };
});
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  Link: ({ kubeObject }: { kubeObject: Fixture }) => (
    <a href="#object">{kubeObject.metadata.name}</a>
  ),
  ResourceListView: ({ title }: { title: string }) => <section aria-label={title} />,
  DateLabel: () => null,
  ShowHideLabel: () => null,
  StatusLabel: () => null,
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ useFilterFunc: () => () => true }));
vi.mock('react-redux', () => ({
  useSelector: (selector: (state: SelectorState) => unknown) =>
    selector({ filter: { namespaces: new Set<string>() } }),
}));

import { ClusterOverview } from './ClusterOverview';

const readyNode = (name: string, extra: Record<string, unknown> = {}) =>
  data.object({
    metadata: {
      name,
      uid: `node-${name}`,
      labels: { 'node-role.kubernetes.io/control-plane': '' },
    },
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
      allocatable: { cpu: '4', memory: '16Gi', pods: '110' },
      nodeInfo: { kubeletVersion: 'v1.33.1' },
    },
    ...extra,
  });

function renderPage() {
  return render(
    <MemoryRouter>
      <ClusterOverview />
    </MemoryRouter>
  );
}

beforeEach(() => {
  data.lists = {};
  data.metrics = [null, null];
});

describe('ClusterOverview', () => {
  it('shows a healthy cluster with usage from metrics', async () => {
    data.lists = {
      Node: [[readyNode('cp-1'), readyNode('cp-2')], null],
      Pod: [
        [data.object({ metadata: { name: 'p', uid: 'p' }, status: { phase: 'Running' } })],
        null,
      ],
      Namespace: [[data.object({ metadata: { name: 'default', uid: 'ns' } })], null],
      Deployment: [
        [
          data.object({
            metadata: { name: 'web', namespace: 'default', uid: 'd' },
            spec: { replicas: 2 },
            status: { readyReplicas: 2 },
          }),
        ],
        null,
      ],
    };
    data.metrics = [
      [
        { metadata: { name: 'cp-1' }, usage: { cpu: '1000m', memory: '4Gi' } },
        { metadata: { name: 'cp-2' }, usage: { cpu: '1000m', memory: '4Gi' } },
      ],
      null,
    ];
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'k8stest' })).toBeTruthy();
    expect(
      await screen.findByText('Kubernetes v1.33.1', { selector: '.MuiChip-label' })
    ).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getByText('Nothing needs attention')).toBeTruthy();
    expect(screen.getByText('2/2')).toBeTruthy(); // nodes ready
    expect(screen.getByText('2.0 of 8.0 cores')).toBeTruthy();
    expect(screen.getByText('8.0 of 32 GiB')).toBeTruthy();
    expect(screen.getByText('1/1 ready')).toBeTruthy(); // deployments
    expect(screen.getByRole('region', { name: 'Events' })).toBeTruthy();
  });

  it('lists what needs attention and works without metrics', async () => {
    data.lists = {
      Node: [
        [
          readyNode('cp-1'),
          readyNode('worker-1', {
            status: { conditions: [{ type: 'Ready', status: 'False', message: 'kubelet down' }] },
          }),
        ],
        null,
      ],
      Pod: [
        [
          data.object({
            metadata: { name: 'api-0', namespace: 'shop', uid: 'pod-1' },
            status: {
              phase: 'Running',
              containerStatuses: [
                { name: 'api', state: { waiting: { reason: 'CrashLoopBackOff' } } },
              ],
            },
          }),
        ],
        null,
      ],
    };
    data.metrics = [null, { status: 404 }];
    renderPage();

    expect(screen.getByText('2 errors')).toBeTruthy();
    expect(screen.getByText('Node is not ready')).toBeTruthy();
    expect(screen.getByText('kubelet down')).toBeTruthy();
    expect(screen.getByText('CrashLoopBackOff')).toBeTruthy();
    expect(screen.getByText('1/2')).toBeTruthy(); // nodes ready
    expect(screen.getByText(/need the metrics API/)).toBeTruthy();
    await screen.findByText('Kubernetes v1.33.1');
  });

  it('says so when the user may not list a resource', async () => {
    data.lists = { Node: [null, { status: 403 }] };
    renderPage();

    expect(screen.getByText(/not allowed to list some resources \(Nodes\)/)).toBeTruthy();
    expect(screen.getByText('Nodes are not available.')).toBeTruthy();
    await screen.findByText('Kubernetes v1.33.1');
  });
});
