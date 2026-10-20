import { describe, expect, it } from 'vitest';
import {
  emptyPlacementChoice,
  importClusterResources,
  joinCommand,
  manifestWorksForClusters,
  missingBindings,
  placementResources,
} from './wizards';

const V = {
  placement: 'cluster.open-cluster-management.io/v1beta1',
  binding: 'cluster.open-cluster-management.io/v1beta2',
};

describe('missingBindings', () => {
  it('creates one binding per unbound set, named after the set', () => {
    expect(missingBindings(['prod', 'dev', 'prod'], ['dev'], 'apps', V.binding)).toEqual([
      {
        apiVersion: V.binding,
        kind: 'ManagedClusterSetBinding',
        metadata: { name: 'prod', namespace: 'apps' },
        spec: { clusterSet: 'prod' },
      },
    ]);
  });
});

describe('placementResources', () => {
  it('returns bindings before the placement and drops an empty set list', () => {
    const choice = {
      ...emptyPlacementChoice(),
      name: 'p',
      spec: { clusterSets: ['prod'], numberOfClusters: 2 },
    };
    const out = placementResources(choice, 'apps', [], V);
    expect(out.map(r => r.kind)).toEqual(['ManagedClusterSetBinding', 'Placement']);
    expect(out[1]).toMatchObject({
      metadata: { name: 'p', namespace: 'apps' },
      spec: { clusterSets: ['prod'], numberOfClusters: 2 },
    });
    const all = placementResources({ ...choice, spec: { clusterSets: [] } }, 'apps', [], V);
    expect(all).toHaveLength(1);
    expect(all[0].spec).toEqual({});
  });

  it('creates nothing for an existing placement or when bindings are disabled', () => {
    expect(
      placementResources({ ...emptyPlacementChoice(), mode: 'existing', name: 'p' }, 'apps', [], V)
    ).toEqual([]);
    const out = placementResources(
      { ...emptyPlacementChoice(), name: 'p', spec: { clusterSets: ['x'] }, createBindings: false },
      'apps',
      [],
      V
    );
    expect(out.map(r => r.kind)).toEqual(['Placement']);
  });
});

describe('importClusterResources', () => {
  it('creates an accepted cluster with its set label', () => {
    const [mc] = importClusterResources(
      { name: 'c1', labels: { env: 'prod' }, clusterSet: 'prod', addons: [] },
      { cluster: 'cluster.open-cluster-management.io/v1' }
    );
    expect(mc.metadata.labels).toEqual({
      env: 'prod',
      'cluster.open-cluster-management.io/clusterset': 'prod',
    });
    expect(mc.spec).toEqual({ hubAcceptsClient: true });
  });

  it('adds the cluster namespace and the add-ons in the served version shape', () => {
    const beta = importClusterResources(
      { name: 'c1', labels: {}, addons: ['a'], installNamespace: 'x' },
      {
        cluster: 'cluster.open-cluster-management.io/v1',
        addon: 'addon.open-cluster-management.io/v1beta1',
      }
    );
    expect(beta.map(r => r.kind)).toEqual(['ManagedCluster', 'Namespace', 'ManagedClusterAddOn']);
    expect(beta[2].spec).toEqual({});
    const alpha = importClusterResources(
      { name: 'c1', labels: {}, addons: ['a'], installNamespace: 'x' },
      {
        cluster: 'cluster.open-cluster-management.io/v1',
        addon: 'addon.open-cluster-management.io/v1alpha1',
      }
    );
    expect(alpha[2].spec).toEqual({ installNamespace: 'x' });
  });

  it('builds the clusteradm join command', () => {
    expect(joinCommand('c1', 'https://hub:6443')).toContain('--cluster-name c1');
    expect(joinCommand('c1')).toContain('<hub API server URL>');
  });
});

describe('manifestWorksForClusters', () => {
  it('creates an independent copy per cluster namespace', () => {
    const spec = {
      workload: {
        manifests: [
          { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'x', namespace: 'default' } },
        ],
      },
    };
    const works = manifestWorksForClusters(
      'w',
      ['a', 'b'],
      spec,
      'work.open-cluster-management.io/v1'
    );
    expect(works.map(w => w.metadata.namespace)).toEqual(['a', 'b']);
    expect(works[0].spec).not.toBe(works[1].spec);
  });
});
