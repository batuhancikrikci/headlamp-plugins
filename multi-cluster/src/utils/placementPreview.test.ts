import { describe, expect, it } from 'vitest';
import { ManagedClusterJson, ManagedClusterSetJson } from '../resources/models/cluster';
import { blockingTaints, previewPlacement, tolerates } from './placementPreview';

const SET_LABEL = 'cluster.open-cluster-management.io/clusterset';

const cluster = (
  name: string,
  labels: Record<string, string>,
  extra: Partial<ManagedClusterJson> = {}
): ManagedClusterJson => ({
  apiVersion: 'cluster.open-cluster-management.io/v1',
  kind: 'ManagedCluster',
  metadata: { name, labels },
  spec: { hubAcceptsClient: true, ...(extra.spec || {}) },
  status: extra.status,
});

const set = (name: string): ManagedClusterSetJson => ({
  apiVersion: 'cluster.open-cluster-management.io/v1beta2',
  kind: 'ManagedClusterSet',
  metadata: { name },
  spec: { clusterSelector: { selectorType: 'ExclusiveClusterSetLabel' } },
});

const clusters = [
  cluster('a', { [SET_LABEL]: 'prod', env: 'prod' }),
  cluster(
    'b',
    { [SET_LABEL]: 'prod', env: 'stage' },
    { status: { clusterClaims: [{ name: 'region.open-cluster-management.io', value: 'eu' }] } }
  ),
  cluster('c', { [SET_LABEL]: 'dev', env: 'prod' }),
  cluster(
    'd',
    { [SET_LABEL]: 'prod', env: 'prod' },
    {
      spec: {
        taints: [{ key: 'cluster.open-cluster-management.io/unreachable', effect: 'NoSelect' }],
      },
    }
  ),
];
const sets = [set('prod'), set('dev')];

describe('previewPlacement', () => {
  it('selects only clusters of bound sets', () => {
    const p = previewPlacement(
      { clusterSets: ['prod', 'dev'] },
      { clusters, sets, boundSets: ['prod'] }
    );
    expect(p.unboundSets).toEqual(['dev']);
    expect(p.eligibleSets).toEqual(['prod']);
    expect(p.clusters.find(c => c.name === 'c')?.reasons).toEqual(['not-in-set']);
  });

  it('uses all bound sets when none are requested', () => {
    const p = previewPlacement({}, { clusters, sets, boundSets: ['prod', 'dev'] });
    expect(p.clusters.filter(c => c.selected).map(c => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('ORs predicates and ANDs label and claim selectors', () => {
    const p = previewPlacement(
      {
        predicates: [
          { requiredClusterSelector: { labelSelector: { matchLabels: { env: 'prod' } } } },
          {
            requiredClusterSelector: {
              labelSelector: { matchLabels: { env: 'stage' } },
              claimSelector: {
                matchExpressions: [
                  { key: 'region.open-cluster-management.io', operator: 'In', values: ['eu'] },
                ],
              },
            },
          },
        ],
      },
      { clusters, sets, boundSets: ['prod'] }
    );
    expect(p.clusters.filter(c => c.selected).map(c => c.name)).toEqual(['a', 'b']);
  });

  it('excludes untolerated NoSelect taints and honours tolerations', () => {
    const without = previewPlacement({}, { clusters, sets, boundSets: ['prod'] });
    expect(without.clusters.find(c => c.name === 'd')?.reasons).toEqual(['taint']);
    const tolerated = previewPlacement(
      {
        tolerations: [
          { key: 'cluster.open-cluster-management.io/unreachable', operator: 'Exists' },
        ],
      },
      { clusters, sets, boundSets: ['prod'] }
    );
    expect(tolerated.clusters.find(c => c.name === 'd')?.selected).toBe(true);
  });

  it('caps the result at numberOfClusters', () => {
    const p = previewPlacement({ numberOfClusters: 1 }, { clusters, sets, boundSets: ['prod'] });
    expect(p.selectedCount).toBe(1);
    expect(p.clusters.find(c => c.name === 'b')?.reasons).toEqual(['over-limit']);
  });

  it('flags specs it cannot evaluate exactly', () => {
    const p = previewPlacement(
      { predicates: [{ requiredClusterSelector: { celSelector: { celExpressions: ['true'] } } }] },
      { clusters, sets, boundSets: ['prod'] }
    );
    expect(p.approximate).toBe(true);
  });
});

describe('tolerations', () => {
  it('matches like the scheduler', () => {
    const taint = { key: 'k', value: 'v', effect: 'NoSelect' };
    expect(tolerates({ key: 'k', operator: 'Equal', value: 'v' }, taint)).toBe(true);
    expect(tolerates({ key: 'k', operator: 'Equal', value: 'x' }, taint)).toBe(false);
    expect(tolerates({ operator: 'Exists' }, taint)).toBe(true);
    expect(tolerates({ key: 'k', operator: 'Exists', effect: 'PreferNoSelect' }, taint)).toBe(
      false
    );
    expect(
      blockingTaints(
        cluster('x', {}, { spec: { taints: [{ key: 'k', effect: 'PreferNoSelect' }] } }),
        []
      )
    ).toEqual([]);
  });
});
