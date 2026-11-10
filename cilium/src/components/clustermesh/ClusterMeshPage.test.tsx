import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The clusters behind Headlamp's API proxy are the external dependency: every GET is answered
// from a fixture of the cluster it is sent to, and patches are recorded.
const api = vi.hoisted(() => ({
  clusters: {} as Record<string, Record<string, unknown>>,
  patches: [] as Array<{ path: string; body: unknown }>,
}));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: async (path: string, params: { cluster?: string } = {}) => {
      const fixtures = api.clusters[params.cluster || 'east'] || {};
      const key = Object.keys(fixtures).find(prefix => path.startsWith(prefix));
      if (!key) throw Object.assign(new Error(`not found: ${path}`), { status: 404 });
      return fixtures[key];
    },
    patch: async (path: string, body: unknown) => {
      api.patches.push({ path, body });
    },
  },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/Utils', () => ({ getCluster: () => 'east' }));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  SectionBox: ({
    title,
    children,
    headerProps,
  }: {
    title: string;
    children: React.ReactNode;
    headerProps?: { titleSideActions?: React.ReactNode[] };
  }) => (
    <section aria-label={title}>
      <h2>{title}</h2>
      {headerProps?.titleSideActions}
      {children}
    </section>
  ),
  SimpleTable: ({
    data,
    columns,
  }: {
    data: unknown[];
    columns: Array<{ label: string; getter: (row: unknown) => React.ReactNode }>;
  }) => (
    <table>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {columns.map((c, j) => (
              <td key={j}>{c.getter(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#service">{children}</a>,
  Loader: ({ title }: { title: string }) => <p>{title}</p>,
}));
vi.mock('../../hooks/useClusterData', () => ({
  useServices: () => ({
    items: [
      {
        metadata: {
          name: 'checkout',
          namespace: 'shop',
          annotations: {
            'service.cilium.io/global': 'true',
            'service.cilium.io/affinity': 'local',
          },
        },
      },
      { metadata: { name: 'cart', namespace: 'shop', annotations: {} } },
      { metadata: { name: 'report', namespace: 'other', annotations: {} } },
    ],
  }),
}));

import { ClusterMeshPage } from './ClusterMeshPage';

const agent = (version: string) => ({
  metadata: { name: 'cilium-x', namespace: 'kube-system', labels: { 'k8s-app': 'cilium' } },
  spec: { containers: [{ name: 'cilium-agent', image: `quay.io/cilium/cilium:${version}` }] },
  status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
});
const apiserverPod = {
  metadata: {
    name: 'clustermesh-apiserver-x',
    namespace: 'kube-system',
    labels: { 'k8s-app': 'clustermesh-apiserver' },
  },
  spec: {
    containers: [
      { name: 'apiserver', image: 'quay.io/cilium/clustermesh-apiserver:v1.20.4' },
      { name: 'kvstoremesh' },
    ],
  },
  status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
};

function cluster(name: string, id: string, cidr: string, withMesh: boolean) {
  return {
    '/api/v1/pods?labelSelector=k8s-app%20in': { items: [agent('v1.20.4')] },
    '/api/v1/pods?labelSelector=io.cilium': { items: [] },
    '/api/v1/pods?labelSelector=k8s-app%3Dclustermesh-apiserver': {
      items: withMesh ? [apiserverPod] : [],
    },
    '/api/v1/namespaces/kube-system/configmaps/cilium-config': {
      data: { 'cluster-name': name, 'cluster-id': id, 'routing-mode': 'tunnel' },
    },
    ...(withMesh
      ? {
          '/api/v1/namespaces/kube-system/services/clustermesh-apiserver': {
            spec: { type: 'LoadBalancer', ports: [{ port: 2379 }] },
            status: { loadBalancer: { ingress: [{ ip: '192.0.2.10' }] } },
          },
          '/api/v1/namespaces/kube-system/configmaps/clustermesh-remote-users': {
            data: { 'users.yaml': 'users:\n- name: remote-west\n  role: remote\n' },
          },
        }
      : {}),
    '/apis/apps/v1/namespaces/kube-system/daemonsets': { items: [] },
    '/apis/cilium.io/v2/ciliumnodes': { items: [{ spec: { ipam: { podCIDRs: [cidr] } } }] },
    '/api/v1/services': { items: [] },
  };
}

beforeEach(() => {
  api.patches = [];
  api.clusters = {
    east: cluster('east', '1', '10.1.0.0/16', true),
  };
});

describe('ClusterMeshPage', () => {
  it('shows the identity, the API server and the clusters allowed to connect', async () => {
    render(<ClusterMeshPage />);
    expect(await screen.findByText('This cluster')).toBeTruthy();
    expect(screen.getByText('east')).toBeTruthy();
    expect(screen.getByText('LoadBalancer · 192.0.2.10:2379')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy(); // KVStoreMesh
    const remotes = screen.getByRole('region', { name: 'Remote clusters' });
    expect(within(remotes).getByText('west')).toBeTruthy();
    expect(within(remotes).getByText('Yes')).toBeTruthy();
  });

  it('edits a global service with a merge patch of its annotations', async () => {
    render(<ClusterMeshPage />);
    const services = await screen.findByRole('region', { name: 'Global services' });
    expect(within(services).getByText('shop/checkout')).toBeTruthy();
    fireEvent.click(within(services).getByText('Edit'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.patches).toHaveLength(1));
    expect(api.patches[0]).toMatchObject({
      path: '/api/v1/namespaces/shop/services/checkout',
      body: {
        metadata: {
          annotations: {
            'service.cilium.io/global': 'true',
            'service.cilium.io/affinity': 'local',
          },
        },
      },
    });
  });

  it('filters the global services by namespace', async () => {
    render(<ClusterMeshPage />);
    const services = await screen.findByRole('region', { name: 'Global services' });
    expect(within(services).getByText('shop/checkout')).toBeTruthy();
    fireEvent.mouseDown(within(services).getByLabelText('Namespace'));
    fireEvent.click(await screen.findByRole('option', { name: 'other' }));
    expect(within(services).queryByText('shop/checkout')).toBeNull();
    expect(
      within(services).getByText(
        'No service in other is global (annotation service.cilium.io/global).'
      )
    ).toBeTruthy();
  });

  it('checks two entered clusters before giving the commands', async () => {
    render(<ClusterMeshPage />);
    fireEvent.click(await screen.findByText('Connect clusters'));
    const names = () => screen.getAllByLabelText(/Cilium cluster name/) as HTMLInputElement[];
    expect(screen.getByText('Next').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Fill in from the cluster on this page'));
    await waitFor(() => expect(names()[0].value).toBe('east'));
    const type = (label: RegExp, value: string) =>
      fireEvent.change(screen.getAllByLabelText(label)[1], { target: { value } });
    type(/Cilium cluster name/, 'west');
    type(/Cluster ID/, '1');
    type(/Pod CIDRs/, '10.1.128.0/24');
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText('Both clusters use the ID 1.')).toBeTruthy();
    expect(screen.getByText(/Overlapping: 10.1.0.0\/16 ↔ 10.1.128.0\/24/)).toBeTruthy();
    fireEvent.click(screen.getByText('Show the commands anyway'));
    expect(
      screen.getByText(/cilium clustermesh connect --context east --destination-context west/)
    ).toBeTruthy();
  });
});
