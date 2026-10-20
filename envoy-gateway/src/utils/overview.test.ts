import { describe, expect, it } from 'vitest';
import {
  collectIssues,
  componentHealth,
  componentStatus,
  routesOfGateways,
  securityCoverage,
  summarizeConfig,
} from './overview';

const GW = 'gateway.networking.k8s.io';
const cond = (type: string, status: string, reason?: string, message?: string) => ({
  type,
  status,
  reason,
  message,
});
const gatewayClass = (name: string, accepted = 'True') => ({
  kind: 'GatewayClass',
  metadata: { name },
  spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
  status: { conditions: [cond('Accepted', accepted, 'InvalidParameters', 'bad EnvoyProxy')] },
});
const gateway = (name: string, programmed = 'True') => ({
  apiVersion: `${GW}/v1`,
  kind: 'Gateway',
  metadata: { name, namespace: 'infra' },
  spec: { gatewayClassName: 'envoy' },
  status: {
    conditions: [cond('Accepted', 'True'), cond('Programmed', programmed, 'AddressNotAssigned')],
  },
});
const route = (name: string, namespace: string, parent = 'eg') => ({
  apiVersion: `${GW}/v1`,
  kind: 'HTTPRoute',
  metadata: { name, namespace },
  spec: { parentRefs: [{ name: parent, namespace: 'infra' }] },
});

describe('componentStatus', () => {
  it('sums replicas of Deployments and DaemonSets and reads the image tag', () => {
    const status = componentStatus('proxy', [
      {
        kind: 'Deployment',
        metadata: { namespace: 'envoy-gateway-system' },
        spec: {
          replicas: 3,
          template: { spec: { containers: [{ image: 'envoyproxy/envoy:distroless-v1.33.0' }] } },
        },
        status: { readyReplicas: 2 },
      },
      {
        kind: 'DaemonSet',
        metadata: { namespace: 'edge' },
        status: { desiredNumberScheduled: 4, numberReady: 4 },
      },
    ]);
    expect(status).toMatchObject({
      workloads: 2,
      ready: 6,
      total: 7,
      versions: ['distroless-v1.33.0'],
    });
    expect(componentHealth(status, true)).toBe('warning');
  });

  it('treats a missing optional component as unknown and a missing controller as an error', () => {
    const none = componentStatus('ratelimit', []);
    expect(componentHealth(none, true)).toBe('unknown');
    expect(componentHealth(componentStatus('controller', []), false)).toBe('error');
  });
});

describe('collectIssues', () => {
  it('reports nothing for a healthy installation', () => {
    expect(
      collectIssues({
        components: [
          componentStatus('controller', [
            { kind: 'Deployment', spec: { replicas: 1 }, status: { readyReplicas: 1 } },
          ]),
        ],
        gatewayClasses: [gatewayClass('envoy')],
        gateways: [gateway('eg')],
        routes: [route('web', 'apps')],
      })
    ).toEqual([]);
  });

  it('finds rejected classes, unprogrammed gateways, failing routes and policies; errors first', () => {
    const issues = collectIssues({
      gatewayClasses: [gatewayClass('envoy', 'False')],
      gateways: [gateway('eg', 'False')],
      routes: [
        {
          ...route('web', 'apps'),
          status: { parents: [{ conditions: [cond('ResolvedRefs', 'False', 'BackendNotFound')] }] },
        },
        // Not attached to an Envoy Gateway managed Gateway: ignored.
        {
          ...route('other', 'apps', 'nginx'),
          status: { parents: [{ conditions: [cond('Accepted', 'False')] }] },
        },
      ],
      resources: [
        {
          kind: 'SecurityPolicy',
          metadata: { name: 'sp', namespace: 'apps' },
          status: {
            ancestors: [
              {
                ancestorRef: { group: GW, kind: 'Gateway', name: 'eg' },
                conditions: [cond('Accepted', 'False', 'Invalid')],
              },
            ],
          },
        },
      ],
    });
    expect(issues.map(i => `${i.severity}:${i.kind}/${i.name}`)).toEqual([
      'error:GatewayClass/envoy',
      'error:HTTPRoute/web',
      'error:SecurityPolicy/sp',
      'warning:Gateway/eg',
    ]);
  });

  it('warns when EnvoyPatchPolicies exist but the API is disabled', () => {
    const issues = collectIssues({
      resources: [{ kind: 'EnvoyPatchPolicy', metadata: { name: 'p', namespace: 'infra' } }],
      config: summarizeConfig({}),
    });
    expect(issues.map(i => i.id)).toEqual(['config-envoypatchpolicy']);
    expect(
      collectIssues({
        resources: [{ kind: 'EnvoyPatchPolicy', metadata: { name: 'p', namespace: 'infra' } }],
        config: summarizeConfig({ extensionApis: { enableEnvoyPatchPolicy: true } }),
      })
    ).toEqual([]);
  });
});

describe('securityCoverage', () => {
  it('counts routes protected directly or through their Gateway', () => {
    const routes = [route('a', 'apps'), route('b', 'apps', 'other'), route('c', 'shop', 'other')];
    const policies = [
      {
        metadata: { name: 'gw', namespace: 'infra' },
        spec: { targetRefs: [{ group: GW, kind: 'Gateway', name: 'eg' }] },
      },
      {
        metadata: { name: 'r', namespace: 'shop' },
        spec: { targetRefs: [{ group: GW, kind: 'HTTPRoute', name: 'c' }] },
      },
    ];
    expect(securityCoverage(routes, policies)).toEqual([
      { namespace: 'apps', routes: 2, protected: 1 },
      { namespace: 'shop', routes: 1, protected: 1 },
    ]);
  });
});

describe('routesOfGateways', () => {
  it('keeps only routes attached to the given Gateways', () => {
    expect(
      routesOfGateways([route('a', 'apps'), route('b', 'apps', 'nginx')], [gateway('eg')])
    ).toHaveLength(1);
  });
});

describe('summarizeConfig', () => {
  it('uses Envoy Gateway defaults for an empty configuration', () => {
    const c = summarizeConfig(undefined);
    expect(c.settings.find(s => s.id === 'provider')?.value).toBe('Kubernetes');
    expect(c.features.find(f => f.id === 'epp')?.enabled).toBe(false);
    expect(c.features.find(f => f.id === 'prometheus')?.enabled).toBe(true);
  });

  it('reads feature switches and settings', () => {
    const c = summarizeConfig({
      extensionApis: { enableEnvoyPatchPolicy: true, enableBackend: true },
      rateLimit: { backend: { type: 'Redis' } },
      provider: { type: 'Kubernetes', kubernetes: { deploy: { type: 'GatewayNamespace' } } },
    });
    expect(c.enableEnvoyPatchPolicy).toBe(true);
    expect(c.features.filter(f => f.enabled).map(f => f.id)).toEqual(
      expect.arrayContaining(['epp', 'backend', 'ratelimit'])
    );
    expect(c.settings.find(s => s.id === 'deploy')?.value).toBe('GatewayNamespace');
    expect(c.settings.find(s => s.id === 'ratelimit')?.value).toBe('Redis');
  });
});
