import { describe, expect, it } from 'vitest';
import { GATEWAY_API_GROUP } from '../resources/types';
import {
  identityOf,
  labelsMatch,
  objectRefMatches,
  policyTargets,
  resolveTargetRefs,
  routeBackendRefs,
  routeExtensionRefs,
  routeParentGateways,
  sectionOptions,
} from './targets';

const gateway = identityOf({
  apiVersion: `${GATEWAY_API_GROUP}/v1`,
  kind: 'Gateway',
  metadata: { name: 'eg', namespace: 'infra', labels: { tier: 'edge' } },
});

describe('resolveTargetRefs', () => {
  it('merges the deprecated targetRef with targetRefs without duplicates', () => {
    const ref = { group: GATEWAY_API_GROUP, kind: 'Gateway', name: 'eg' };
    expect(resolveTargetRefs({ targetRef: ref, targetRefs: [ref] })).toHaveLength(1);
    expect(resolveTargetRefs({ targetRef: ref })).toEqual([ref]);
    expect(resolveTargetRefs(undefined)).toEqual([]);
  });
});

describe('policyTargets', () => {
  it('matches a targetRef in the policy namespace', () => {
    const policy = {
      metadata: { name: 'p', namespace: 'infra' },
      spec: {
        targetRefs: [
          { group: GATEWAY_API_GROUP, kind: 'Gateway', name: 'eg', sectionName: 'https' },
        ],
      },
    };
    expect(policyTargets(policy, gateway)).toEqual({ via: 'targetRef', sectionName: 'https' });
  });

  it('does not match a Gateway with the same name in another namespace', () => {
    const policy = {
      metadata: { name: 'p', namespace: 'apps' },
      spec: { targetRefs: [{ group: GATEWAY_API_GROUP, kind: 'Gateway', name: 'eg' }] },
    };
    expect(policyTargets(policy, gateway)).toBeNull();
  });

  it('matches target selectors by labels', () => {
    const policy = {
      metadata: { name: 'p', namespace: 'infra' },
      spec: { targetSelectors: [{ kind: 'Gateway', matchLabels: { tier: 'edge' } }] },
    };
    expect(policyTargets(policy, gateway)).toEqual({ via: 'targetSelector' });
  });
});

describe('labelsMatch', () => {
  it('supports match expressions', () => {
    const labels = { env: 'prod', team: 'a' };
    expect(labelsMatch(labels, undefined, [{ key: 'env', operator: 'In', values: ['prod'] }])).toBe(
      true
    );
    expect(
      labelsMatch(labels, undefined, [{ key: 'env', operator: 'NotIn', values: ['prod'] }])
    ).toBe(false);
    expect(labelsMatch(labels, undefined, [{ key: 'x', operator: 'DoesNotExist' }])).toBe(true);
    expect(labelsMatch(labels, {}, [])).toBe(true);
    expect(labelsMatch(labels, undefined, [])).toBe(false);
  });
});

describe('route helpers', () => {
  const route = {
    kind: 'HTTPRoute',
    metadata: { name: 'r', namespace: 'apps' },
    spec: {
      parentRefs: [
        { name: 'eg', namespace: 'infra' },
        { name: 'local' },
        { kind: 'Service', name: 'svc' },
      ],
      rules: [
        {
          backendRefs: [
            { group: 'gateway.envoyproxy.io', kind: 'Backend', name: 'ext', port: 443 },
          ],
          filters: [
            {
              type: 'ExtensionRef',
              extensionRef: { group: 'gateway.envoyproxy.io', kind: 'HTTPRouteFilter', name: 'f' },
            },
          ],
        },
      ],
    },
  };

  it('finds parent Gateways', () => {
    expect(routeParentGateways(route)).toEqual([
      { name: 'eg', namespace: 'infra' },
      { name: 'local', namespace: 'apps' },
    ]);
  });

  it('finds backend and extension references', () => {
    const backend = {
      group: 'gateway.envoyproxy.io',
      kind: 'Backend',
      name: 'ext',
      namespace: 'apps',
    };
    expect(routeBackendRefs(route).some(r => objectRefMatches(r, backend, 'apps'))).toBe(true);
    expect(routeExtensionRefs(route)).toHaveLength(1);
  });

  it('defaults backendRefs to core Services', () => {
    const svc = { group: '', kind: 'Service', name: 'web', namespace: 'apps' };
    expect(objectRefMatches({ name: 'web' }, svc, 'apps', { kind: 'Service', group: '' })).toBe(
      true
    );
    expect(objectRefMatches({ name: 'web' }, svc, 'other', { kind: 'Service', group: '' })).toBe(
      false
    );
  });
});

describe('sectionOptions', () => {
  it('lists Gateway listeners with protocol, port and hostname', () => {
    expect(
      sectionOptions({
        kind: 'Gateway',
        spec: {
          listeners: [
            { name: 'http', protocol: 'HTTP', port: 80 },
            { name: 'https', protocol: 'HTTPS', port: 443, hostname: '*.example.com' },
          ],
        },
      })
    ).toEqual([
      { value: 'http', description: 'HTTP:80' },
      { value: 'https', description: 'HTTPS:443 · *.example.com' },
    ]);
  });

  it('lists only named route rules', () => {
    expect(
      sectionOptions({
        kind: 'HTTPRoute',
        spec: { rules: [{ name: 'api', matches: [{ path: { value: '/api' } }] }, { matches: [] }] },
      })
    ).toEqual([{ value: 'api', description: '/api' }]);
    expect(sectionOptions(undefined)).toEqual([]);
  });
});
