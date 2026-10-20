import { describe, expect, it } from 'vitest';
import {
  buildCollectionPath,
  buildObjectPath,
  isOwnedBy,
  mergeIntoLive,
  OwnerReference,
  ownerReferenceTo,
  withOwnerReference,
} from './resourceModel';

describe('buildObjectPath', () => {
  it('builds paths for cluster-scoped, namespaced and core objects', () => {
    expect(buildObjectPath('example.com/v1', { name: 'widgets', namespaced: false }, 'w1')).toBe(
      '/apis/example.com/v1/widgets/w1'
    );
    expect(
      buildObjectPath('example.com/v1beta1', { name: 'gadgets', namespaced: true }, 'g', 'apps')
    ).toBe('/apis/example.com/v1beta1/namespaces/apps/gadgets/g');
    expect(buildObjectPath('v1', { name: 'namespaces', namespaced: false }, 'apps')).toBe(
      '/api/v1/namespaces/apps'
    );
  });
});

describe('mergeIntoLive', () => {
  it('keeps server-side metadata and merges labels while replacing the spec', () => {
    const live = {
      apiVersion: 'example.com/v1',
      kind: 'Widget',
      metadata: {
        name: 'w1',
        resourceVersion: '7',
        finalizers: ['example.com/cleanup'],
        labels: { 'example.com/managed': 'true', env: 'dev' },
        managedFields: [{}],
      },
      spec: { enabled: true, size: 60 },
      status: { conditions: [] },
    };
    const generated = {
      apiVersion: 'example.com/v1',
      kind: 'Widget',
      metadata: { name: 'w1', labels: { env: 'prod' } },
      spec: { enabled: true },
    };
    const out = mergeIntoLive(live, generated);
    expect(out.metadata).toEqual({
      name: 'w1',
      resourceVersion: '7',
      finalizers: ['example.com/cleanup'],
      labels: { 'example.com/managed': 'true', env: 'prod' },
    });
    expect(out.spec).toEqual({ enabled: true });
    expect(out).not.toHaveProperty('status');
  });
});

describe('owner references', () => {
  const owner = {
    apiVersion: 'gateway.envoyproxy.io/v1alpha1',
    kind: 'SecurityPolicy',
    metadata: { name: 'shop', namespace: 'apps', uid: 'u-1' },
  };
  const secret = (ownerReferences?: OwnerReference[]) => ({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: 's', namespace: 'apps', ownerReferences },
  });

  it('builds a garbage-collection-only reference', () => {
    expect(ownerReferenceTo(owner)).toEqual({
      apiVersion: 'gateway.envoyproxy.io/v1alpha1',
      kind: 'SecurityPolicy',
      name: 'shop',
      uid: 'u-1',
    });
    expect(() => ownerReferenceTo({ ...owner, metadata: { name: 'x' } })).toThrow();
  });

  it('adds the reference once and keeps other owners', () => {
    const other = { apiVersion: 'v1', kind: 'ConfigMap', name: 'c', uid: 'u-2' };
    const added = withOwnerReference(secret([other]), ownerReferenceTo(owner));
    expect(added.metadata.ownerReferences).toEqual([other, ownerReferenceTo(owner)]);
    expect(withOwnerReference(added, ownerReferenceTo(owner))).toBe(added);
  });

  it('tells whether an object belongs to an owner', () => {
    expect(isOwnedBy(secret([ownerReferenceTo(owner)]), 'u-1')).toBe(true);
    expect(isOwnedBy(secret(), 'u-1')).toBe(false);
    expect(isOwnedBy(secret([ownerReferenceTo(owner)]), undefined)).toBe(false);
    expect(isOwnedBy(undefined, 'u-1')).toBe(false);
  });

  it('builds collection paths', () => {
    expect(buildCollectionPath('v1', { name: 'secrets', namespaced: true }, 'apps')).toBe(
      '/api/v1/namespaces/apps/secrets'
    );
    expect(
      buildCollectionPath('example.com/v1', { name: 'widgets', namespaced: false }, 'apps')
    ).toBe('/apis/example.com/v1/widgets');
  });
});
