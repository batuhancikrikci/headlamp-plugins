import { describe, expect, it } from 'vitest';
import { newResource, TEMPLATE_KINDS } from './templates';

describe('newResource', () => {
  it('has a template for every plugin kind', () => {
    expect(TEMPLATE_KINDS.sort()).toEqual(
      [
        'AIGatewayRoute',
        'AIServiceBackend',
        'BackendSecurityPolicy',
        'GatewayConfig',
        'MCPRoute',
        'QuotaPolicy',
      ].sort()
    );
  });

  it('fills apiVersion, kind and namespace and returns fresh objects', () => {
    const a = newResource('QuotaPolicy', 'aigateway.envoyproxy.io/v1alpha1', 'ai');
    expect(a).toMatchObject({
      apiVersion: 'aigateway.envoyproxy.io/v1alpha1',
      kind: 'QuotaPolicy',
      metadata: { name: '', namespace: 'ai' },
    });
    const b = newResource('QuotaPolicy', 'x', 'ai');
    expect(b.spec).not.toBe(a.spec);
    expect(newResource('Unknown', 'v1').spec).toEqual({});
  });
});
