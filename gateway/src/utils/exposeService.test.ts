import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import {
  buildExposePlan,
  ExposeContext,
  ExposeDraft,
  exposedUrls,
  followService,
  newExposeDraft,
  validateExposeDraft,
} from './exposeService';
import { errorsOnly, validateResource } from './validation';

const V1 = `${GATEWAY_GROUP}/v1`;

const context: ExposeContext = {
  apiVersions: { gateway: V1, httpRoute: V1, referenceGrant: V1 },
  grants: [],
  referenceGrantAvailable: true,
};

function draft(overrides: Partial<ExposeDraft> = {}): ExposeDraft {
  return {
    service: { namespace: 'apps', name: 'web', port: 8080 },
    gatewayMode: 'existing',
    existing: { name: 'eg', namespace: 'infra' },
    create: { name: '', namespace: 'apps', gatewayClassName: '', protocol: 'HTTP', port: 80 },
    route: { name: 'web', namespace: 'apps', pathType: 'PathPrefix', path: '/' },
    ...overrides,
  };
}

const sharedGateway: KubeJson = {
  apiVersion: V1,
  kind: 'Gateway',
  metadata: { name: 'eg', namespace: 'infra' },
  spec: {
    gatewayClassName: 'eg',
    listeners: [
      { name: 'http', protocol: 'HTTP', port: 80, allowedRoutes: { namespaces: { from: 'All' } } },
      { name: 'internal', protocol: 'HTTP', port: 8080 },
    ],
  },
  status: { addresses: [{ type: 'IPAddress', value: '203.0.113.10' }] },
};

function kinds(resources: KubeJson[]): string[] {
  return resources.map(r => `${r.kind}:${r.metadata?.namespace}/${r.metadata?.name}`);
}

describe('validateExposeDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateExposeDraft(draft())).toEqual([]);
  });

  it('asks for everything that is missing in a new draft', () => {
    expect(validateExposeDraft(newExposeDraft('apps')).map(i => i.path)).toEqual([
      'service.name',
      'service.port',
      'existing.name',
      'route.name',
    ]);
  });

  it('validates the new Gateway only when one is created', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: { name: '', namespace: 'infra', gatewayClassName: '', protocol: 'HTTPS', port: 0 },
    });
    expect(validateExposeDraft(creating).map(i => i.path)).toEqual([
      'create.name',
      'create.gatewayClassName',
      'create.port',
      'create.certificateName',
    ]);
  });

  it('validates hostnames and the path', () => {
    const invalid = draft({
      route: {
        name: 'web',
        namespace: 'apps',
        hostnames: ['Bad Host', 'a.example.com', 'a.example.com'],
        pathType: 'PathPrefix',
        path: 'api',
      },
    });
    expect(validateExposeDraft(invalid).map(i => i.path)).toEqual([
      'route.hostnames.0',
      'route.hostnames.2',
      'route.path',
    ]);
  });
});

describe('buildExposePlan', () => {
  it('creates only an HTTPRoute for a Service next to its route on an existing Gateway', () => {
    const plan = buildExposePlan(draft(), { ...context, existingGateway: sharedGateway });
    expect(kinds(plan.resources)).toEqual(['HTTPRoute:apps/web']);
    expect(plan.warnings).toEqual([]);
    expect(plan.resources[0].spec).toEqual({
      parentRefs: [{ name: 'eg', namespace: 'infra' }],
      rules: [
        {
          matches: [{ path: { type: 'PathPrefix', value: '/' } }],
          backendRefs: [{ name: 'web', port: 8080 }],
        },
      ],
    });
  });

  it('generates resources that pass validation', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: {
        name: 'edge',
        namespace: 'infra',
        gatewayClassName: 'eg',
        protocol: 'HTTPS',
        port: 443,
        hostname: '*.example.com',
        certificateName: 'wildcard',
        certificateNamespace: 'certs',
      },
      service: { namespace: 'backends', name: 'api', port: 80 },
      route: {
        name: 'api',
        namespace: 'apps',
        hostnames: ['api.example.com'],
        pathType: 'PathPrefix',
        path: '/v1',
      },
    });
    const plan = buildExposePlan(creating, context);
    for (const resource of plan.resources) {
      expect(errorsOnly(validateResource(resource))).toEqual([]);
    }
  });

  it('warns when the chosen listener does not allow the namespace of the route', () => {
    const plan = buildExposePlan(
      draft({ existing: { name: 'eg', namespace: 'infra', sectionName: 'internal' } }),
      {
        ...context,
        existingGateway: sharedGateway,
      }
    );
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/will not accept this route/);
    expect(plan.warnings[0]).toMatch(/Only routes in namespace "infra"/);
    expect((plan.resources[0].spec as { parentRefs: unknown[] }).parentRefs).toEqual([
      { name: 'eg', namespace: 'infra', sectionName: 'internal' },
    ]);
  });

  it('notes when the existing Gateway could not be inspected', () => {
    const plan = buildExposePlan(draft(), context);
    expect(plan.warnings).toEqual([]);
    expect(plan.notes[0]).toMatch(/could not be inspected/);
  });

  it('adds a ReferenceGrant when the Service is in another namespace', () => {
    const cross = draft({ service: { namespace: 'backends', name: 'api', port: 80 } });
    const plan = buildExposePlan(cross, { ...context, existingGateway: sharedGateway });
    expect(kinds(plan.resources)).toEqual([
      'ReferenceGrant:backends/web-httproute-api',
      'HTTPRoute:apps/web',
    ]);
    expect(plan.resources[0].spec).toEqual({
      from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'apps' }],
      to: [{ group: '', kind: 'Service', name: 'api' }],
    });
    const backendRefs = (plan.resources[1].spec as { rules: Array<{ backendRefs: unknown[] }> })
      .rules[0].backendRefs;
    expect(backendRefs).toEqual([{ name: 'api', namespace: 'backends', port: 80 }]);
  });

  it('reuses an existing ReferenceGrant instead of creating another', () => {
    const cross = draft({ service: { namespace: 'backends', name: 'api', port: 80 } });
    const grant: KubeJson = {
      metadata: { name: 'apps-may-use-services', namespace: 'backends' },
      spec: {
        from: [{ group: GATEWAY_GROUP, kind: 'HTTPRoute', namespace: 'apps' }],
        to: [{ group: '', kind: 'Service' }],
      },
    };
    const plan = buildExposePlan(cross, {
      ...context,
      existingGateway: sharedGateway,
      grants: [grant],
    });
    expect(kinds(plan.resources)).toEqual(['HTTPRoute:apps/web']);
    expect(plan.notes.join(' ')).toMatch(
      /already permitted by ReferenceGrant "apps-may-use-services"/
    );
  });

  it('warns when a grant is needed but ReferenceGrant is not installed', () => {
    const cross = draft({ service: { namespace: 'backends', name: 'api', port: 80 } });
    const plan = buildExposePlan(cross, {
      ...context,
      existingGateway: sharedGateway,
      referenceGrantAvailable: false,
    });
    expect(kinds(plan.resources)).toEqual(['HTTPRoute:apps/web']);
    expect(plan.warnings[0]).toMatch(/ReferenceGrant kind is not installed/);
  });

  it('creates a Gateway in the same namespace that admits only that namespace', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: {
        name: 'web',
        namespace: 'apps',
        gatewayClassName: 'eg',
        protocol: 'HTTP',
        port: 80,
      },
    });
    const plan = buildExposePlan(creating, context);
    expect(kinds(plan.resources)).toEqual(['Gateway:apps/web', 'HTTPRoute:apps/web']);
    expect(plan.resources[0].spec).toEqual({
      gatewayClassName: 'eg',
      listeners: [
        {
          name: 'http',
          protocol: 'HTTP',
          port: 80,
          allowedRoutes: { namespaces: { from: 'Same' } },
        },
      ],
    });
    // Same namespace: no namespace in the parentRef.
    expect((plan.resources[1].spec as { parentRefs: unknown[] }).parentRefs).toEqual([
      { name: 'web' },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it('admits just the route namespace when the new Gateway lives elsewhere', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: {
        name: 'edge',
        namespace: 'infra',
        gatewayClassName: 'eg',
        protocol: 'HTTP',
        port: 80,
      },
    });
    const plan = buildExposePlan(creating, {
      ...context,
      namespaceLabels: { apps: { 'kubernetes.io/metadata.name': 'apps' }, infra: {} },
    });
    const listener = (plan.resources[0].spec as { listeners: Array<Record<string, unknown>> })
      .listeners[0];
    expect(listener.allowedRoutes).toEqual({
      namespaces: {
        from: 'Selector',
        selector: { matchLabels: { 'kubernetes.io/metadata.name': 'apps' } },
      },
    });
    // The generated route attaches to the generated listener.
    expect(plan.warnings).toEqual([]);
  });

  it('adds TLS and a grant for a certificate in another namespace', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: {
        name: 'edge',
        namespace: 'infra',
        gatewayClassName: 'eg',
        protocol: 'HTTPS',
        port: 443,
        certificateName: 'wildcard',
        certificateNamespace: 'certs',
      },
    });
    const plan = buildExposePlan(creating, context);
    expect(kinds(plan.resources)).toEqual([
      'Gateway:infra/edge',
      'ReferenceGrant:certs/edge-gateway-wildcard',
      'HTTPRoute:apps/web',
    ]);
    const listener = (plan.resources[0].spec as { listeners: Array<Record<string, unknown>> })
      .listeners[0];
    expect(listener.tls).toEqual({
      mode: 'Terminate',
      certificateRefs: [{ name: 'wildcard', namespace: 'certs' }],
    });
    expect(plan.resources[1].spec).toEqual({
      from: [{ group: GATEWAY_GROUP, kind: 'Gateway', namespace: 'infra' }],
      to: [{ group: '', kind: 'Secret', name: 'wildcard' }],
    });
  });

  it('warns when the selected listener does not serve HTTP', () => {
    const tcpGateway: KubeJson = {
      ...sharedGateway,
      spec: {
        gatewayClassName: 'eg',
        listeners: [
          {
            name: 'tcp',
            protocol: 'TCP',
            port: 9000,
            allowedRoutes: { namespaces: { from: 'All' } },
          },
        ],
      },
    };
    const plan = buildExposePlan(draft(), { ...context, existingGateway: tcpGateway });
    expect(plan.warnings.join(' ')).toMatch(/does not serve HTTP/);
  });
});

describe('exposedUrls', () => {
  it('uses the route hostnames, the listener hostname or the Gateway address', () => {
    expect(exposedUrls(draft(), sharedGateway)).toEqual([
      'http://203.0.113.10/',
      'http://203.0.113.10:8080/',
    ]);
    const withHost = draft({
      route: {
        name: 'web',
        namespace: 'apps',
        hostnames: ['app.example.com'],
        pathType: 'PathPrefix',
        path: '/api',
      },
      existing: { name: 'eg', namespace: 'infra', sectionName: 'http' },
    });
    expect(exposedUrls(withHost, sharedGateway)).toEqual(['http://app.example.com/api']);
  });

  it('describes a new HTTPS Gateway', () => {
    const creating = draft({
      gatewayMode: 'new',
      create: {
        name: 'edge',
        namespace: 'infra',
        gatewayClassName: 'eg',
        protocol: 'HTTPS',
        port: 8443,
        hostname: 'shop.example.com',
      },
    });
    expect(exposedUrls(creating)).toEqual(['https://shop.example.com:8443/']);
    creating.create.hostname = undefined;
    creating.create.port = 443;
    expect(exposedUrls(creating)).toEqual(['https://<gateway-address>/']);
  });
});

describe('followService', () => {
  it('names the route after the Service until the route has its own name', () => {
    const before = newExposeDraft('apps');
    const named = followService(before, { ...before, service: { ...before.service, name: 'web' } });
    expect(named.route.name).toBe('web');
    const renamed = followService(named, { ...named, service: { ...named.service, name: 'api' } });
    expect(renamed.route.name).toBe('api');
    const custom = { ...renamed, route: { ...renamed.route, name: 'public-api' } };
    const again = followService(custom, { ...custom, service: { ...custom.service, name: 'x' } });
    expect(again.route.name).toBe('public-api');
  });

  it('moves the namespaces along with the Service', () => {
    const before = newExposeDraft('apps');
    const moved = followService(before, {
      ...before,
      service: { ...before.service, namespace: 'shop' },
    });
    expect(moved.route.namespace).toBe('shop');
    expect(moved.create.namespace).toBe('shop');
    expect(moved.existing.namespace).toBe('shop');

    // A chosen Gateway keeps its namespace.
    const chosen = { ...moved, existing: { name: 'eg', namespace: 'infra' } };
    const movedAgain = followService(chosen, {
      ...chosen,
      service: { ...chosen.service, namespace: 'other' },
    });
    expect(movedAgain.existing).toEqual({ name: 'eg', namespace: 'infra' });
    expect(movedAgain.route.namespace).toBe('other');
  });
});
