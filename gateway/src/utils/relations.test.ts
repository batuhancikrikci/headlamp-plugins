import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, Listener } from '../resources/types';
import {
  defaultRouteKinds,
  evaluateAttachment,
  kindAllowed,
  listenerSetAllowed,
  matchesSelector,
  namespaceAllowed,
  parentRefsFor,
  routesForParent,
} from './attachment';
import {
  effectiveHostnames,
  hostnameError,
  hostnamesOverlap,
  intersectHostnames,
  isValidHostname,
} from './hostnames';
import {
  checkReferences,
  deniedReferences,
  grantFor,
  grantPermits,
  grantUsage,
  outgoingRefs,
} from './referenceGrants';
import {
  formatRef,
  identityOf,
  parentRefTargets,
  parseParentText,
  resolveBackendRef,
  resolveParentRef,
  routeBackends,
  routeParentRefs,
  routeTargetsParent,
  uniqueRouteBackends,
} from './refs';

const API_VERSION = `${GATEWAY_GROUP}/v1`;

const gateway = {
  apiVersion: API_VERSION,
  kind: 'Gateway',
  metadata: { name: 'eg', namespace: 'infra' },
  spec: {
    gatewayClassName: 'eg',
    listeners: [
      { name: 'http', protocol: 'HTTP', port: 80 },
      {
        name: 'https',
        protocol: 'HTTPS',
        port: 443,
        hostname: '*.example.com',
        tls: { certificateRefs: [{ name: 'wildcard' }, { name: 'shared', namespace: 'certs' }] },
        allowedRoutes: { namespaces: { from: 'All' } },
      },
      {
        name: 'team',
        protocol: 'HTTP',
        port: 8080,
        allowedRoutes: {
          namespaces: { from: 'Selector', selector: { matchLabels: { team: 'a' } } },
        },
      },
      { name: 'tcp', protocol: 'TCP', port: 9000, allowedRoutes: { namespaces: { from: 'All' } } },
    ],
  },
};

function httpRoute(overrides: Record<string, unknown> = {}, namespace = 'apps') {
  return {
    apiVersion: API_VERSION,
    kind: 'HTTPRoute',
    metadata: { name: 'web', namespace },
    spec: {
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [{ backendRefs: [{ name: 'web', port: 8080 }] }],
      ...overrides,
    },
  };
}

describe('hostnames', () => {
  it('validates hostnames', () => {
    expect(isValidHostname('example.com')).toBe(true);
    expect(isValidHostname('*.example.com')).toBe(true);
    expect(isValidHostname('a-b.example.com')).toBe(true);
    expect(hostnameError('')).toMatch(/empty/);
    expect(hostnameError('Example.com')).toMatch(/lowercase/);
    expect(hostnameError('10.0.0.1')).toMatch(/IP addresses/);
    expect(hostnameError('foo.*.example.com')).toMatch(/first label/);
    expect(hostnameError('*.')).toMatch(/at least one label/);
    expect(hostnameError('foo..com')).toMatch(/empty labels/);
    expect(hostnameError('-foo.com')).toMatch(/start and end/);
    expect(hostnameError('foo_bar.com')).toMatch(/lowercase letters/);
    expect(hostnameError('*.example.com', { allowWildcard: false })).toMatch(/not allowed/);
    expect(hostnameError(`${'a'.repeat(64)}.com`)).toMatch(/63 characters/);
  });

  it('intersects exact and wildcard hostnames', () => {
    expect(intersectHostnames('a.example.com', 'a.example.com')).toBe('a.example.com');
    expect(intersectHostnames('*.example.com', 'a.example.com')).toBe('a.example.com');
    expect(intersectHostnames('a.b.example.com', '*.example.com')).toBe('a.b.example.com');
    expect(intersectHostnames('*.example.com', '*.foo.example.com')).toBe('*.foo.example.com');
    expect(intersectHostnames('*.foo.example.com', '*.example.com')).toBe('*.foo.example.com');
    // A wildcard needs at least one extra label.
    expect(intersectHostnames('*.example.com', 'example.com')).toBeUndefined();
    expect(intersectHostnames('a.example.com', 'b.example.com')).toBeUndefined();
    expect(intersectHostnames('*.example.com', '*.example.org')).toBeUndefined();
  });

  it('computes the hostnames a route serves on a listener', () => {
    expect(effectiveHostnames(undefined, undefined)).toBeNull();
    expect(effectiveHostnames(undefined, ['a.example.com'])).toEqual(['a.example.com']);
    expect(effectiveHostnames('*.example.com', [])).toEqual(['*.example.com']);
    expect(effectiveHostnames('*.example.com', ['a.example.com', 'b.other.com'])).toEqual([
      'a.example.com',
    ]);
    expect(effectiveHostnames('a.example.com', ['b.example.com'])).toEqual([]);
    expect(hostnamesOverlap('a.example.com', ['b.example.com'])).toBe(false);
    expect(hostnamesOverlap(undefined, undefined)).toBe(true);
  });
});

describe('refs', () => {
  it('applies parentRef and backendRef defaults', () => {
    expect(resolveParentRef({ name: 'eg' }, 'apps')).toEqual({
      group: GATEWAY_GROUP,
      kind: 'Gateway',
      namespace: 'apps',
      name: 'eg',
      sectionName: undefined,
      port: undefined,
    });
    expect(resolveBackendRef({ name: 'web', port: 80 }, 'apps')).toMatchObject({
      group: '',
      kind: 'Service',
      namespace: 'apps',
      name: 'web',
      port: 80,
    });
    expect(resolveBackendRef({ name: 'web', namespace: 'other' }, 'apps').namespace).toBe('other');
  });

  it('matches parentRefs against parents', () => {
    expect(
      parentRefTargets(resolveParentRef({ name: 'eg', namespace: 'infra' }, 'apps'), gateway)
    ).toBe(true);
    expect(parentRefTargets(resolveParentRef({ name: 'eg' }, 'apps'), gateway)).toBe(false);
    expect(
      parentRefTargets(
        resolveParentRef({ name: 'eg', namespace: 'infra', kind: 'Service', group: '' }, 'apps'),
        gateway
      )
    ).toBe(false);
    expect(routeTargetsParent(httpRoute(), gateway)).toBe(true);
    expect(routeParentRefs(httpRoute())).toHaveLength(1);
  });

  it('collects backends from rules and filters', () => {
    const route = httpRoute({
      rules: [
        {
          filters: [
            { type: 'RequestMirror', requestMirror: { backendRef: { name: 'mirror', port: 80 } } },
          ],
          backendRefs: [
            { name: 'web', port: 8080, weight: 90 },
            { name: 'web', port: 8080, weight: 10 },
            { name: 'canary', namespace: 'canary', port: 8080 },
          ],
        },
        {
          filters: [
            {
              type: 'ExternalAuth',
              externalAuth: { protocol: 'HTTP', backendRef: { name: 'auth', port: 9000 } },
            },
          ],
        },
      ],
    });
    const backends = routeBackends(route);
    expect(backends.map(b => `${b.source}:${b.ref.name}`)).toEqual([
      'requestMirror:mirror',
      'backendRef:web',
      'backendRef:web',
      'backendRef:canary',
      'externalAuth:auth',
    ]);
    expect(backends[3].path).toBe('spec.rules.0.backendRefs.2');
    expect(backends[4].ruleIndex).toBe(1);
    expect(uniqueRouteBackends(route).map(b => b.name)).toEqual([
      'mirror',
      'web',
      'canary',
      'auth',
    ]);
  });

  it('tolerates malformed routes', () => {
    expect(routeBackends({ kind: 'HTTPRoute', spec: { rules: 'nope' } })).toEqual([]);
    expect(
      routeBackends({ kind: 'HTTPRoute', spec: { rules: [null, { backendRefs: [1] }] } })
    ).toEqual([]);
    expect(routeParentRefs({ kind: 'HTTPRoute' })).toEqual([]);
  });

  it('parses typed or picked parents', () => {
    expect(parseParentText('eg')).toEqual({ kind: undefined, namespace: undefined, name: 'eg' });
    expect(parseParentText('infra/eg')).toEqual({
      kind: undefined,
      namespace: 'infra',
      name: 'eg',
    });
    expect(parseParentText('ListenerSet:apps/team')).toEqual({
      kind: 'ListenerSet',
      namespace: 'apps',
      name: 'team',
    });
    expect(parseParentText(' infra/ ')).toEqual({ kind: undefined, namespace: 'infra', name: '' });
  });

  it('formats references', () => {
    expect(
      formatRef({ group: '', kind: 'Service', namespace: 'apps', name: 'web', port: 80 })
    ).toBe('Service apps/web:80');
    expect(
      formatRef(
        { group: '', kind: 'Service', namespace: 'apps', name: 'web' },
        { omitKind: 'Service' }
      )
    ).toBe('apps/web');
    expect(identityOf(gateway)).toEqual({
      group: GATEWAY_GROUP,
      kind: 'Gateway',
      namespace: 'infra',
      name: 'eg',
    });
  });
});

describe('reference grants', () => {
  const grant = {
    metadata: { name: 'allow-apps', namespace: 'backends' },
    spec: {
      from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'apps' }],
      to: [{ group: '', kind: 'Service' }],
    },
  };
  const crossRoute = httpRoute({
    rules: [
      {
        backendRefs: [
          { name: 'local', port: 80 },
          { name: 'remote', namespace: 'backends', port: 80 },
        ],
      },
    ],
  });

  it('finds the references that leave the namespace', () => {
    const refs = outgoingRefs(crossRoute);
    expect(refs).toHaveLength(2);
    expect(refs[0].from).toEqual({
      group: GATEWAY_GROUP,
      kind: 'HTTPRoute',
      namespace: 'apps',
      name: 'web',
    });
    expect(refs[1].to.namespace).toBe('backends');
  });

  it('classifies references against the grants', () => {
    expect(checkReferences(crossRoute, [grant]).map(r => r.state)).toEqual([
      'same-namespace',
      'granted',
    ]);
    expect(checkReferences(crossRoute, [grant])[1].grantName).toBe('allow-apps');
    expect(checkReferences(crossRoute, []).map(r => r.state)).toEqual(['same-namespace', 'denied']);
    // Grants could not be listed: do not claim a denial.
    expect(checkReferences(crossRoute, null).map(r => r.state)).toEqual([
      'same-namespace',
      'unknown',
    ]);
    expect(deniedReferences(crossRoute, [])).toHaveLength(1);
    expect(deniedReferences(crossRoute, [grant])).toHaveLength(0);
  });

  it('requires the grant to live in the target namespace and match the source', () => {
    const [, remote] = outgoingRefs(crossRoute);
    expect(grantPermits(grant, remote)).toBe(true);
    expect(grantPermits({ ...grant, metadata: { name: 'x', namespace: 'apps' } }, remote)).toBe(
      false
    );
    const wrongKind = {
      ...grant,
      spec: {
        ...grant.spec,
        from: [{ group: GATEWAY_GROUP, kind: 'GRPCRoute', namespace: 'apps' }],
      },
    };
    expect(grantPermits(wrongKind, remote)).toBe(false);
    const wrongNamespace = {
      ...grant,
      spec: { ...grant.spec, from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'x' }] },
    };
    expect(grantPermits(wrongNamespace, remote)).toBe(false);
  });

  it('honours the optional target name', () => {
    const [, remote] = outgoingRefs(crossRoute);
    const named = (name: string) => ({
      ...grant,
      spec: { ...grant.spec, to: [{ group: '', kind: 'Service', name }] },
    });
    expect(grantPermits(named('remote'), remote)).toBe(true);
    expect(grantPermits(named('other'), remote)).toBe(false);
  });

  it('checks Gateway certificate references', () => {
    const refs = checkReferences(gateway, []);
    expect(refs.map(r => `${r.to.kind}/${r.to.namespace}/${r.to.name}:${r.state}`)).toEqual([
      'Secret/infra/wildcard:same-namespace',
      'Secret/certs/shared:denied',
    ]);
    expect(refs[1].path).toBe('spec.listeners.1.tls.certificateRefs.1');
    const secretGrant = {
      metadata: { name: 'certs', namespace: 'certs' },
      spec: {
        from: [{ group: GATEWAY_GROUP, kind: 'Gateway', namespace: 'infra' }],
        to: [{ group: '', kind: 'Secret', name: 'shared' }],
      },
    };
    expect(deniedReferences(gateway, [secretGrant])).toEqual([]);
  });

  it('reports which references rely on a grant and builds a grant for a reference', () => {
    expect(grantUsage(grant, [crossRoute, gateway]).map(r => r.to.name)).toEqual(['remote']);
    const [, remote] = outgoingRefs(crossRoute);
    expect(grantFor(remote)).toEqual({
      from: { group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'apps' },
      to: { group: '', kind: 'Service', name: 'remote' },
    });
  });

  it('has no guarded references for other kinds', () => {
    expect(outgoingRefs({ kind: 'ReferenceGrant', metadata: { namespace: 'a' } })).toEqual([]);
  });
});

describe('attachment', () => {
  const labels = { apps: { team: 'a' }, other: { team: 'b' }, infra: {} };

  it('knows the default route kinds per protocol', () => {
    expect(defaultRouteKinds('HTTP')).toEqual(['HTTPRoute', 'GRPCRoute']);
    expect(defaultRouteKinds('TLS', 'Passthrough')).toEqual(['TLSRoute']);
    expect(defaultRouteKinds('TLS')).toEqual(['TCPRoute', 'TLSRoute']);
    expect(defaultRouteKinds('example.com/custom')).toEqual([]);
  });

  it('matches label selectors', () => {
    expect(matchesSelector(undefined, { a: '1' })).toBe(true);
    expect(matchesSelector({ matchLabels: { a: '1' } }, { a: '1', b: '2' })).toBe(true);
    expect(matchesSelector({ matchLabels: { a: '2' } }, { a: '1' })).toBe(false);
    const expr = (operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist', values?: string[]) => ({
      matchExpressions: [{ key: 'env', operator, values }],
    });
    expect(matchesSelector(expr('In', ['prod']), { env: 'prod' })).toBe(true);
    expect(matchesSelector(expr('In', ['prod']), {})).toBe(false);
    expect(matchesSelector(expr('NotIn', ['prod']), { env: 'dev' })).toBe(true);
    expect(matchesSelector(expr('NotIn', ['prod']), { env: 'prod' })).toBe(false);
    expect(matchesSelector(expr('Exists'), { env: 'x' })).toBe(true);
    expect(matchesSelector(expr('DoesNotExist'), { env: 'x' })).toBe(false);
  });

  it('evaluates allowed namespaces', () => {
    expect(namespaceAllowed(undefined, 'infra', 'infra')).toBe('yes');
    expect(namespaceAllowed(undefined, 'infra', 'apps')).toBe('no');
    expect(namespaceAllowed({ namespaces: { from: 'All' } }, 'infra', 'apps')).toBe('yes');
    const selector = {
      namespaces: { from: 'Selector' as const, selector: { matchLabels: { team: 'a' } } },
    };
    expect(namespaceAllowed(selector, 'infra', 'apps', labels)).toBe('yes');
    expect(namespaceAllowed(selector, 'infra', 'other', labels)).toBe('no');
    // Namespace labels unknown: cannot decide.
    expect(namespaceAllowed(selector, 'infra', 'apps')).toBe('unknown');
  });

  it('evaluates allowed kinds', () => {
    const [http, , , tcp] = gateway.spec.listeners as Listener[];
    expect(kindAllowed(http, 'HTTPRoute')).toBe(true);
    expect(kindAllowed(http, 'TCPRoute')).toBe(false);
    expect(kindAllowed(tcp, 'TCPRoute')).toBe(true);
    expect(
      kindAllowed({ ...http, allowedRoutes: { kinds: [{ kind: 'GRPCRoute' }] } }, 'HTTPRoute')
    ).toBe(false);
    // The controller-reported supported kinds win over the defaults.
    expect(kindAllowed(http, 'HTTPRoute', GATEWAY_GROUP, [{ kind: 'GRPCRoute' }])).toBe(false);
    expect(kindAllowed({ name: 'x', port: 1, protocol: 'example.com/custom' }, 'HTTPRoute')).toBe(
      true
    );
  });

  it('attaches a cross-namespace route only to listeners that allow it', () => {
    const verdict = evaluateAttachment(httpRoute(), {}, gateway, labels);
    expect(verdict.attaches).toBe('yes');
    expect(verdict.listeners.map(l => `${l.listener.name}:${l.attaches}`)).toEqual([
      'http:no',
      'https:yes',
      'team:yes',
      'tcp:no',
    ]);
    expect(verdict.listeners[0].reasons[0]).toMatch(/Only routes in namespace "infra"/);
    expect(verdict.listeners[3].reasons[0]).toMatch(/not an allowed route kind/);
    expect(verdict.listeners[1].hostnames).toEqual(['*.example.com']);
  });

  it('honours sectionName and port', () => {
    expect(evaluateAttachment(httpRoute(), { sectionName: 'http' }, gateway).attaches).toBe('no');
    expect(evaluateAttachment(httpRoute(), { sectionName: 'https' }, gateway).attaches).toBe('yes');
    expect(evaluateAttachment(httpRoute(), { port: 443 }, gateway).listeners).toHaveLength(1);
    const missing = evaluateAttachment(httpRoute(), { sectionName: 'nope' }, gateway);
    expect(missing.attaches).toBe('no');
    expect(missing.summary).toMatch(/no listener named "nope"/);
  });

  it('rejects routes whose hostnames do not overlap', () => {
    const verdict = evaluateAttachment(
      httpRoute({ hostnames: ['app.other.org'] }),
      { sectionName: 'https' },
      gateway
    );
    expect(verdict.attaches).toBe('no');
    expect(verdict.listeners[0].reasons[0]).toMatch(/No route hostname matches/);
  });

  it('reports unknown when a namespace selector cannot be evaluated', () => {
    const verdict = evaluateAttachment(httpRoute(), { sectionName: 'team' }, gateway);
    expect(verdict.attaches).toBe('unknown');
  });

  it('ignores hostnames for TCP routes', () => {
    const tcpRoute = {
      apiVersion: API_VERSION,
      kind: 'TCPRoute',
      metadata: { name: 'db', namespace: 'apps' },
      spec: {
        parentRefs: [{ name: 'eg', namespace: 'infra' }],
        hostnames: ['ignored.example.org'],
      },
    };
    expect(evaluateAttachment(tcpRoute, { sectionName: 'tcp' }, gateway).attaches).toBe('yes');
  });

  it('finds the routes and parentRefs of a parent', () => {
    const routes = [httpRoute(), httpRoute({ parentRefs: [{ name: 'eg' }] })];
    expect(routesForParent(routes, gateway)).toHaveLength(1);
    expect(parentRefsFor(routes[0], gateway)).toHaveLength(1);
    expect(parentRefsFor(routes[1], gateway)).toHaveLength(0);
  });

  it('evaluates allowedListeners for ListenerSets', () => {
    expect(listenerSetAllowed(gateway, 'apps')).toBe('no');
    const same = { ...gateway, spec: { allowedListeners: { namespaces: { from: 'Same' } } } };
    expect(listenerSetAllowed(same, 'infra')).toBe('yes');
    expect(listenerSetAllowed(same, 'apps')).toBe('no');
    const all = { ...gateway, spec: { allowedListeners: { namespaces: { from: 'All' } } } };
    expect(listenerSetAllowed(all, 'apps')).toBe('yes');
    const selector = {
      ...gateway,
      spec: {
        allowedListeners: {
          namespaces: { from: 'Selector', selector: { matchLabels: { team: 'a' } } },
        },
      },
    };
    expect(listenerSetAllowed(selector, 'apps', labels)).toBe('yes');
    expect(listenerSetAllowed(selector, 'other', labels)).toBe('no');
    expect(listenerSetAllowed(selector, 'apps')).toBe('unknown');
  });
});
