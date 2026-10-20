import { describe, expect, it } from 'vitest';
import { capabilityState, CRDJson, schemaHasPath, versionDeprecation } from './capabilities';

const placementCRD = (withCel: boolean, withSortBy: boolean): CRDJson => ({
  metadata: { name: 'placements.cluster.open-cluster-management.io' },
  spec: {
    group: 'cluster.open-cluster-management.io',
    names: { kind: 'Placement', plural: 'placements' },
    versions: [
      {
        name: 'v1beta1',
        served: true,
        storage: true,
        schema: {
          openAPIV3Schema: {
            type: 'object',
            properties: {
              spec: {
                type: 'object',
                properties: {
                  ...(withSortBy ? { sortBy: { type: 'string' } } : {}),
                  predicates: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        requiredClusterSelector: {
                          type: 'object',
                          properties: {
                            labelSelector: { type: 'object' },
                            ...(withCel ? { celSelector: { type: 'object' } } : {}),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
});

describe('schemaHasPath', () => {
  it('traverses arrays transparently', () => {
    const schema = placementCRD(true, false).spec.versions![0].schema!.openAPIV3Schema;
    expect(
      schemaHasPath(schema, ['spec', 'predicates', 'requiredClusterSelector', 'celSelector'])
    ).toBe(true);
    expect(schemaHasPath(schema, ['spec', 'predicates', 'nope'])).toBe(false);
  });
});

describe('capabilityState', () => {
  it('is yes/no from the schema of the version in use (OCM v1.0 vs v0.16)', () => {
    const api = 'cluster.open-cluster-management.io/v1beta1';
    expect(capabilityState('placementCelSelector', placementCRD(true, false), api)).toBe('yes');
    expect(capabilityState('placementCelSelector', placementCRD(false, false), api)).toBe('no');
    expect(capabilityState('placementSortBy', placementCRD(true, false), api)).toBe('no');
    expect(capabilityState('placementSortBy', placementCRD(true, true), api)).toBe('yes');
  });

  it('is unknown when the CRD or the version cannot be read', () => {
    expect(capabilityState('placementSortBy', undefined, 'x/v1beta1')).toBe('unknown');
    expect(capabilityState('placementSortBy', placementCRD(true, true), 'x/v1')).toBe('unknown');
  });
});

describe('versionDeprecation', () => {
  it('returns the CRD deprecation warning of the version in use', () => {
    const crd: CRDJson = {
      metadata: { name: 'managedserviceaccounts.authentication.open-cluster-management.io' },
      spec: {
        group: 'authentication.open-cluster-management.io',
        names: { kind: 'ManagedServiceAccount', plural: 'managedserviceaccounts' },
        versions: [
          { name: 'v1alpha1', deprecated: true },
          { name: 'v1beta1', storage: true },
        ],
      },
    };
    expect(versionDeprecation(crd, 'authentication.open-cluster-management.io/v1alpha1')).toMatch(
      /deprecated/
    );
    expect(versionDeprecation(crd, 'authentication.open-cluster-management.io/v1beta1')).toBeNull();
  });
});
