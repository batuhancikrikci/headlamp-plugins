import { describe, expect, it } from 'vitest';
import { newResource } from './templates';
import { validateResource } from './validation';

describe('newResource', () => {
  it('adds a namespace only to namespaced kinds', () => {
    expect(newResource('CiliumNetworkPolicy', 'cilium.io/v2', 'shop').metadata).toEqual({
      name: '',
      namespace: 'shop',
    });
    expect(newResource('CiliumClusterwideNetworkPolicy', 'cilium.io/v2', 'shop').metadata).toEqual({
      name: '',
    });
    expect(newResource('CiliumLoadBalancerIPPool', 'cilium.io/v2').metadata).toEqual({ name: '' });
  });

  it('uses the given API version and returns independent objects', () => {
    const a = newResource('CiliumL2AnnouncementPolicy', 'cilium.io/v2alpha1');
    const b = newResource('CiliumL2AnnouncementPolicy', 'cilium.io/v2alpha1');
    expect(a.apiVersion).toBe('cilium.io/v2alpha1');
    a.spec.loadBalancerIPs = false;
    expect(b.spec.loadBalancerIPs).toBe(true);
  });

  it('starts from templates that only lack what the user has to provide', () => {
    // A named policy that selects everything is valid as created.
    const policy = newResource('CiliumNetworkPolicy', 'cilium.io/v2');
    policy.metadata.name = 'allow-nothing';
    expect(validateResource(policy)).toEqual([]);
    // The BGP peer config template is complete apart from its name.
    const peerConfig = newResource('CiliumBGPPeerConfig', 'cilium.io/v2');
    peerConfig.metadata.name = 'peers';
    expect(validateResource(peerConfig)).toEqual([]);
    // The pool template asks for a block.
    const pool = newResource('CiliumLoadBalancerIPPool', 'cilium.io/v2');
    pool.metadata.name = 'pool';
    expect(validateResource(pool).map(e => e.key)).toEqual([
      'Block #{{index}} needs either a CIDR or a start address',
    ]);
  });

  it('falls back to an empty spec for unknown kinds', () => {
    expect(newResource('CiliumSomethingNew', 'cilium.io/v2alpha1').spec).toEqual({});
  });
});
