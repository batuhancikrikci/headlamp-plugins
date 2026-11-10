import { hostMatches, TestRequest, traceRequest } from './requestMatch';

const gateway = {
  apiVersion: 'gateway.networking.k8s.io/v1',
  kind: 'Gateway',
  metadata: { name: 'gw', namespace: 'infra' },
  spec: {
    gatewayClassName: 'eg',
    listeners: [
      {
        name: 'http',
        protocol: 'HTTP',
        port: 80,
        allowedRoutes: { namespaces: { from: 'All' } },
      },
      {
        name: 'api',
        protocol: 'HTTP',
        port: 80,
        hostname: 'api.example.com',
        allowedRoutes: { namespaces: { from: 'All' } },
      },
      { name: 'tcp', protocol: 'TCP', port: 9000 },
    ],
  },
};

function route(
  name: string,
  rules: unknown[],
  extra: { hostnames?: string[]; created?: string; namespace?: string; sectionName?: string } = {}
) {
  return {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    metadata: {
      name,
      namespace: extra.namespace || 'apps',
      creationTimestamp: extra.created || '2026-01-01T00:00:00Z',
    },
    spec: {
      parentRefs: [
        {
          name: 'gw',
          namespace: 'infra',
          ...(extra.sectionName ? { sectionName: extra.sectionName } : {}),
        },
      ],
      ...(extra.hostnames ? { hostnames: extra.hostnames } : {}),
      rules,
    },
  };
}

const request = (patch: Partial<TestRequest> = {}): TestRequest => ({
  host: 'shop.example.com',
  method: 'GET',
  path: '/',
  headers: [],
  query: [],
  ...patch,
});

const backend = (name: string, weight?: number) => ({
  name,
  port: 8080,
  ...(weight !== undefined ? { weight } : {}),
});

describe('hostMatches', () => {
  it('matches exact hosts and wildcards of one or more labels', () => {
    expect(hostMatches('a.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('a.b.example.com', '*.example.com')).toBe(true);
    expect(hostMatches('example.com', '*.example.com')).toBe(false);
    expect(hostMatches('example.com', 'example.com')).toBe(true);
  });
});

describe('traceRequest', () => {
  it('picks the listener with the most specific hostname on a port', () => {
    const trace = traceRequest(gateway, [], request({ host: 'api.example.com:80' }));
    expect(trace.listeners.map(l => [l.name, l.accepts])).toEqual([
      ['http', false],
      ['api', true],
      ['tcp', false],
    ]);
    expect(trace.reason).toMatch(/No HTTPRoute is attached/);
  });

  it('prefers an Exact path, then the longest prefix, and respects path elements', () => {
    const routes = [
      route('web', [
        { matches: [{ path: { type: 'PathPrefix', value: '/' } }], backendRefs: [backend('web')] },
        {
          matches: [{ path: { type: 'PathPrefix', value: '/api' } }],
          backendRefs: [backend('api')],
        },
        {
          matches: [{ path: { type: 'Exact', value: '/api/health' } }],
          backendRefs: [backend('health')],
        },
      ]),
    ];
    const winner = (path: string) =>
      traceRequest(gateway, routes, request({ path })).candidates[0].backends[0].name;
    expect(winner('/api/health')).toBe('health');
    expect(winner('/api/users')).toBe('api');
    expect(winner('/apiary')).toBe('web');
    expect(traceRequest(gateway, routes, request({ path: '/api/health' })).candidates).toHaveLength(
      3
    );
  });

  it('prefers the more specific route hostname over the match details', () => {
    const routes = [
      route('any', [
        { matches: [{ path: { type: 'Exact', value: '/x' } }], backendRefs: [backend('any')] },
      ]),
      route('shop', [{ backendRefs: [backend('shop')] }], { hostnames: ['shop.example.com'] }),
    ];
    expect(
      traceRequest(gateway, routes, request({ path: '/x' })).candidates[0].backends[0].name
    ).toBe('shop');
  });

  it('matches method, headers (case-insensitive names) and query parameters, and counts them', () => {
    const routes = [
      route('r', [
        { backendRefs: [backend('plain')] },
        {
          matches: [
            {
              method: 'POST',
              headers: [{ name: 'X-Canary', value: 'true' }],
              queryParams: [{ type: 'RegularExpression', name: 'v', value: '2.*' }],
            },
          ],
          backendRefs: [backend('canary')],
        },
      ]),
    ];
    const post = request({
      method: 'post',
      headers: [{ name: 'x-canary', value: 'true' }],
      query: [{ name: 'v', value: '2.1' }],
    });
    const trace = traceRequest(gateway, routes, post);
    expect(trace.candidates.map(c => c.backends[0].name)).toEqual(['canary', 'plain']);
    expect(trace.candidates[0]).toMatchObject({
      method: 'POST',
      headerMatches: 1,
      queryMatches: 1,
    });
    expect(trace.regexUsed).toBe(false);
    expect(
      traceRequest(gateway, routes, { ...post, method: 'GET' }).candidates[0].backends[0].name
    ).toBe('plain');
  });

  it('breaks ties by the oldest route, then by namespace and name', () => {
    const rules = (name: string) => [{ backendRefs: [backend(name)] }];
    const routes = [
      route('b', rules('b'), { created: '2026-01-01T00:00:00Z' }),
      route('a', rules('a'), { created: '2026-02-01T00:00:00Z' }),
      route('c', rules('c'), { created: '2026-01-01T00:00:00Z' }),
    ];
    expect(
      traceRequest(gateway, routes, request()).candidates.map(c => c.backends[0].name)
    ).toEqual(['b', 'c', 'a']);
  });

  it('shares traffic by weight and lists the filters', () => {
    const routes = [
      route('split', [
        {
          filters: [{ type: 'RequestHeaderModifier' }],
          backendRefs: [backend('v1', 90), backend('v2', 10)],
        },
      ]),
    ];
    const [winner] = traceRequest(gateway, routes, request()).candidates;
    expect(winner.backends.map(b => [b.name, b.share])).toEqual([
      ['v1', 0.9],
      ['v2', 0.1],
    ]);
    expect(winner.filters).toEqual(['RequestHeaderModifier']);
  });

  it('only uses the listeners a route attaches to', () => {
    const routes = [route('api-only', [{ backendRefs: [backend('api')] }], { sectionName: 'api' })];
    expect(traceRequest(gateway, routes, request()).candidates).toEqual([]);
    expect(
      traceRequest(gateway, routes, request({ host: 'api.example.com' })).candidates
    ).toHaveLength(1);
  });

  it('explains when no listener takes the request', () => {
    const trace = traceRequest(gateway, [], request({ port: 9000 }));
    expect(trace.reason).toMatch(/No HTTP or HTTPS listener/);
    expect(trace.listeners.find(l => l.name === 'tcp')?.reason).toBe('TCP listener');
  });
});
