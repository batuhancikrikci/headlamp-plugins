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
import {
  collectIssues,
  componentStatus,
  Issue,
  NamespaceCoverage,
  summarizeConfig,
} from '../../utils/overview';
import {
  ActionCard,
  ComponentCard,
  Coverage,
  FeatureSummary,
  GatewayClassList,
  Header,
  IssueList,
  Panel,
  Stat,
  StatCard,
} from './Overview';

// Links to Kubernetes objects need a store and a query client; empty ones are enough here.
const store = createStore(() => ({}));
const queryClient = new QueryClient();

export default {
  title: 'EnvoyGateway/Overview',
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

const GW = 'gateway.networking.k8s.io';
const deployment = (image: string, replicas: number, ready: number) => ({
  kind: 'Deployment',
  metadata: { namespace: 'envoy-gateway-system' },
  spec: { replicas, template: { spec: { containers: [{ image }] } } },
  status: { readyReplicas: ready },
});
const controller = componentStatus('controller', [deployment('envoyproxy/gateway:v1.5.0', 1, 1)]);
const proxy = componentStatus('proxy', [
  deployment('envoyproxy/envoy:distroless-v1.35.0', 3, 3),
  deployment('envoyproxy/envoy:distroless-v1.35.0', 2, 1),
]);
const rateLimit = componentStatus('ratelimit', [deployment('envoyproxy/ratelimit:master', 1, 1)]);

const classes = [
  {
    kind: 'GatewayClass',
    metadata: { name: 'envoy' },
    spec: {
      controllerName: 'gateway.envoyproxy.io/gatewayclass-controller',
      parametersRef: {
        group: 'gateway.envoyproxy.io',
        kind: 'EnvoyProxy',
        name: 'gateway-config',
        namespace: 'kube-gateway',
      },
    },
    status: { conditions: [{ type: 'Accepted', status: 'True' }] },
  },
  {
    kind: 'GatewayClass',
    metadata: { name: 'envoy-internal' },
    spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
    status: {
      conditions: [
        {
          type: 'Accepted',
          status: 'False',
          reason: 'InvalidParameters',
          message: 'EnvoyProxy not found',
        },
      ],
    },
  },
];
const gateway = (name: string, cls: string, programmed: string) => ({
  apiVersion: `${GW}/v1`,
  kind: 'Gateway',
  metadata: { name, namespace: 'kube-gateway' },
  spec: { gatewayClassName: cls },
  status: {
    conditions: [
      { type: 'Accepted', status: 'True' },
      {
        type: 'Programmed',
        status: programmed,
        reason: 'AddressNotAssigned',
        message: 'No addresses have been assigned',
      },
    ],
  },
});
const gateways = [gateway('public', 'envoy', 'True'), gateway('internal', 'envoy', 'False')];

const issues: Issue[] = collectIssues({
  components: [controller, proxy, rateLimit],
  gatewayClasses: classes,
  gateways,
  resources: [
    {
      kind: 'SecurityPolicy',
      metadata: { name: 'oidc-login', namespace: 'shop' },
      status: {
        ancestors: [
          {
            ancestorRef: { group: GW, kind: 'Gateway', name: 'public' },
            conditions: [
              {
                type: 'Accepted',
                status: 'False',
                reason: 'Invalid',
                message: 'OIDC client secret "oidc" not found',
              },
            ],
          },
        ],
      },
    },
    { kind: 'EnvoyPatchPolicy', metadata: { name: 'tweak-listener', namespace: 'kube-gateway' } },
  ],
  config: summarizeConfig({}),
});

const coverage: NamespaceCoverage[] = [
  { namespace: 'shop', routes: 6, protected: 6 },
  { namespace: 'payments', routes: 4, protected: 1 },
  { namespace: 'internal-tools', routes: 3, protected: 0 },
  { namespace: 'monitoring', routes: 2, protected: 2 },
];

const stats: Stat[] = [
  {
    id: 'gw',
    label: 'Gateways',
    value: '1/2',
    caption: 'programmed · 2 gateway class(es)',
    icon: 'mdi:gate',
    tone: 'warning',
  },
  {
    id: 'routes',
    label: 'Routes',
    value: 15,
    caption: '13 HTTP · 2 gRPC',
    icon: 'mdi:routes',
    tone: 'info',
  },
  {
    id: 'sec',
    label: 'Security policies',
    value: 4,
    caption: '1 not accepted',
    icon: 'mdi:shield-lock-outline',
    tone: 'error',
  },
  {
    id: 'traffic',
    label: 'Traffic policies',
    value: 7,
    caption: '5 backend · 2 client',
    icon: 'mdi:arrow-decision-outline',
    tone: 'primary',
  },
  {
    id: 'ext',
    label: 'Extensions',
    value: 3,
    caption: '2 policies · 1 route filters',
    icon: 'mdi:puzzle-outline',
    tone: 'info',
  },
  {
    id: 'proxy',
    label: 'Proxy configurations',
    value: 1,
    caption: '1 in use',
    icon: 'mdi:server-network',
    tone: 'info',
  },
];

const twoColumns = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
  gap: 2,
};

/** The whole dashboard with sample data, including problems to look at. */
export const Dashboard: StoryFn = () => (
  <Box sx={{ display: 'grid', gap: 2 }}>
    <Header
      version="v1.5.0"
      namespace="envoy-gateway-system"
      apiVersions={['v1alpha1']}
      issues={issues}
      installed
    />
    <Box
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}
    >
      {[controller, proxy, rateLimit].map(c => (
        <ComponentCard key={c.id} component={c} />
      ))}
    </Box>
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          sm: 'repeat(2, minmax(0, 1fr))',
          md: 'repeat(3, minmax(0, 1fr))',
          xl: 'repeat(6, minmax(0, 1fr))',
        },
        gap: 2,
      }}
    >
      {stats.map(s => (
        <StatCard key={s.id} stat={s} />
      ))}
    </Box>
    <Box sx={twoColumns}>
      <Panel title="Needs attention" icon="mdi:bell-alert-outline">
        <IssueList issues={issues} />
      </Panel>
      <Panel title="Route protection" icon="mdi:shield-check-outline">
        <Coverage coverage={coverage} />
      </Panel>
    </Box>
    <Box sx={twoColumns}>
      <Panel title="Gateway classes" icon="mdi:gate">
        <GatewayClassList classes={classes} gateways={gateways} />
      </Panel>
      <Panel title="Guided setup" icon="mdi:wizard-hat">
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          <ActionCard
            icon="mdi:shield-lock-outline"
            title="Security policy wizard"
            description="Protect a Gateway or route with JWT, OIDC, API keys, CORS or IP rules."
            onClick={() => undefined}
          />
          <ActionCard
            icon="mdi:arrow-decision-outline"
            title="Backend traffic wizard"
            description="Add rate limits, retries, health checks or sticky sessions to a route."
            onClick={() => undefined}
          />
        </Box>
      </Panel>
    </Box>
    <Panel title="Configuration" icon="mdi:tune-variant">
      <FeatureSummary
        config={summarizeConfig({
          // A long, custom controller name must be shown in full.
          gateway: {
            controllerName: 'gateway.envoyproxy.io/platform-team-internal-gatewayclass-controller',
          },
          provider: {
            kubernetes: { watch: { namespaces: ['shop', 'payments', 'internal-tools'] } },
          },
          extensionApis: { enableBackend: true },
          rateLimit: { backend: { type: 'Redis' } },
        })}
      />
    </Panel>
  </Box>
);

/** Empty state: a fresh, healthy installation without routes. */
export const Healthy: StoryFn = () => (
  <Box sx={{ display: 'grid', gap: 2 }}>
    <Header
      version="v1.5.0"
      namespace="envoy-gateway-system"
      apiVersions={['v1alpha1']}
      issues={[]}
      installed
    />
    <Box sx={twoColumns}>
      <Panel title="Needs attention" icon="mdi:bell-alert-outline">
        <IssueList issues={[]} />
      </Panel>
      <Panel title="Route protection" icon="mdi:shield-check-outline">
        <Coverage coverage={[]} />
      </Panel>
    </Box>
  </Box>
);

/** Error state: the controller is not visible. */
export const ControllerMissing: StoryFn = () => {
  const missing = componentStatus('controller', []);
  const found = collectIssues({ components: [missing] });
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Header apiVersions={['v1alpha1']} issues={found} installed />
      <ComponentCard component={missing} />
      <Panel title="Needs attention" icon="mdi:bell-alert-outline">
        <IssueList issues={found} />
      </Panel>
    </Box>
  );
};
