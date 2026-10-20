import { describe, expect, it } from 'vitest';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import { parseApiError, resourcePath, writeQuery, writeTarget } from './apiPaths';
import {
  grantGroupFor,
  newFilter,
  newHTTPRule,
  newListener,
  withFilterType,
  withPathModifierType,
  withProtocol,
  withTLSMode,
} from './drafts';
import { setIn } from './objects';
import { errorsOnly, HTTP_FILTER_TYPES, validateResource } from './validation';
import { parseYaml, toYaml } from './yaml';

const V1 = `${GATEWAY_GROUP}/v1`;

describe('resourcePath', () => {
  it('builds collection and item paths', () => {
    expect(resourcePath({ apiVersion: V1, plural: 'gateways', namespace: 'infra' })).toBe(
      '/apis/gateway.networking.k8s.io/v1/namespaces/infra/gateways'
    );
    expect(
      resourcePath({ apiVersion: V1, plural: 'gateways', namespace: 'infra', name: 'eg' })
    ).toBe('/apis/gateway.networking.k8s.io/v1/namespaces/infra/gateways/eg');
    expect(resourcePath({ apiVersion: V1, plural: 'gatewayclasses', name: 'eg' })).toBe(
      '/apis/gateway.networking.k8s.io/v1/gatewayclasses/eg'
    );
    expect(resourcePath({ apiVersion: 'v1', plural: 'services', namespace: 'a' })).toBe(
      '/api/v1/namespaces/a/services'
    );
  });
});

describe('writeTarget', () => {
  const route: KubeJson = {
    apiVersion: V1,
    kind: 'HTTPRoute',
    metadata: { name: 'web', namespace: 'apps' },
  };

  it('POSTs to the collection on create and PUTs to the object on update', () => {
    expect(writeTarget(route, 'create')).toMatchObject({
      method: 'POST',
      path: '/apis/gateway.networking.k8s.io/v1/namespaces/apps/httproutes',
    });
    expect(writeTarget(route, 'update')).toMatchObject({
      method: 'PUT',
      path: '/apis/gateway.networking.k8s.io/v1/namespaces/apps/httproutes/web',
    });
  });

  it('uses the apiVersion of the object, so older served versions keep working', () => {
    const tcp = {
      apiVersion: `${GATEWAY_GROUP}/v1alpha2`,
      kind: 'TCPRoute',
      metadata: route.metadata,
    };
    expect(writeTarget(tcp, 'create').path).toBe(
      '/apis/gateway.networking.k8s.io/v1alpha2/namespaces/apps/tcproutes'
    );
    const cls = { apiVersion: V1, kind: 'GatewayClass', metadata: { name: 'eg' } };
    expect(writeTarget(cls, 'update').path).toBe(
      '/apis/gateway.networking.k8s.io/v1/gatewayclasses/eg'
    );
    // Kinds this plugin does not manage (such as the experimental ones) are refused.
    expect(() =>
      writeTarget(
        {
          apiVersion: 'gateway.networking.x-k8s.io/v1alpha1',
          kind: 'XMesh',
          metadata: { name: 'm' },
        },
        'update'
      )
    ).toThrow(/not a Gateway API kind/);
  });

  it('rejects objects it cannot write, with a helpful message', () => {
    expect(() => writeTarget({ kind: 'Gateway' }, 'create')).toThrow(/apiVersion and a kind/);
    expect(() =>
      writeTarget({ apiVersion: 'v1', kind: 'Service', metadata: {} }, 'create')
    ).toThrow(/not a Gateway API kind/);
    // Right kind, wrong group.
    expect(() =>
      writeTarget(
        { apiVersion: 'example.com/v1', kind: 'Gateway', metadata: { name: 'a' } },
        'create'
      )
    ).toThrow(/not a Gateway API kind/);
    expect(() => writeTarget({ ...route, metadata: { namespace: 'apps' } }, 'create')).toThrow(
      /metadata.name/
    );
    expect(() => writeTarget({ ...route, metadata: { name: 'web' } }, 'create')).toThrow(
      /metadata.namespace/
    );
    expect(() =>
      writeTarget(
        { apiVersion: V1, kind: 'GatewayClass', metadata: { name: 'eg', namespace: 'x' } },
        'create'
      )
    ).toThrow(/cluster-scoped/);
  });

  it('asks for strict field validation and optionally a dry-run', () => {
    expect(writeQuery(false)).toBe('?fieldValidation=Strict');
    expect(writeQuery(true)).toBe('?fieldValidation=Strict&dryRun=All');
  });
});

describe('parseApiError', () => {
  it('splits a validation failure into one cause per field', () => {
    const failure = parseApiError({
      status: 422,
      message:
        'Unprocessable Entity - HTTPRoute.gateway.networking.k8s.io "web" is invalid: [spec.rules[0].backendRefs[0].port: Required value, spec.hostnames[0]: Invalid value: "Bad Host": spec.hostnames[0] in body should match \'^(\\*\\.)?[a-z0-9]\', <nil>: Invalid value: "null": some validation rules were not checked]',
    });
    expect(failure.summary).toBe('HTTPRoute.gateway.networking.k8s.io "web" is invalid');
    expect(failure.status).toBe(422);
    expect(failure.causes.map(c => c.field)).toEqual([
      'spec.rules[0].backendRefs[0].port',
      'spec.hostnames[0]',
      undefined,
    ]);
    expect(failure.causes[0].message).toBe('Required value');
    expect(failure.causes[1].message).toContain('Invalid value: "Bad Host"');
  });

  it('handles a single cause without brackets', () => {
    const failure = parseApiError({
      status: 422,
      message:
        'Gateway.gateway.networking.k8s.io "eg" is invalid: spec.listeners: Invalid value: "array": Listener name must be unique within the Gateway',
    });
    expect(failure.causes).toEqual([
      {
        field: 'spec.listeners',
        message: 'Invalid value: "array": Listener name must be unique within the Gateway',
      },
    ]);
  });

  it('does not split on commas inside a message', () => {
    const failure = parseApiError({
      status: 422,
      message:
        'X "a" is invalid: [spec.a: Invalid value: "x": must be one of A, B, C, spec.b: Required value]',
    });
    expect(failure.causes).toHaveLength(2);
    expect(failure.causes[0].message).toBe('Invalid value: "x": must be one of A, B, C');
  });

  it('explains strict decoding errors (typos in field names)', () => {
    const failure = parseApiError({
      status: 400,
      message:
        'Bad Request - HTTPRoute in version "v1" cannot be handled as a HTTPRoute: strict decoding error: unknown field "spec.hostname", unknown field "spec.rules[0].backendRef"',
    });
    expect(failure.summary).toMatch(/fields the API does not know/);
    expect(failure.causes.map(c => c.message)).toEqual([
      'unknown field "spec.hostname"',
      'unknown field "spec.rules[0].backendRef"',
    ]);
  });

  it('explains conflicts and permission errors', () => {
    expect(
      parseApiError({ status: 409, message: 'Conflict - gateways "eg" already exists' }).summary
    ).toBe('gateways "eg" already exists');
    expect(
      parseApiError({
        status: 409,
        message:
          'Conflict - the object has been modified; please apply your changes to the latest version',
      }).summary
    ).toMatch(/Reload the resource/);
    const forbidden = parseApiError({
      status: 403,
      message:
        'Forbidden - httproutes.gateway.networking.k8s.io is forbidden: User "x" cannot create',
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.summary).toContain('forbidden');
  });

  it('passes through anything else', () => {
    expect(parseApiError(new Error('network down')).summary).toBe('network down');
    expect(parseApiError('plain text').summary).toBe('plain text');
    expect(parseApiError(undefined).summary).toBe('The request failed.');
  });
});

describe('listener drafts', () => {
  const http = { name: 'http', protocol: 'HTTP', port: 80, hostname: 'a.example.com' };

  it('adds TLS and follows the default port and name when switching to HTTPS', () => {
    expect(withProtocol(http, 'HTTPS')).toEqual({
      name: 'https',
      protocol: 'HTTPS',
      port: 443,
      hostname: 'a.example.com',
      tls: { mode: 'Terminate', certificateRefs: [{ name: '' }] },
    });
  });

  it('keeps a custom port and name', () => {
    const custom = { name: 'public', protocol: 'HTTP', port: 8080 };
    expect(withProtocol(custom, 'HTTPS')).toMatchObject({ name: 'public', port: 8080 });
  });

  it('honours the previous protocol when the listener already carries the new one', () => {
    // The select field writes the protocol first, then asks for the adjustments.
    const alreadySwitched = { ...http, protocol: 'HTTPS' };
    expect(withProtocol(alreadySwitched, 'HTTPS', { previousProtocol: 'HTTP' })).toMatchObject({
      port: 443,
      name: 'https',
    });
  });

  it('avoids name clashes with sibling listeners', () => {
    expect(withProtocol(http, 'HTTPS', { siblingNames: ['http', 'https'] }).name).toBe('https-2');
  });

  it('removes TLS and hostname where the protocol does not allow them', () => {
    const https = withProtocol(http, 'HTTPS');
    expect(withProtocol(https, 'HTTP').tls).toBeUndefined();
    const tcp = withProtocol(https, 'TCP');
    expect(tcp.tls).toBeUndefined();
    expect(tcp.hostname).toBeUndefined();
    expect(tcp.port).toBe(9000);
  });

  it('defaults TLS listeners to passthrough, but keeps existing termination settings', () => {
    expect(withProtocol(http, 'TLS').tls).toEqual({ mode: 'Passthrough' });
    // Coming from HTTPS the listener already terminates TLS with a certificate: keep that.
    expect(withProtocol(withProtocol(http, 'HTTPS'), 'TLS').tls).toEqual({
      mode: 'Terminate',
      certificateRefs: [{ name: '' }],
    });
  });

  it('leaves implementation specific protocols alone', () => {
    expect(withProtocol(http, 'example.com/custom')).toEqual({
      ...http,
      protocol: 'example.com/custom',
    });
  });

  it('switches the TLS mode', () => {
    expect(
      withTLSMode({ mode: 'Terminate', certificateRefs: [{ name: 'c' }] }, 'Passthrough')
    ).toEqual({ mode: 'Passthrough' });
    expect(withTLSMode({ mode: 'Passthrough' }, 'Terminate')).toEqual({
      mode: 'Terminate',
      certificateRefs: [{ name: '' }],
    });
  });

  it('proposes a listener that does not clash', () => {
    expect(newListener([])).toEqual({ name: 'http', protocol: 'HTTP', port: 80 });
    expect(newListener([http])).toMatchObject({ name: 'https', protocol: 'HTTPS', port: 443 });
    const both = [http, { name: 'https', protocol: 'HTTPS', port: 443 }];
    expect(newListener(both)).toEqual({ name: 'http-2', protocol: 'HTTP', port: 8080 });
  });

  it('produces listeners that pass validation once a certificate is chosen', () => {
    const gateway: KubeJson = {
      apiVersion: V1,
      kind: 'Gateway',
      metadata: { name: 'eg', namespace: 'default' },
      spec: { gatewayClassName: 'eg', listeners: [http, newListener([http])] },
    };
    expect(errorsOnly(validateResource(gateway)).map(i => i.path)).toEqual([
      'spec.listeners.1.tls.certificateRefs.0.name',
    ]);
    const done = setIn(gateway, 'spec.listeners.1.tls.certificateRefs.0.name', 'cert');
    expect(errorsOnly(validateResource(done))).toEqual([]);
  });
});

describe('filter drafts', () => {
  it('creates a filter of every type with only its own configuration field', () => {
    for (const type of HTTP_FILTER_TYPES) {
      const filter = newFilter(type);
      expect(filter.type).toBe(type);
      expect(Object.keys(filter)).toHaveLength(2);
    }
  });

  it('replaces the configuration when the type changes', () => {
    const redirect = newFilter('RequestRedirect');
    const rewrite = withFilterType(redirect, 'URLRewrite');
    expect(rewrite.requestRedirect).toBeUndefined();
    expect(rewrite.urlRewrite).toBeDefined();
    // Type already written by the select field, configuration still of the old type.
    const half = { ...redirect, type: 'CORS' };
    expect(withFilterType(half, 'CORS')).toEqual(newFilter('CORS'));
    // Nothing to do when type and configuration already agree.
    expect(withFilterType(redirect, 'RequestRedirect')).toBe(redirect);
  });

  it('never leaves a filter that validation rejects for structural reasons', () => {
    const base: KubeJson = {
      apiVersion: V1,
      kind: 'HTTPRoute',
      metadata: { name: 'web', namespace: 'default' },
      spec: { parentRefs: [{ name: 'eg' }], rules: [{}] },
    };
    for (const type of ['RequestRedirect', 'URLRewrite', 'CORS']) {
      const route = setIn(base, 'spec.rules.0.filters', [newFilter(type)]);
      expect(errorsOnly(validateResource(route))).toEqual([]);
    }
  });

  it('switches a path modifier type, keeping the replacement text', () => {
    expect(
      withPathModifierType(
        { type: 'ReplaceFullPath', replaceFullPath: '/new' },
        'ReplacePrefixMatch'
      )
    ).toEqual({ type: 'ReplacePrefixMatch', replacePrefixMatch: '/new' });
    expect(withPathModifierType(undefined, 'ReplaceFullPath')).toEqual({
      type: 'ReplaceFullPath',
      replaceFullPath: '/',
    });
    expect(withPathModifierType({ type: 'ReplaceFullPath' }, '')).toBeUndefined();
  });
});

describe('other drafts', () => {
  it('creates a rule that is valid apart from the backend name', () => {
    const route: KubeJson = {
      apiVersion: V1,
      kind: 'HTTPRoute',
      metadata: { name: 'web', namespace: 'default' },
      spec: { parentRefs: [{ name: 'eg' }], rules: [newHTTPRule()] },
    };
    expect(errorsOnly(validateResource(route)).map(i => i.path)).toEqual([
      'spec.rules.0.backendRefs.0.name',
    ]);
  });

  it('knows the API group of well-known ReferenceGrant kinds', () => {
    expect(grantGroupFor('HTTPRoute', 'from')).toBe(GATEWAY_GROUP);
    expect(grantGroupFor('Service', 'to')).toBe('');
    expect(grantGroupFor('Custom', 'to')).toBeUndefined();
  });
});

describe('form and YAML stay in sync through a whole editing session', () => {
  it('applies form edits, a YAML edit and more form edits without losing anything', () => {
    // 1. Start from the template and fill the form.
    let value: KubeJson = {
      apiVersion: V1,
      kind: 'Gateway',
      metadata: { name: '', namespace: 'default' },
      spec: { gatewayClassName: '', listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }] },
    };
    value = setIn(value, 'metadata.name', 'eg');
    value = setIn(value, 'spec.gatewayClassName', 'eg');
    let text = toYaml(value);

    // 2. Switch to YAML and add a field the form has no input for, plus a comment.
    text = text.replace('spec:', '# edge gateway\nspec:\n  customVendorField: keep-me');
    const parsed = parseYaml(text);
    expect(parsed.error).toBeUndefined();
    value = parsed.value!;

    // 3. Back in the form: switch the listener to HTTPS.
    value = setIn(
      value,
      'spec.listeners.0',
      withProtocol(
        parsed.value!.spec!.listeners ? (parsed.value!.spec!.listeners as unknown[])[0] : {},
        'HTTPS'
      )
    );
    value = setIn(value, 'spec.listeners.0.tls.certificateRefs.0.name', 'wildcard');
    text = toYaml(value);

    // The YAML-only field survived the form edits, and the result is valid.
    const final = parseYaml(text).value!;
    expect((final.spec as Record<string, unknown>).customVendorField).toBe('keep-me');
    expect(final.metadata).toEqual({ name: 'eg', namespace: 'default' });
    expect((final.spec as { listeners: unknown[] }).listeners).toEqual([
      {
        name: 'https',
        protocol: 'HTTPS',
        port: 443,
        tls: { mode: 'Terminate', certificateRefs: [{ name: 'wildcard' }] },
      },
    ]);
    expect(errorsOnly(validateResource(final))).toEqual([]);
  });

  it('keeps the last valid object while the YAML is broken', () => {
    const value: KubeJson = { apiVersion: V1, kind: 'Gateway', metadata: { name: 'eg' } };
    const broken = parseYaml(`${toYaml(value)}spec: [unclosed`);
    expect(broken.value).toBeUndefined();
    expect(broken.error).toBeTruthy();
    // The editor keeps `value`; a later form edit regenerates valid YAML from it.
    expect(parseYaml(toYaml(setIn(value, 'metadata.name', 'eg2'))).value).toEqual({
      ...value,
      metadata: { name: 'eg2' },
    });
  });
});
