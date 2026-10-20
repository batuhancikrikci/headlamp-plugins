import { describe, expect, it } from 'vitest';
import { newResource } from './templates';
import { findInvalidDurations, isGeneralError, validateResource } from './validation';

const keys = (obj: Parameters<typeof validateResource>[0]) => validateResource(obj).map(e => e.key);

describe('validateResource', () => {
  it('requires metadata and targets for new policies', () => {
    const errors = validateResource(
      newResource('SecurityPolicy', 'gateway.envoyproxy.io/v1alpha1', '')
    );
    expect(errors.map(e => e.key)).toEqual(
      expect.arrayContaining([
        'Name is required',
        'Namespace is required',
        'Target #{{index}} needs a name',
      ])
    );
    expect(errors.every(isGeneralError)).toBe(true);
  });

  it('accepts a complete BackendTrafficPolicy', () => {
    expect(
      keys({
        kind: 'BackendTrafficPolicy',
        metadata: { name: 'btp', namespace: 'default' },
        spec: {
          targetRefs: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', name: 'web' }],
          timeout: { http: { requestTimeout: '10s' } },
        },
      })
    ).toEqual([]);
  });

  it('reports invalid durations with their path', () => {
    expect(findInvalidDurations({ timeout: { http: { requestTimeout: '10 seconds' } } })).toEqual([
      'timeout.http.requestTimeout',
    ]);
  });

  it('checks kind specific rules', () => {
    expect(
      keys({
        kind: 'SecurityPolicy',
        metadata: { name: 'sp', namespace: 'default' },
        spec: {
          targetRefs: [{ group: 'gateway.networking.k8s.io', kind: 'Gateway', name: 'eg' }],
          oidc: { provider: { issuer: 'https://idp' }, clientID: 'c' },
        },
      })
    ).toEqual(['OIDC needs a client secret']);

    expect(
      keys({
        kind: 'Backend',
        metadata: { name: 'b', namespace: 'default' },
        spec: { endpoints: [{ fqdn: { hostname: '', port: 443 } }] },
      })
    ).toEqual(['Endpoint #{{index}} needs a hostname and port']);

    expect(
      keys({
        kind: 'BackendTrafficPolicy',
        metadata: { name: 'b', namespace: 'default' },
        spec: {
          targetRefs: [{ group: 'gateway.networking.k8s.io', kind: 'Gateway', name: 'eg' }],
          loadBalancer: {
            type: 'ConsistentHash',
            consistentHash: { type: 'Cookie' },
            slowStart: { window: '10s' },
          },
        },
      })
    ).toEqual([
      'Consistent hash by cookie needs a cookie name',
      'Slow start is only supported with RoundRobin and LeastRequest',
    ]);
  });
});
