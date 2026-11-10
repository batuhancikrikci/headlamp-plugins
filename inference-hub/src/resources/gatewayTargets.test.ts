import { RouteUse } from './agentRouter';
import { fromLLMInferenceService } from './endpoint';
import {
  authHints,
  gatewayPathsOf,
  GatewayVia,
  headerProblem,
  pickGatewayPort,
} from './gatewayTargets';
import { KubeJson } from './types';

const qwen = fromLLMInferenceService({
  metadata: { name: 'qwen', namespace: 'ai', uid: 'u1' },
  spec: { model: { name: 'qwen35-2b', uri: 'hf://Qwen/Qwen3.5-2B' } },
  status: {
    router: {
      gateways: [
        {
          name: 'kserve-ingress-gateway',
          namespace: 'kserve',
          httpRoutes: [{ name: 'qwen-kserve-route', namespace: 'ai' }],
        },
      ],
    },
  },
});

const httpRoute = (name: string, namespace: string, hostnames?: string[]): KubeJson => ({
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'HTTPRoute',
  metadata: { name, namespace },
  spec: { ...(hostnames ? { hostnames } : {}) },
});

const aiRoute: RouteUse = {
  route: {
    apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
    kind: 'AIGatewayRoute',
    metadata: { name: 'models', namespace: 'gw' },
    spec: { parentRefs: [{ name: 'ai-gateway' }] },
  },
  models: ['qwen35-2b'],
};

describe('gatewayPathsOf', () => {
  it('finds the KServe route under /<namespace>/<name> and Agent Router routes at the root', () => {
    const paths = gatewayPathsOf(qwen, [httpRoute('qwen-kserve-route', 'ai')], [aiRoute]);
    expect(paths).toEqual([
      {
        model: 'qwen35-2b',
        via: {
          name: 'kserve-ingress-gateway',
          namespace: 'kserve',
          pathPrefix: '/ai/qwen',
          source: 'kserve',
          routes: [{ name: 'qwen-kserve-route', namespace: 'ai' }],
          hostnames: [],
          endpointId: 'llm/ai/qwen',
        },
      },
      {
        model: 'qwen35-2b',
        via: {
          name: 'ai-gateway',
          namespace: 'gw',
          pathPrefix: '',
          source: 'agentRouter',
          routeName: 'models',
          routes: [{ name: 'models', namespace: 'gw' }],
          hostnames: [],
          endpointId: 'llm/ai/qwen',
        },
      },
    ]);
  });

  it('reports the hostnames a route is limited to', () => {
    const [path] = gatewayPathsOf(
      qwen,
      [httpRoute('qwen-kserve-route', 'ai', ['llm.example.com'])],
      []
    );
    expect(path.via.hostnames).toEqual(['llm.example.com']);
  });
});

describe('pickGatewayPort', () => {
  const ports = [
    { name: 'http-80', port: 80 },
    { name: 'https-443', port: 443 },
  ];
  const gateway = (listeners: Array<{ protocol: string; port: number }>): KubeJson => ({
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name: 'gw' },
    spec: { listeners },
  });

  it('prefers an HTTP listener, then HTTPS, then the first service port', () => {
    expect(
      pickGatewayPort(
        gateway([
          { protocol: 'HTTPS', port: 443 },
          { protocol: 'HTTP', port: 80 },
        ]),
        ports
      )
    ).toEqual({ port: 80, scheme: 'http' });
    expect(pickGatewayPort(gateway([{ protocol: 'HTTPS', port: 443 }]), ports)).toEqual({
      port: 443,
      scheme: 'https',
    });
    expect(pickGatewayPort(undefined, ports)).toEqual({ port: 80, scheme: 'http' });
    expect(pickGatewayPort(undefined, [])).toBeUndefined();
  });
});

describe('authHints', () => {
  const via: GatewayVia = {
    name: 'ai-gateway',
    namespace: 'gw',
    pathPrefix: '',
    source: 'agentRouter',
    routes: [{ name: 'models', namespace: 'gw' }],
    hostnames: [],
    endpointId: 'llm/ai/qwen',
  };
  const policy = (name: string, spec: Record<string, unknown>): KubeJson => ({
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: { name, namespace: 'gw' },
    spec,
  });

  it('lists the header an API key policy on the gateway or the route reads', () => {
    const hints = authHints(
      [
        policy('keys', {
          targetRefs: [{ group: 'gateway.networking.k8s.io', kind: 'Gateway', name: 'ai-gateway' }],
          apiKeyAuth: { extractFrom: [{ headers: ['x-api-key'] }] },
        }),
        policy('other', {
          targetRefs: [{ kind: 'HTTPRoute', name: 'unrelated' }],
          apiKeyAuth: { extractFrom: [{ headers: ['x-other'] }] },
        }),
      ],
      via
    );
    expect(hints).toEqual([
      {
        policy: 'gw/keys',
        text: 'API key in header x-api-key',
        headers: ['x-api-key'],
        unusable: false,
      },
    ]);
  });

  it('marks policies a client cannot satisfy through the Kubernetes proxy', () => {
    const hints = authHints(
      [
        policy('jwt', {
          targetRef: { kind: 'HTTPRoute', name: 'models' },
          jwt: { providers: [{ name: 'idp' }] },
          basicAuth: { users: { name: 'htpasswd' } },
        }),
      ],
      via
    );
    expect(hints.map(h => [h.text, h.unusable])).toEqual([
      ['JWT in the Authorization header', true],
      ['Basic authentication', true],
    ]);
  });
});

describe('headerProblem', () => {
  it('refuses the headers the Kubernetes API server or the browser own', () => {
    expect(headerProblem('x-api-key')).toBeUndefined();
    expect(headerProblem('Authorization')).toMatch(/Kubernetes API/);
    expect(headerProblem('Impersonate-User')).toMatch(/Impersonate/);
    expect(headerProblem('Host')).toMatch(/browser or the proxy/);
    expect(headerProblem('bad header')).toMatch(/only contain/);
    expect(headerProblem(' ')).toBe('Enter a header name.');
  });
});
