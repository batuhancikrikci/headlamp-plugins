import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import { setIn } from './objects';
import {
  errorsOnly,
  issuesAt,
  issuesUnder,
  isValidPort,
  parseDuration,
  validateResource,
  ValidationIssue,
} from './validation';

const V1 = `${GATEWAY_GROUP}/v1`;

function errors(obj: unknown): string[] {
  return errorsOnly(validateResource(obj)).map(issue => issue.path);
}

function messageAt(issues: ValidationIssue[], path: string): string | undefined {
  return issuesAt(issues, path)[0]?.message;
}

const gateway: KubeJson = {
  apiVersion: V1,
  kind: 'Gateway',
  metadata: { name: 'eg', namespace: 'default' },
  spec: {
    gatewayClassName: 'eg',
    listeners: [
      { name: 'http', protocol: 'HTTP', port: 80 },
      {
        name: 'https',
        protocol: 'HTTPS',
        port: 443,
        hostname: '*.example.com',
        tls: { mode: 'Terminate', certificateRefs: [{ name: 'cert' }] },
      },
    ],
  },
};

const httpRoute: KubeJson = {
  apiVersion: V1,
  kind: 'HTTPRoute',
  metadata: { name: 'web', namespace: 'default' },
  spec: {
    parentRefs: [{ name: 'eg' }],
    hostnames: ['www.example.com'],
    rules: [
      {
        matches: [{ path: { type: 'PathPrefix', value: '/' } }],
        backendRefs: [{ name: 'web', port: 8080 }],
      },
    ],
  },
};

describe('primitives', () => {
  it('validates ports', () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(80.5)).toBe(false);
    expect(isValidPort('80')).toBe(false);
  });

  it('parses Gateway API durations', () => {
    expect(parseDuration('10s')).toBe(10000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1h30m')).toBe(5400000);
    expect(parseDuration('1m5s200ms')).toBe(65200);
    expect(parseDuration('10')).toBeUndefined();
    expect(parseDuration('1.5s')).toBeUndefined();
    expect(parseDuration('1d')).toBeUndefined();
    expect(parseDuration(10)).toBeUndefined();
  });

  it('filters issues by path', () => {
    const issues: ValidationIssue[] = [
      { path: 'spec.rules.0.name', message: 'a', severity: 'error' },
      { path: 'spec.rules.10.name', message: 'b', severity: 'error' },
      { path: 'spec.rules', message: 'c', severity: 'warning' },
    ];
    expect(issuesAt(issues, 'spec.rules')).toHaveLength(1);
    expect(issuesUnder(issues, 'spec.rules.1')).toHaveLength(0);
    expect(issuesUnder(issues, 'spec.rules.0')).toHaveLength(1);
    expect(issuesUnder(issues, 'spec.rules')).toHaveLength(3);
    expect(errorsOnly(issues)).toHaveLength(2);
  });
});

describe('metadata', () => {
  it('requires a valid name and namespace', () => {
    expect(errors({ ...gateway, metadata: {} })).toEqual(['metadata.name', 'metadata.namespace']);
    expect(errors(setIn(gateway, 'metadata.name', 'Invalid_Name'))).toEqual(['metadata.name']);
    expect(errors(setIn(gateway, 'metadata.namespace', 'has.dot'))).toEqual(['metadata.namespace']);
  });

  it('does not require a namespace for cluster-scoped kinds', () => {
    expect(
      errors({
        apiVersion: V1,
        kind: 'GatewayClass',
        metadata: { name: 'eg' },
        spec: { controllerName: 'gateway.envoyproxy.io/gatewayclass-controller' },
      })
    ).toEqual([]);
  });

  it('rejects non-objects and missing type information', () => {
    expect(errors('nope')).toEqual(['']);
    expect(errors({ metadata: { name: 'a', namespace: 'b' } })).toEqual(['apiVersion', 'kind']);
    expect(errors({ ...gateway, spec: [] })).toEqual(['spec']);
  });
});

describe('GatewayClass', () => {
  const base = { apiVersion: V1, kind: 'GatewayClass', metadata: { name: 'eg' } };

  it('requires a domain-prefixed controller name', () => {
    expect(errors({ ...base, spec: {} })).toEqual(['spec.controllerName']);
    expect(errors({ ...base, spec: { controllerName: 'no-slash' } })).toEqual([
      'spec.controllerName',
    ]);
    expect(errors({ ...base, spec: { controllerName: 'example.com/controller' } })).toEqual([]);
  });

  it('checks the description length and parametersRef', () => {
    expect(
      errors({
        ...base,
        spec: {
          controllerName: 'example.com/controller',
          description: 'x'.repeat(65),
          parametersRef: { group: 'gateway.envoyproxy.io', kind: 'EnvoyProxy' },
        },
      })
    ).toEqual(['spec.description', 'spec.parametersRef.name']);
  });
});

describe('Gateway', () => {
  it('accepts a valid Gateway', () => {
    expect(validateResource(gateway)).toEqual([]);
  });

  it('requires a class and at least one listener', () => {
    expect(errors(setIn(gateway, 'spec.gatewayClassName', ''))).toEqual(['spec.gatewayClassName']);
    expect(errors(setIn(gateway, 'spec.listeners', []))).toEqual(['spec.listeners']);
  });

  it('validates listener name, port and protocol', () => {
    expect(errors(setIn(gateway, 'spec.listeners.0.name', 'HTTP'))).toEqual([
      'spec.listeners.0.name',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.0.port', 70000))).toEqual([
      'spec.listeners.0.port',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.0.port', undefined))).toEqual([
      'spec.listeners.0.port',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.0.protocol', 'not valid'))).toEqual([
      'spec.listeners.0.protocol',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.0.protocol', 'example.com/Custom'))).toEqual([]);
  });

  it('requires unique listener names and port/protocol/hostname combinations', () => {
    expect(errors(setIn(gateway, 'spec.listeners.1.name', 'http'))).toEqual([
      'spec.listeners.1.name',
    ]);
    const duplicate = setIn(gateway, 'spec.listeners.2', {
      name: 'http2',
      protocol: 'HTTP',
      port: 80,
    });
    expect(errors(duplicate)).toEqual(['spec.listeners.2.port']);
  });

  it('enforces the TLS rules per protocol', () => {
    expect(errors(setIn(gateway, 'spec.listeners.0.tls', { mode: 'Terminate' }))).toEqual([
      'spec.listeners.0.tls',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.1.tls', undefined))).toEqual([
      'spec.listeners.1.tls',
    ]);
    expect(errors(setIn(gateway, 'spec.listeners.1.tls.mode', 'Passthrough'))).toContain(
      'spec.listeners.1.tls.mode'
    );
    expect(errors(setIn(gateway, 'spec.listeners.1.tls.certificateRefs', []))).toEqual([
      'spec.listeners.1.tls.certificateRefs',
    ]);
    // Options (e.g. implementation specific certificate sources) satisfy the requirement.
    const withOptions = setIn(
      setIn(gateway, 'spec.listeners.1.tls.certificateRefs', []),
      'spec.listeners.1.tls.options',
      { 'example.com/cert': 'x' }
    );
    expect(errors(withOptions)).toEqual([]);
  });

  it('requires an explicit TLS mode for TLS listeners', () => {
    const tls = setIn(gateway, 'spec.listeners.1', {
      name: 'tls',
      protocol: 'TLS',
      port: 8443,
      tls: { certificateRefs: [{ name: 'cert' }] },
    });
    expect(errors(tls)).toEqual(['spec.listeners.1.tls.mode']);
    expect(errors(setIn(tls, 'spec.listeners.1.tls', { mode: 'Passthrough' }))).toEqual([]);
  });

  it('rejects hostnames on TCP and UDP listeners', () => {
    const tcp = setIn(gateway, 'spec.listeners.0', {
      name: 'tcp',
      protocol: 'TCP',
      port: 9000,
      hostname: 'db.example.com',
    });
    expect(errors(tcp)).toEqual(['spec.listeners.0.hostname']);
  });

  it('validates allowed routes', () => {
    const selector = setIn(gateway, 'spec.listeners.0.allowedRoutes', {
      namespaces: { from: 'Selector' },
    });
    expect(errors(selector)).toEqual(['spec.listeners.0.allowedRoutes.namespaces.selector']);
    const withLabels = setIn(selector, 'spec.listeners.0.allowedRoutes.namespaces.selector', {
      matchLabels: { team: 'a' },
    });
    expect(errors(withLabels)).toEqual([]);
    expect(errors(setIn(gateway, 'spec.listeners.0.allowedRoutes', { kinds: [{}] }))).toEqual([
      'spec.listeners.0.allowedRoutes.kinds.0.kind',
    ]);
  });

  it('validates addresses', () => {
    expect(errors(setIn(gateway, 'spec.addresses', [{ value: 'not-an-ip' }]))).toEqual([
      'spec.addresses.0.value',
    ]);
    expect(
      errors(setIn(gateway, 'spec.addresses', [{ value: '10.0.0.1' }, { value: '10.0.0.1' }]))
    ).toEqual(['spec.addresses.1.value']);
    expect(
      errors(setIn(gateway, 'spec.addresses', [{ type: 'Hostname', value: 'lb.example.com' }]))
    ).toEqual([]);
  });
});

describe('ListenerSet', () => {
  it('requires a parent Gateway and valid listeners', () => {
    const listenerSet = {
      apiVersion: V1,
      kind: 'ListenerSet',
      metadata: { name: 'team', namespace: 'apps' },
      spec: { parentRef: { name: '' }, listeners: [{ name: 'http', protocol: 'HTTP', port: 0 }] },
    };
    expect(errors(listenerSet)).toEqual(['spec.parentRef.name', 'spec.listeners.0.port']);
  });
});

describe('HTTPRoute', () => {
  it('accepts a valid route', () => {
    expect(validateResource(httpRoute)).toEqual([]);
  });

  it('warns (but does not fail) when there is no parent or no backend', () => {
    const noParent = validateResource(setIn(httpRoute, 'spec.parentRefs', []));
    expect(noParent).toHaveLength(1);
    expect(noParent[0]).toMatchObject({ path: 'spec.parentRefs', severity: 'warning' });

    const noBackend = validateResource(setIn(httpRoute, 'spec.rules.0.backendRefs', []));
    expect(noBackend).toHaveLength(1);
    expect(noBackend[0]).toMatchObject({ path: 'spec.rules.0.backendRefs', severity: 'warning' });
  });

  it('validates parentRefs, including duplicates of the same parent', () => {
    expect(errors(setIn(httpRoute, 'spec.parentRefs.0.name', ''))).toEqual([
      'spec.parentRefs.0.name',
    ]);
    expect(errors(setIn(httpRoute, 'spec.parentRefs.0.port', 0))).toEqual([
      'spec.parentRefs.0.port',
    ]);
    expect(errors(setIn(httpRoute, 'spec.parentRefs', [{ name: 'eg' }, { name: 'eg' }]))).toEqual([
      'spec.parentRefs.0.sectionName',
      'spec.parentRefs.1.sectionName',
    ]);
    expect(
      errors(
        setIn(httpRoute, 'spec.parentRefs', [
          { name: 'eg', sectionName: 'http' },
          { name: 'eg', sectionName: 'https' },
        ])
      )
    ).toEqual([]);
    expect(
      errors(
        setIn(httpRoute, 'spec.parentRefs', [
          { name: 'eg', sectionName: 'http' },
          { name: 'eg', sectionName: 'http' },
        ])
      )
    ).toEqual(['spec.parentRefs.1.sectionName']);
  });

  it('validates hostnames', () => {
    expect(errors(setIn(httpRoute, 'spec.hostnames', ['Bad Host']))).toEqual(['spec.hostnames.0']);
    expect(errors(setIn(httpRoute, 'spec.hostnames', ['a.example.com', 'a.example.com']))).toEqual([
      'spec.hostnames.1',
    ]);
    expect(errors(setIn(httpRoute, 'spec.hostnames', ['']))).toEqual(['spec.hostnames.0']);
  });

  it('validates path matches', () => {
    const path = 'spec.rules.0.matches.0.path.value';
    expect(errors(setIn(httpRoute, path, 'api'))).toEqual([path]);
    expect(errors(setIn(httpRoute, path, '/a//b'))).toEqual([path]);
    expect(errors(setIn(httpRoute, path, '/a/../b'))).toEqual([path]);
    expect(errors(setIn(httpRoute, path, '/a b'))).toEqual([path]);
    expect(errors(setIn(httpRoute, path, '/api/v1'))).toEqual([]);
    // Regular expressions are not checked against the path rules.
    const regex = setIn(httpRoute, 'spec.rules.0.matches.0.path', {
      type: 'RegularExpression',
      value: '^/api/(v1|v2)/.*',
    });
    expect(errors(regex)).toEqual([]);
  });

  it('validates header matches, query matches and the method', () => {
    const match = (extra: Record<string, unknown>) =>
      setIn(httpRoute, 'spec.rules.0.matches.0', { path: { value: '/' }, ...extra });
    expect(errors(match({ headers: [{ name: 'x-env', value: '' }] }))).toEqual([
      'spec.rules.0.matches.0.headers.0.value',
    ]);
    expect(
      errors(
        match({
          headers: [
            { name: 'X-Env', value: 'a' },
            { name: 'x-env', value: 'b' },
          ],
        })
      )
    ).toEqual(['spec.rules.0.matches.0.headers.1.name']);
    expect(errors(match({ queryParams: [{ name: 'bad name', value: 'x' }] }))).toEqual([
      'spec.rules.0.matches.0.queryParams.0.name',
    ]);
    expect(errors(match({ method: 'FETCH' }))).toEqual(['spec.rules.0.matches.0.method']);
    expect(errors(match({ method: 'POST' }))).toEqual([]);
  });

  it('validates backends', () => {
    expect(errors(setIn(httpRoute, 'spec.rules.0.backendRefs.0.name', ''))).toEqual([
      'spec.rules.0.backendRefs.0.name',
    ]);
    expect(errors(setIn(httpRoute, 'spec.rules.0.backendRefs.0.port', undefined))).toEqual([
      'spec.rules.0.backendRefs.0.port',
    ]);
    expect(errors(setIn(httpRoute, 'spec.rules.0.backendRefs.0.weight', -1))).toEqual([
      'spec.rules.0.backendRefs.0.weight',
    ]);
    // Non-Service backends do not need a port.
    const custom = setIn(httpRoute, 'spec.rules.0.backendRefs.0', {
      group: 'gateway.envoyproxy.io',
      kind: 'Backend',
      name: 'external',
    });
    expect(errors(custom)).toEqual([]);
  });

  it('requires the configuration that matches the filter type', () => {
    const filters = (list: unknown[]) => setIn(httpRoute, 'spec.rules.0.filters', list);
    expect(errors(filters([{}]))).toEqual(['spec.rules.0.filters.0.type']);
    expect(errors(filters([{ type: 'Nope' }]))).toEqual(['spec.rules.0.filters.0.type']);
    expect(errors(filters([{ type: 'RequestHeaderModifier' }]))).toEqual([
      'spec.rules.0.filters.0.requestHeaderModifier',
    ]);
    expect(
      errors(filters([{ type: 'URLRewrite', urlRewrite: { hostname: 'a.example.com' }, cors: {} }]))
    ).toEqual(['spec.rules.0.filters.0.cors']);
    expect(
      errors(
        filters([
          {
            type: 'RequestHeaderModifier',
            requestHeaderModifier: { set: [{ name: 'x-env', value: 'prod' }] },
          },
        ])
      )
    ).toEqual([]);
  });

  it('rejects repeated and conflicting filters', () => {
    const header = {
      type: 'RequestHeaderModifier',
      requestHeaderModifier: { remove: ['x-debug'] },
    };
    expect(errors(setIn(httpRoute, 'spec.rules.0.filters', [header, header]))).toEqual([
      'spec.rules.0.filters',
    ]);
    const rule = {
      filters: [
        { type: 'RequestRedirect', requestRedirect: { scheme: 'https' } },
        { type: 'URLRewrite', urlRewrite: { hostname: 'a.example.com' } },
      ],
    };
    expect(errors(setIn(httpRoute, 'spec.rules.0', rule))).toEqual(['spec.rules.0.filters']);
  });

  it('does not allow backends on a redirecting rule', () => {
    const redirect = setIn(httpRoute, 'spec.rules.0.filters', [
      { type: 'RequestRedirect', requestRedirect: { scheme: 'https', statusCode: 301 } },
    ]);
    expect(errors(redirect)).toEqual(['spec.rules.0.backendRefs']);
    // Without backends a redirect rule is complete: no "no backends" warning either.
    expect(validateResource(setIn(redirect, 'spec.rules.0.backendRefs', undefined))).toEqual([]);
  });

  it('validates redirect and rewrite details', () => {
    const redirect = (config: Record<string, unknown>) =>
      setIn(setIn(httpRoute, 'spec.rules.0.backendRefs', undefined), 'spec.rules.0.filters', [
        { type: 'RequestRedirect', requestRedirect: config },
      ]);
    const base = 'spec.rules.0.filters.0.requestRedirect';
    expect(errors(redirect({ scheme: 'ftp' }))).toEqual([`${base}.scheme`]);
    expect(errors(redirect({ statusCode: 200 }))).toEqual([`${base}.statusCode`]);
    expect(errors(redirect({ hostname: '*.example.com' }))).toEqual([`${base}.hostname`]);
    expect(errors(redirect({ path: { type: 'ReplaceFullPath' } }))).toEqual([
      `${base}.path.replaceFullPath`,
    ]);
    expect(
      errors(redirect({ path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/v2' } }))
    ).toEqual([]);
  });

  it('requires a single PathPrefix match for prefix replacement', () => {
    const rewrite = {
      type: 'URLRewrite',
      urlRewrite: { path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/' } },
    };
    const exact = setIn(
      setIn(httpRoute, 'spec.rules.0.filters', [rewrite]),
      'spec.rules.0.matches.0.path.type',
      'Exact'
    );
    expect(errors(exact)).toEqual(['spec.rules.0.matches']);
    expect(errors(setIn(httpRoute, 'spec.rules.0.filters', [rewrite]))).toEqual([]);
  });

  it('validates mirror, CORS and external auth filters', () => {
    const filters = (list: unknown[]) => setIn(httpRoute, 'spec.rules.0.filters', list);
    expect(
      errors(
        filters([
          {
            type: 'RequestMirror',
            requestMirror: { backendRef: { name: 'mirror' }, percent: 150 },
          },
        ])
      )
    ).toEqual([
      'spec.rules.0.filters.0.requestMirror.backendRef.port',
      'spec.rules.0.filters.0.requestMirror.percent',
    ]);
    expect(
      errors(filters([{ type: 'CORS', cors: { allowOrigins: ['*', 'https://a.example.com'] } }]))
    ).toEqual(['spec.rules.0.filters.0.cors.allowOrigins']);
    expect(
      errors(
        filters([
          {
            type: 'ExternalAuth',
            externalAuth: { protocol: 'GRPC', backendRef: { name: 'auth', port: 9000 } },
          },
        ])
      )
    ).toEqual(['spec.rules.0.filters.0.externalAuth.grpc']);
  });

  it('validates timeouts, retries and session persistence', () => {
    expect(errors(setIn(httpRoute, 'spec.rules.0.timeouts', { request: '10' }))).toEqual([
      'spec.rules.0.timeouts.request',
    ]);
    expect(
      errors(setIn(httpRoute, 'spec.rules.0.timeouts', { request: '5s', backendRequest: '10s' }))
    ).toEqual(['spec.rules.0.timeouts.backendRequest']);
    expect(
      errors(setIn(httpRoute, 'spec.rules.0.retry', { attempts: 0, backoff: 'soon', codes: [200] }))
    ).toEqual([
      'spec.rules.0.retry.attempts',
      'spec.rules.0.retry.backoff',
      'spec.rules.0.retry.codes.0',
    ]);
    expect(
      errors(
        setIn(httpRoute, 'spec.rules.0.sessionPersistence', {
          cookieConfig: { lifetimeType: 'Permanent' },
        })
      )
    ).toEqual(['spec.rules.0.sessionPersistence.absoluteTimeout']);
  });

  it('requires unique rule names', () => {
    const rule = (name: string) => ({ name, backendRefs: [{ name: 'web', port: 80 }] });
    expect(errors(setIn(httpRoute, 'spec.rules', [rule('a'), rule('a')]))).toEqual([
      'spec.rules.1.name',
    ]);
  });

  it('survives malformed input', () => {
    expect(errors(setIn(httpRoute, 'spec.rules', 'nope'))).toEqual(['spec.rules']);
    expect(errors(setIn(httpRoute, 'spec.rules', [null]))).toEqual(['spec.rules.0']);
    expect(errors(setIn(httpRoute, 'spec.rules.0.matches', [5]))).toEqual([
      'spec.rules.0.matches.0',
    ]);
  });
});

describe('GRPCRoute', () => {
  const grpcRoute: KubeJson = {
    apiVersion: V1,
    kind: 'GRPCRoute',
    metadata: { name: 'grpc', namespace: 'default' },
    spec: {
      parentRefs: [{ name: 'eg' }],
      rules: [
        {
          matches: [{ method: { service: 'pkg.v1.Greeter', method: 'SayHello' } }],
          backendRefs: [{ name: 'greeter', port: 50051 }],
        },
      ],
    },
  };

  it('accepts a valid route', () => {
    expect(validateResource(grpcRoute)).toEqual([]);
  });

  it('validates method matches', () => {
    expect(errors(setIn(grpcRoute, 'spec.rules.0.matches.0.method', {}))).toEqual([
      'spec.rules.0.matches.0.method.service',
    ]);
    expect(
      errors(setIn(grpcRoute, 'spec.rules.0.matches.0.method.service', 'bad service'))
    ).toEqual(['spec.rules.0.matches.0.method.service']);
    expect(errors(setIn(grpcRoute, 'spec.rules.0.matches.0.method.method', '1Bad'))).toEqual([
      'spec.rules.0.matches.0.method.method',
    ]);
  });

  it('only allows the gRPC filter types', () => {
    expect(
      errors(
        setIn(grpcRoute, 'spec.rules.0.filters', [
          { type: 'URLRewrite', urlRewrite: { hostname: 'a.example.com' } },
        ])
      )
    ).toEqual(['spec.rules.0.filters.0.type']);
  });
});

describe('TLSRoute, TCPRoute and UDPRoute', () => {
  const l4 = (kind: string, spec: Record<string, unknown>): KubeJson => ({
    apiVersion: V1,
    kind,
    metadata: { name: 'route', namespace: 'default' },
    spec: { parentRefs: [{ name: 'eg' }], ...spec },
  });

  it('requires exactly one rule with at least one backend', () => {
    expect(errors(l4('TCPRoute', { rules: [] }))).toEqual(['spec.rules']);
    expect(errors(l4('TCPRoute', { rules: [{ backendRefs: [] }] }))).toEqual([
      'spec.rules.0.backendRefs',
    ]);
    const backend = { backendRefs: [{ name: 'db', port: 5432 }] };
    expect(errors(l4('UDPRoute', { rules: [backend, backend] }))).toEqual(['spec.rules']);
    expect(errors(l4('TCPRoute', { rules: [backend] }))).toEqual([]);
  });

  it('requires hostnames for TLSRoute only', () => {
    const rules = [{ backendRefs: [{ name: 'app', port: 443 }] }];
    expect(errors(l4('TLSRoute', { rules }))).toEqual(['spec.hostnames']);
    expect(errors(l4('TLSRoute', { rules, hostnames: ['app.example.com'] }))).toEqual([]);
    expect(errors(l4('TCPRoute', { rules }))).toEqual([]);
  });
});

describe('ReferenceGrant', () => {
  const grant = (spec: Record<string, unknown>): KubeJson => ({
    apiVersion: V1,
    kind: 'ReferenceGrant',
    metadata: { name: 'grant', namespace: 'backends' },
    spec,
  });

  it('requires sources and targets', () => {
    expect(errors(grant({ from: [], to: [] }))).toEqual(['spec.from', 'spec.to']);
  });

  it('validates each entry', () => {
    expect(
      errors(
        grant({
          from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: '' }],
          to: [{ group: '', kind: '' }],
        })
      )
    ).toEqual(['spec.from.0.namespace', 'spec.to.0.kind']);
    expect(
      errors(
        grant({
          from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'apps' }],
          to: [{ group: '', kind: 'Service' }],
        })
      )
    ).toEqual([]);
    // The core group is an empty string, which is different from a missing group.
    expect(
      errors(
        grant({
          from: [{ kind: 'HTTPRoute', namespace: 'apps' }],
          to: [{ group: '', kind: 'Service' }],
        })
      )
    ).toEqual(['spec.from.0.group']);
  });
});

describe('BackendTLSPolicy', () => {
  const policy = (validation: Record<string, unknown>, targetRefs?: unknown[]): KubeJson => ({
    apiVersion: V1,
    kind: 'BackendTLSPolicy',
    metadata: { name: 'tls', namespace: 'default' },
    spec: {
      targetRefs: targetRefs || [{ group: '', kind: 'Service', name: 'web' }],
      validation,
    },
  });

  it('requires exactly one source of CA certificates', () => {
    expect(errors(policy({ hostname: 'web.example.com' }))).toEqual([
      'spec.validation.caCertificateRefs',
    ]);
    expect(
      errors(
        policy({
          hostname: 'web.example.com',
          wellKnownCACertificates: 'System',
          caCertificateRefs: [{ group: '', kind: 'ConfigMap', name: 'ca' }],
        })
      )
    ).toEqual(['spec.validation.wellKnownCACertificates']);
    expect(
      errors(policy({ hostname: 'web.example.com', wellKnownCACertificates: 'System' }))
    ).toEqual([]);
  });

  it('requires a precise hostname', () => {
    expect(errors(policy({ wellKnownCACertificates: 'System' }))).toEqual([
      'spec.validation.hostname',
    ]);
    expect(
      errors(policy({ hostname: '*.example.com', wellKnownCACertificates: 'System' }))
    ).toEqual(['spec.validation.hostname']);
  });

  it('validates subject alt names', () => {
    expect(
      errors(
        policy({
          hostname: 'web.example.com',
          wellKnownCACertificates: 'System',
          subjectAltNames: [
            { type: 'URI' },
            { type: 'Hostname', hostname: 'a.example.com', uri: 'x' },
          ],
        })
      )
    ).toEqual(['spec.validation.subjectAltNames.0.uri', 'spec.validation.subjectAltNames.1.uri']);
  });

  it('requires section names when a target is referenced twice', () => {
    const service = { group: '', kind: 'Service', name: 'web' };
    const validation = { hostname: 'web.example.com', wellKnownCACertificates: 'System' };
    expect(errors(policy(validation, [service, service]))).toEqual([
      'spec.targetRefs.0.sectionName',
      'spec.targetRefs.1.sectionName',
    ]);
    expect(
      errors(
        policy(validation, [
          { ...service, sectionName: 'http' },
          { ...service, sectionName: 'grpc' },
        ])
      )
    ).toEqual([]);
    expect(errors(policy(validation, []))).toEqual(['spec.targetRefs']);
  });
});

describe('messages', () => {
  it('explains problems in plain language', () => {
    const issues = validateResource(setIn(gateway, 'spec.listeners.1.tls.certificateRefs', []));
    expect(messageAt(issues, 'spec.listeners.1.tls.certificateRefs')).toBe(
      'A certificate is required when TLS is terminated at the Gateway'
    );
  });
});
