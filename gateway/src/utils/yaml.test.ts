import { describe, expect, it } from 'vitest';
import { KINDS } from '../resources/registry';
import { GATEWAY_GROUP, KubeJson } from '../resources/types';
import { setIn } from './objects';
import { controllerLabel, ENVOY_GATEWAY_CONTROLLER, newResource } from './templates';
import { errorsOnly, validateResource } from './validation';
import { cleanForDisplay, cleanForEdit, parseYaml, toYaml } from './yaml';

const route: KubeJson = {
  apiVersion: `${GATEWAY_GROUP}/v1`,
  kind: 'HTTPRoute',
  metadata: { name: 'web', namespace: 'apps', labels: { app: 'web' } },
  spec: {
    parentRefs: [{ name: 'eg', namespace: 'infra', sectionName: 'https' }],
    hostnames: ['www.example.com'],
    rules: [
      {
        matches: [{ path: { type: 'PathPrefix', value: '/api' }, method: 'GET' }],
        filters: [
          {
            type: 'RequestHeaderModifier',
            requestHeaderModifier: { set: [{ name: 'x-env', value: 'prod' }] },
          },
        ],
        backendRefs: [
          { name: 'web', port: 8080, weight: 90 },
          { name: 'web-canary', port: 8080, weight: 10 },
        ],
      },
    ],
  },
};

describe('form <-> YAML conversion', () => {
  it('round-trips a resource without loss', () => {
    const parsed = parseYaml(toYaml(route));
    expect(parsed.error).toBeUndefined();
    expect(parsed.value).toEqual(route);
  });

  it('keeps key order stable, so repeated conversions do not reshuffle the YAML', () => {
    const once = toYaml(route);
    const twice = toYaml(parseYaml(once).value);
    expect(twice).toBe(once);
    expect(once.indexOf('apiVersion')).toBeLessThan(once.indexOf('kind'));
    expect(once.indexOf('parentRefs')).toBeLessThan(once.indexOf('rules'));
  });

  it('reflects a form edit in the YAML and a YAML edit in the form value', () => {
    // Form -> YAML
    const edited = setIn(route, 'spec.rules.0.backendRefs.0.port', 9090);
    expect(toYaml(edited)).toContain('port: 9090');

    // YAML -> form
    const text = toYaml(route).replace('www.example.com', 'shop.example.com');
    const parsed = parseYaml(text).value!;
    expect((parsed.spec as { hostnames: string[] }).hostnames).toEqual(['shop.example.com']);
    // Everything the form does not touch is preserved.
    expect(parsed.metadata).toEqual(route.metadata);
  });

  it('preserves fields the forms do not know about', () => {
    const text = `${toYaml(route)}extra:\n  vendor: field\n`;
    const parsed = parseYaml(text).value!;
    expect(parsed.extra).toEqual({ vendor: 'field' });
    const afterFormEdit = setIn(parsed, 'metadata.name', 'renamed');
    expect(parseYaml(toYaml(afterFormEdit)).value!.extra).toEqual({ vendor: 'field' });
  });

  it('drops undefined values instead of failing or writing nulls', () => {
    const text = toYaml({ kind: 'Gateway', spec: { hostname: undefined, port: 80 } });
    expect(text).toBe('kind: Gateway\nspec:\n  port: 80\n');
  });

  it('does not wrap long strings or emit anchors', () => {
    const shared = { name: 'x-long', value: 'v'.repeat(200) };
    const text = toYaml({ a: shared, b: shared });
    expect(text).not.toContain('&');
    expect(text).not.toContain('>-');
  });

  it('accepts JSON as well', () => {
    expect(parseYaml(JSON.stringify(route)).value).toEqual(route);
  });
});

describe('parseYaml errors', () => {
  it('reports syntax errors with a line number', () => {
    const result = parseYaml('kind: Gateway\nspec:\n  listeners: [\n');
    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();
    expect(result.line).toBeGreaterThan(0);
  });

  it('rejects empty documents, lists and multiple documents', () => {
    expect(parseYaml('').error).toMatch(/empty/);
    expect(parseYaml('# only a comment').error).toMatch(/empty/);
    expect(parseYaml('- a\n- b\n').error).toMatch(/single Kubernetes object/);
    expect(parseYaml('just text').error).toMatch(/single Kubernetes object/);
    expect(parseYaml('kind: A\n---\nkind: B\n').error).toMatch(/one resource/);
  });

  it('accepts a single document followed by an empty one', () => {
    expect(parseYaml('kind: A\n---\n').value).toEqual({ kind: 'A' });
  });
});

describe('cleaning live objects', () => {
  const live: KubeJson = {
    ...route,
    metadata: {
      ...route.metadata,
      uid: 'abc',
      resourceVersion: '42',
      generation: 3,
      creationTimestamp: '2026-01-01T00:00:00Z',
      managedFields: [{ manager: 'kubectl' }],
    },
    status: { parents: [] },
  };

  it('removes status and server-managed metadata but keeps resourceVersion for editing', () => {
    const cleaned = cleanForEdit(live);
    expect(cleaned.status).toBeUndefined();
    expect(cleaned.metadata).toEqual({ ...route.metadata, resourceVersion: '42' });
    expect(cleaned.spec).toEqual(route.spec);
    // The live object is not mutated.
    expect(live.metadata?.uid).toBe('abc');
  });

  it('removes resourceVersion as well for display', () => {
    expect(cleanForDisplay(live)).toEqual(route);
  });
});

describe('templates', () => {
  it('creates a template for every kind with the right scope', () => {
    for (const info of KINDS) {
      const resource = newResource(info.kind, `${info.group}/${info.knownVersions[0]}`, {
        namespace: 'team-a',
        namespaced: info.namespaced,
      });
      expect(resource.kind).toBe(info.kind);
      expect(resource.metadata?.namespace).toBe(info.namespaced ? 'team-a' : undefined);
      // Templates must survive the YAML round trip unchanged.
      expect(parseYaml(toYaml(resource)).value).toEqual(resource);
    }
  });

  it('only asks the user for the fields that cannot be defaulted', () => {
    const gateway = newResource('Gateway', `${GATEWAY_GROUP}/v1`, {
      namespaced: true,
      hints: { gatewayClassName: 'eg' },
    });
    expect(errorsOnly(validateResource(gateway)).map(i => i.path)).toEqual(['metadata.name']);

    const gatewayClass = newResource('GatewayClass', `${GATEWAY_GROUP}/v1`, { namespaced: false });
    expect(errorsOnly(validateResource(gatewayClass)).map(i => i.path)).toEqual(['metadata.name']);
    expect((gatewayClass.spec as { controllerName: string }).controllerName).toBe(
      ENVOY_GATEWAY_CONTROLLER
    );
  });

  it('pre-fills the parent, omitting the namespace when it is the same', () => {
    const same = newResource('HTTPRoute', `${GATEWAY_GROUP}/v1`, {
      namespace: 'infra',
      namespaced: true,
      hints: { parent: { name: 'eg', namespace: 'infra' } },
    });
    expect((same.spec as { parentRefs: unknown[] }).parentRefs).toEqual([{ name: 'eg' }]);

    const cross = newResource('HTTPRoute', `${GATEWAY_GROUP}/v1`, {
      namespace: 'apps',
      namespaced: true,
      hints: { parent: { name: 'eg', namespace: 'infra' } },
    });
    expect((cross.spec as { parentRefs: unknown[] }).parentRefs).toEqual([
      { name: 'eg', namespace: 'infra' },
    ]);
  });

  it('labels well-known controllers', () => {
    expect(controllerLabel(ENVOY_GATEWAY_CONTROLLER)).toBe('Envoy Gateway');
    expect(controllerLabel('example.com/unknown')).toBeUndefined();
  });
});
