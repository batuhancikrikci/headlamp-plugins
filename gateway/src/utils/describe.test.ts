import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import {
  allowedRouteKinds,
  backendShares,
  describeAllowedNamespaces,
  describeFilter,
  describeGRPCMatch,
  describeHTTPMatch,
  describeListener,
  describeSelector,
} from './describe';
import { attentionFor, collectAttention } from './problems';
import { parentStatusFor, resolveParentRef } from './refs';

const V1 = `${GATEWAY_GROUP}/v1`;

describe('describeHTTPMatch', () => {
  it('describes the default match', () => {
    expect(describeHTTPMatch({})).toBe('PathPrefix /');
    expect(describeHTTPMatch(undefined)).toBe('PathPrefix /');
  });

  it('describes path, method, headers and query parameters', () => {
    expect(
      describeHTTPMatch({
        path: { type: 'Exact', value: '/login' },
        method: 'POST',
        headers: [{ name: 'x-env', value: 'prod' }],
        queryParams: [{ name: 'v', value: '^2', type: 'RegularExpression' }],
      })
    ).toBe('POST Exact /login, header x-env=prod, query v~^2');
  });
});

describe('describeGRPCMatch', () => {
  it('describes service and method', () => {
    expect(describeGRPCMatch({})).toBe('Any method');
    expect(describeGRPCMatch({ method: { service: 'pkg.Greeter', method: 'Hello' } })).toBe(
      'pkg.Greeter/Hello'
    );
    expect(describeGRPCMatch({ method: { service: 'pkg.Greeter' } })).toBe('pkg.Greeter/*');
    expect(
      describeGRPCMatch({
        method: { method: 'Get.*', type: 'RegularExpression' },
        headers: [{ name: 'x-tenant', value: 'a' }],
      })
    ).toBe('*/Get.* (regex), header x-tenant=a');
  });
});

describe('describeFilter', () => {
  it('describes header modifiers', () => {
    expect(
      describeFilter({
        type: 'RequestHeaderModifier',
        requestHeaderModifier: {
          set: [{ name: 'x-a', value: '1' }],
          add: [{ name: 'x-b', value: '2' }],
          remove: ['x-c'],
        },
      })
    ).toBe('Request headers: set x-a; add x-b; remove x-c');
  });

  it('describes redirects and rewrites', () => {
    expect(
      describeFilter({
        type: 'RequestRedirect',
        requestRedirect: { scheme: 'https', statusCode: 301 },
      })
    ).toBe('Redirect: https://<same host> (301)');
    expect(
      describeFilter({
        type: 'RequestRedirect',
        requestRedirect: {
          hostname: 'new.example.com',
          port: 8443,
          path: { type: 'ReplaceFullPath', replaceFullPath: '/x' },
        },
      })
    ).toBe('Redirect: new.example.com:8443, path → /x (302)');
    expect(
      describeFilter({
        type: 'URLRewrite',
        urlRewrite: {
          hostname: 'internal',
          path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/' },
        },
      })
    ).toBe('URL rewrite: host → internal, prefix → /');
  });

  it('describes mirrors, CORS, external auth and extensions', () => {
    expect(
      describeFilter({
        type: 'RequestMirror',
        requestMirror: { backendRef: { name: 'shadow', port: 80 }, percent: 10 },
      })
    ).toBe('Mirror: shadow:80 (10%)');
    expect(
      describeFilter({
        type: 'CORS',
        cors: { allowOrigins: ['*'], allowMethods: ['GET'], allowCredentials: true },
      })
    ).toBe('CORS: origins *; methods GET; credentials');
    expect(
      describeFilter({
        type: 'ExternalAuth',
        externalAuth: {
          protocol: 'GRPC',
          backendRef: { name: 'authz', namespace: 'sec', port: 9000 },
        },
      })
    ).toBe('External auth: sec/authz:9000 (GRPC)');
    expect(
      describeFilter({
        type: 'ExtensionRef',
        extensionRef: { group: 'gateway.envoyproxy.io', kind: 'HTTPRouteFilter', name: 'f' },
      })
    ).toBe('Extension: HTTPRouteFilter/f');
  });

  it('survives incomplete filters', () => {
    expect(describeFilter(undefined)).toBe('Unknown filter');
    expect(describeFilter({ type: 'RequestMirror' })).toBe('Mirror: ?');
  });
});

describe('listeners and allowed routes', () => {
  it('describes listeners', () => {
    expect(
      describeListener({ name: 'https', protocol: 'HTTPS', port: 443, hostname: '*.a.com' })
    ).toBe('HTTPS:443 *.a.com');
  });

  it('describes allowed namespaces', () => {
    expect(describeAllowedNamespaces(undefined)).toBe('Same namespace');
    expect(describeAllowedNamespaces({ namespaces: { from: 'All' } })).toBe('All namespaces');
    expect(
      describeAllowedNamespaces({
        namespaces: { from: 'Selector', selector: { matchLabels: { team: 'a' } } },
      })
    ).toBe('Namespaces matching team=a');
    expect(
      describeSelector({
        matchExpressions: [
          { key: 'env', operator: 'In', values: ['prod', 'stage'] },
          { key: 'legacy', operator: 'DoesNotExist' },
        ],
      })
    ).toBe('env in (prod, stage), !legacy');
  });

  it('lists explicit or default route kinds', () => {
    expect(allowedRouteKinds({ name: 'h', protocol: 'HTTP', port: 80 })).toEqual([
      'HTTPRoute',
      'GRPCRoute',
    ]);
    expect(
      allowedRouteKinds({
        name: 'h',
        protocol: 'HTTP',
        port: 80,
        allowedRoutes: { kinds: [{ kind: 'HTTPRoute' }, { kind: 'Custom', group: 'example.com' }] },
      })
    ).toEqual(['HTTPRoute', 'Custom.example.com']);
  });
});

describe('backendShares', () => {
  it('computes the traffic share of each backend', () => {
    expect(backendShares([{ name: 'a' }])).toEqual([100]);
    expect(
      backendShares([
        { name: 'a', weight: 90 },
        { name: 'b', weight: 10 },
      ])
    ).toEqual([90, 10]);
    // Missing weights default to 1.
    expect(backendShares([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toEqual([
      33.3, 33.3, 33.3,
    ]);
    expect(
      backendShares([
        { name: 'a', weight: 0 },
        { name: 'b', weight: 0 },
      ])
    ).toEqual([0, 0]);
    expect(backendShares(undefined)).toEqual([]);
  });
});

describe('parentStatusFor', () => {
  const route = {
    kind: 'HTTPRoute',
    metadata: { name: 'web', namespace: 'apps' },
    status: {
      parents: [
        { parentRef: { name: 'eg', namespace: 'infra', sectionName: 'http' }, controllerName: 'c' },
        {
          parentRef: { name: 'eg', namespace: 'infra', sectionName: 'https' },
          controllerName: 'd',
        },
        { parentRef: { name: 'local' }, controllerName: 'e' },
      ],
    },
  };

  it('matches on the fully resolved reference including the section', () => {
    const https = resolveParentRef(
      { name: 'eg', namespace: 'infra', sectionName: 'https' },
      'apps'
    );
    expect(parentStatusFor<{ controllerName: string }>(route, https)?.controllerName).toBe('d');
    // The namespace defaults to the route's namespace on both sides.
    const local = resolveParentRef({ name: 'local' }, 'apps');
    expect(parentStatusFor<{ controllerName: string }>(route, local)?.controllerName).toBe('e');
    const whole = resolveParentRef({ name: 'eg', namespace: 'infra' }, 'apps');
    expect(parentStatusFor(route, whole)).toBeUndefined();
  });
});

describe('attention items', () => {
  const accepted = { type: 'Accepted', status: 'True' as const, reason: 'Accepted' };
  const route = (overrides: Record<string, unknown> = {}): KubeJson => ({
    apiVersion: V1,
    kind: 'HTTPRoute',
    metadata: { name: 'web', namespace: 'apps' },
    spec: {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
    },
    status: {
      parents: [
        {
          parentRef: { name: 'eg', namespace: 'infra' },
          controllerName: 'c',
          conditions: [accepted, { type: 'ResolvedRefs', status: 'True', reason: 'ResolvedRefs' }],
        },
      ],
    },
    ...overrides,
  });
  const service = {
    kind: 'Service',
    metadata: { name: 'web', namespace: 'apps' },
    spec: { ports: [{ port: 8080 }] },
  };
  const context = { grants: [], services: [service], gatewayClasses: ['eg'] };

  it('reports nothing for a healthy route', () => {
    expect(attentionFor(route(), context)).toEqual([]);
  });

  it('reports failing conditions with the controller message and a hint', () => {
    const failing = route({
      status: {
        parents: [
          {
            parentRef: { name: 'eg', namespace: 'infra' },
            controllerName: 'c',
            conditions: [
              {
                type: 'Accepted',
                status: 'False',
                reason: 'NotAllowedByListeners',
                message: 'nope',
              },
            ],
          },
        ],
      },
    });
    const items = attentionFor(failing, context);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      level: 'error',
      kind: 'HTTPRoute',
      title: 'Parent infra/eg: Not accepted',
      reason: 'NotAllowedByListeners',
      detail: 'nope',
    });
    expect(items[0].hint).toContain('allowedRoutes');
  });

  it('reports cross-namespace references without a grant', () => {
    const cross = route({
      spec: {
        parentRefs: [{ name: 'eg', namespace: 'infra' }],
        rules: [{ backendRefs: [{ name: 'api', namespace: 'backends', port: 80 }] }],
      },
    });
    const items = attentionFor(cross, { ...context, services: null });
    expect(items.map(i => i.title)).toEqual(['Reference not permitted']);
    // Unknown grants: no claim is made.
    expect(attentionFor(cross, { ...context, services: null, grants: null })).toEqual([]);
  });

  it('reports missing Services and ports when Services are known', () => {
    const missing = route({
      spec: {
        parentRefs: [{ name: 'eg', namespace: 'infra' }],
        rules: [
          {
            backendRefs: [
              { name: 'gone', port: 80 },
              { name: 'web', port: 9999 },
            ],
          },
        ],
      },
    });
    expect(attentionFor(missing, context).map(i => i.title)).toEqual([
      'Backend not found',
      'Backend port not found',
    ]);
    expect(attentionFor(missing, { ...context, services: null })).toEqual([]);
  });

  it('reports detached routes and Gateways without a class', () => {
    const detached = route({ spec: { rules: [] }, status: undefined });
    expect(attentionFor(detached, context).map(i => i.title)).toEqual(['Not attached']);

    const gateway: KubeJson = {
      apiVersion: V1,
      kind: 'Gateway',
      metadata: { name: 'gw', namespace: 'infra' },
      spec: { gatewayClassName: 'missing', listeners: [] },
      status: {
        conditions: [accepted, { type: 'Programmed', status: 'True', reason: 'Programmed' }],
      },
    };
    expect(attentionFor(gateway, context).map(i => i.title)).toEqual(['GatewayClass not found']);
    expect(attentionFor(gateway, { ...context, gatewayClasses: null })).toEqual([]);
  });

  it('ignores pending conditions and sorts errors first', () => {
    const pending: KubeJson = {
      apiVersion: V1,
      kind: 'Gateway',
      metadata: { name: 'new', namespace: 'a' },
    };
    const degraded: KubeJson = {
      apiVersion: V1,
      kind: 'Gateway',
      metadata: { name: 'deg', namespace: 'a' },
      spec: { gatewayClassName: 'eg' },
      status: {
        conditions: [
          { type: 'Accepted', status: 'True', reason: 'ListenersNotValid' },
          { type: 'Programmed', status: 'True', reason: 'Programmed' },
        ],
      },
    };
    const broken: KubeJson = {
      apiVersion: V1,
      kind: 'TCPRoute',
      metadata: { name: 'tcp', namespace: 'a' },
      spec: {},
    };
    const items = collectAttention({ objects: [pending, degraded, broken], ...context });
    expect(items.map(i => `${i.level}:${i.kind}:${i.title}`)).toEqual([
      'warning:Gateway:Accepted, degraded',
      'warning:TCPRoute:Not attached',
    ]);
  });
});
