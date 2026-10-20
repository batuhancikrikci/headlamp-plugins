import { describe, expect, it } from 'vitest';
import { activeBTPPresets, newResource, toggleBTPPreset } from './templates';
import { validateResource } from './validation';

describe('newResource', () => {
  it('builds objects with the served apiVersion', () => {
    const obj = newResource('Backend', 'gateway.envoyproxy.io/v1alpha1', 'team-a');
    expect(obj).toMatchObject({
      apiVersion: 'gateway.envoyproxy.io/v1alpha1',
      kind: 'Backend',
      metadata: { namespace: 'team-a' },
    });
  });
});

describe('BTP presets', () => {
  const base = {
    targetRefs: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', name: 'web' }],
  };

  it('enables and disables a preset', () => {
    const on = toggleBTPPreset(base, 'resilience', true);
    expect(on.retry).toBeDefined();
    expect(on.circuitBreaker).toBeDefined();
    expect(activeBTPPresets(on)).toContain('resilience');
    const off = toggleBTPPreset(on, 'resilience', false);
    expect(off).toEqual(base);
  });

  it('produces valid policies for every preset', () => {
    for (const id of [
      'rateLimit',
      'resilience',
      'healthCheck',
      'stickySession',
      'slowStart',
      'faultInjection',
      'compression',
    ] as const) {
      const spec = toggleBTPPreset(base, id, true);
      const errors = validateResource({
        kind: 'BackendTrafficPolicy',
        metadata: { name: 'p', namespace: 'default' },
        spec,
      });
      expect({ id, errors }).toEqual({ id, errors: [] });
    }
  });

  it('distinguishes load balancer presets', () => {
    expect(activeBTPPresets(toggleBTPPreset(base, 'stickySession', true))).toEqual([
      'stickySession',
    ]);
    expect(activeBTPPresets(toggleBTPPreset(base, 'slowStart', true))).toEqual(['slowStart']);
  });
});
