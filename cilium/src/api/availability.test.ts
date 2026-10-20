import { describe, expect, it } from 'vitest';
import { buildAvailability, toCRDMeta, versionDeprecation } from './availability';

describe('buildAvailability', () => {
  const availability = buildAvailability(['cilium.io/v2', 'cilium.io/v2alpha1'], {
    'cilium.io/v2': [
      {
        name: 'ciliumnetworkpolicies',
        kind: 'CiliumNetworkPolicy',
        namespaced: true,
        verbs: ['get', 'list'],
      },
      { name: 'ciliumnetworkpolicies/status', kind: 'CiliumNetworkPolicy', namespaced: true },
      { name: 'ciliumbgpclusterconfigs', kind: 'CiliumBGPClusterConfig', namespaced: false },
    ],
    'cilium.io/v2alpha1': [
      { name: 'ciliumbgpclusterconfigs', kind: 'CiliumBGPClusterConfig', namespaced: false },
      {
        name: 'ciliuml2announcementpolicies',
        kind: 'CiliumL2AnnouncementPolicy',
        namespaced: false,
      },
    ],
  });

  it('prefers the highest priority version that serves a resource', () => {
    expect(availability.groupInstalled).toBe(true);
    expect(availability.versions).toEqual({
      ciliumnetworkpolicies: 'cilium.io/v2',
      ciliumbgpclusterconfigs: 'cilium.io/v2',
      ciliuml2announcementpolicies: 'cilium.io/v2alpha1',
    });
  });

  it('records every serving version and skips subresources', () => {
    expect(availability.resources.ciliumbgpclusterconfigs.versions).toEqual([
      'cilium.io/v2',
      'cilium.io/v2alpha1',
    ]);
    expect(availability.resources['ciliumnetworkpolicies/status']).toBeUndefined();
    expect(availability.resources.ciliumnetworkpolicies).toMatchObject({
      kind: 'CiliumNetworkPolicy',
      namespaced: true,
      verbs: ['get', 'list'],
    });
  });

  it('handles versions without resources', () => {
    expect(buildAvailability(['cilium.io/v2'], {}).versions).toEqual({});
  });
});

describe('CRD metadata', () => {
  const meta = toCRDMeta({
    metadata: {
      name: 'ciliumbgppeeringpolicies.cilium.io',
      labels: { 'io.cilium.k8s.crd.schema.version': '1.32.1' },
    },
    spec: {
      group: 'cilium.io',
      scope: 'Cluster',
      names: { kind: 'CiliumBGPPeeringPolicy', plural: 'ciliumbgppeeringpolicies' },
      versions: [
        {
          name: 'v2alpha1',
          served: true,
          storage: true,
          deprecated: true,
          deprecationWarning: 'use v2 BGP APIs',
        },
        { name: 'v2', served: true },
      ],
    },
  });

  it('extracts versions, storage and schema version', () => {
    expect(meta).toMatchObject({
      plural: 'ciliumbgppeeringpolicies',
      scope: 'Cluster',
      schemaVersion: '1.32.1',
    });
    expect(meta.versions[0]).toEqual({
      name: 'v2alpha1',
      served: true,
      storage: true,
      deprecated: true,
      deprecationWarning: 'use v2 BGP APIs',
    });
  });

  it('reports the deprecation of the version in use only', () => {
    expect(versionDeprecation(meta, 'cilium.io/v2alpha1')).toBe('use v2 BGP APIs');
    expect(versionDeprecation(meta, 'cilium.io/v2')).toBeNull();
    expect(versionDeprecation(undefined, 'cilium.io/v2')).toBeNull();
  });
});
