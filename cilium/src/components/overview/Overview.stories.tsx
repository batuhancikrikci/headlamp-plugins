// Storybook bundles the real Headlamp library; loading its entry point first initializes its
// modules in the right order before the resource classes extend KubeObject.
import '@kinvolk/headlamp-plugin/lib';
import { Box } from '@mui/material';
import { Meta, StoryFn } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { createStore } from 'redux';
import { PodJson, summarizeInstall } from '../../api/ciliumInstall';
import { Availability } from '../../api/discovery';
import { CRDS } from '../../resources/registry';
import {
  ActionCard,
  ComponentCard,
  Coverage,
  FeatureSummary,
  Header,
  IssueList,
  Panel,
  ResourceInventory,
  Stat,
  StatCard,
} from './Overview';
import { Issue, NamespaceCoverage } from './overview';

// Links to Kubernetes objects need a store and a query client; empty ones are enough here.
const store = createStore(() => ({}));
const queryClient = new QueryClient();

export default {
  title: 'Cilium/Overview',
  decorators: [
    Story => (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Box sx={{ p: 3 }}>
              <Story />
            </Box>
          </BrowserRouter>
        </QueryClientProvider>
      </Provider>
    ),
  ],
} as Meta;

function pod(name: string, app: string, image: string, ready = true, restarts = 0): PodJson {
  const labels: Record<string, string> =
    app === 'operator' ? { 'io.cilium/app': 'operator' } : { 'k8s-app': app };
  return {
    metadata: { name, namespace: 'kube-system', labels },
    spec: { containers: [{ name: 'main', image }] },
    status: {
      phase: 'Running',
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      containerStatuses: [{ name: 'main', ready, restartCount: restarts }],
    },
  };
}

const install = summarizeInstall([
  pod('cilium-a', 'cilium', 'quay.io/cilium/cilium:v1.20.2'),
  pod('cilium-b', 'cilium', 'quay.io/cilium/cilium:v1.20.2'),
  pod('cilium-c', 'cilium', 'quay.io/cilium/cilium:v1.20.2', false, 4),
  pod('cilium-operator-1', 'operator', 'quay.io/cilium/operator-generic:v1.20.2'),
  pod('cilium-operator-2', 'operator', 'quay.io/cilium/operator-generic:v1.20.2'),
  pod('cilium-envoy-a', 'cilium-envoy', 'quay.io/cilium/cilium-envoy:v1.36.1'),
  pod('hubble-relay-1', 'hubble-relay', 'quay.io/cilium/hubble-relay:v1.20.2'),
  pod('hubble-ui-1', 'hubble-ui', 'quay.io/cilium/hubble-ui:v0.13.3'),
]);

const issues: Issue[] = [
  {
    id: 'pod',
    severity: 'error',
    kind: 'Pod',
    group: '',
    name: 'cilium-c',
    namespace: 'kube-system',
    message: 'Agent pod is not ready (Running)',
  },
  {
    id: 'bgp',
    severity: 'warning',
    kind: 'CiliumBGPNodeConfig',
    group: 'cilium.io',
    name: 'worker-2',
    message: '1 of 2 BGP session(s) not established: tor-2',
  },
  {
    id: 'pool',
    severity: 'warning',
    kind: 'CiliumLoadBalancerIPPool',
    group: 'cilium.io',
    name: 'lb-pool',
    message: 'Pool has no free addresses left',
  },
];

const coverage: NamespaceCoverage[] = [
  'argocd',
  'batch',
  'cert-manager',
  'data',
  'default',
  'ingress',
  'kube-system',
  'logging',
  'monitoring',
  'payments',
  'shop',
  'tenant-a',
  'tenant-b',
].map((namespace, i) => {
  const endpoints = 3 + ((i * 7) % 11);
  const enforced = i % 3 === 0 ? endpoints : i % 3 === 1 ? 0 : Math.ceil(endpoints / 2);
  return { namespace, endpoints, enforced };
});

const stats: Stat[] = [
  {
    id: 'p',
    label: 'Network policies',
    value: 42,
    caption: '36 namespaced · 6 clusterwide',
    icon: 'mdi:shield-lock-outline',
    tone: 'primary',
    to: '/',
  },
  {
    id: 'e',
    label: 'Endpoints',
    value: 318,
    caption: '2 not ready',
    icon: 'mdi:lan-connect',
    tone: 'warning',
    to: '/',
  },
  {
    id: 'i',
    label: 'Identities',
    value: 97,
    caption: '88 in use by endpoints',
    icon: 'mdi:card-account-details-outline',
    tone: 'info',
    to: '/',
  },
  {
    id: 'n',
    label: 'Cilium nodes',
    value: 6,
    caption: '6 Kubernetes node(s)',
    icon: 'mdi:server-network',
    tone: 'info',
    to: '/',
  },
  {
    id: 'b',
    label: 'BGP sessions',
    value: '11/12',
    caption: 'established on 6 node(s)',
    icon: 'mdi:router-network',
    tone: 'error',
    to: '/',
  },
  {
    id: 'l',
    label: 'LoadBalancer IPs',
    value: '14/254',
    caption: 'used from 2 pool(s)',
    icon: 'mdi:ip-network-outline',
    tone: 'primary',
    to: '/',
  },
];

const config = {
  'cluster-name': 'prod-eu1',
  'routing-mode': 'native',
  ipam: 'cluster-pool',
  'enable-policy': 'default',
  'identity-allocation-mode': 'crd',
  'kube-proxy-replacement': 'true',
  'enable-ipv4': 'true',
  'enable-ipv6': 'false',
  'enable-bgp-control-plane': 'true',
  'enable-l2-announcements': 'false',
  'enable-ipv4-egress-gateway': 'true',
  'enable-l7-proxy': 'true',
  'enable-envoy-config': 'true',
  'enable-hubble': 'true',
  'enable-wireguard': 'false',
  'enable-gateway-api': 'false',
};

const grid = (min: number) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  gap: 2,
});
const twoColumns = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
  gap: 2,
};

function Layout({ withIssues }: { withIssues: boolean }) {
  const shown = withIssues ? issues : [];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Header install={install} issues={shown} />
      <Box sx={grid(200)}>
        {Object.values(install.components).map(component => (
          <ComponentCard key={component.info.id} component={component} />
        ))}
      </Box>
      <Box sx={grid(210)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>
      <Box sx={twoColumns}>
        <Panel title="Needs attention" icon="mdi:bell-alert-outline">
          <IssueList issues={shown} />
        </Panel>
        <Panel title="Policy coverage" icon="mdi:shield-check-outline">
          <Coverage coverage={coverage} />
        </Panel>
      </Box>
      <Box sx={twoColumns}>
        <Panel title="Configuration" icon="mdi:tune-variant">
          <FeatureSummary config={config} />
        </Panel>
        <Panel title="Guided setup" icon="mdi:wizard-hat">
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            <ActionCard
              icon="mdi:shield-lock-outline"
              title="Network policy wizard"
              description="Pick a workload and allow only the traffic it needs."
              onClick={() => undefined}
            />
            <ActionCard
              icon="mdi:router-network"
              title="BGP setup wizard"
              description="Peer with your routers and advertise pod and service prefixes."
              onClick={() => undefined}
            />
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}

export const WithIssues: StoryFn = () => <Layout withIssues />;

export const Healthy: StoryFn = () => <Layout withIssues={false} />;

// Every supported CRD except endpoint slices and the legacy BGP API is installed.
const availability: Availability = {
  groupInstalled: true,
  versions: Object.fromEntries(
    CRDS.filter(c => c.kind !== 'CiliumEndpointSlice' && !c.deprecated).map(c => [
      c.plural,
      c.defaultVersion,
    ])
  ),
  resources: {},
};

export const Resources: StoryFn = () => (
  <Panel title="Resources" icon="mdi:view-grid-outline">
    <ResourceInventory availability={availability} />
  </Panel>
);
