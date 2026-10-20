import { describe, expect, it } from 'vitest';
import { ManagedClusterJson } from '../../resources/models/cluster';
import { Compliance, PolicyJson } from '../../resources/models/policy';
import {
  argoCounts,
  collectIssues,
  kindHealthCounts,
  placementSummary,
  policyCounts,
} from './overview';

const cluster = (
  name: string,
  accepted: boolean,
  conditions: Array<[string, string]>
): ManagedClusterJson => ({
  apiVersion: 'cluster.open-cluster-management.io/v1',
  kind: 'ManagedCluster',
  metadata: { name },
  spec: { hubAcceptsClient: accepted },
  status: {
    conditions: conditions.map(([type, status]) => ({
      type,
      status,
      message: `${type} ${status}`,
    })),
  },
});

describe('collectIssues', () => {
  it('reports clusters that are not accepted, not joined or unavailable', () => {
    const issues = collectIssues({
      clusters: [
        cluster('new', false, []),
        cluster('joining', true, [['HubAcceptedManagedCluster', 'True']]),
        cluster('down', true, [
          ['ManagedClusterJoined', 'True'],
          ['ManagedClusterConditionAvailable', 'False'],
        ]),
        cluster('ok', true, [
          ['ManagedClusterJoined', 'True'],
          ['ManagedClusterConditionAvailable', 'True'],
        ]),
      ],
      csrs: [
        {
          apiVersion: 'certificates.k8s.io/v1',
          kind: 'CertificateSigningRequest',
          metadata: {
            name: 'joining-abc',
            labels: { 'open-cluster-management.io/cluster-name': 'joining' },
          },
        },
      ],
    });
    expect(issues.map(i => i.name)).toEqual(['down', 'new', 'joining']);
    expect(issues[0].severity).toBe('error');
    expect(issues.find(i => i.name === 'joining')?.message).toMatch(
      /1 certificate signing request/
    );
  });

  it('reports failed subscriptions and works', () => {
    const issues = collectIssues({
      subscriptions: [
        {
          apiVersion: 'apps.open-cluster-management.io/v1',
          kind: 'Subscription',
          metadata: { name: 'app', namespace: 'apps' },
          status: { phase: 'PropagationFailed', message: 'channel not found' },
        },
      ],
      works: [
        {
          apiVersion: 'work.open-cluster-management.io/v1',
          kind: 'ManifestWork',
          metadata: { name: 'w', namespace: 'c1' },
          status: { conditions: [{ type: 'Applied', status: 'False', message: 'forbidden' }] },
        },
      ],
    });
    expect(issues.map(i => `${i.kind}:${i.message}`).sort()).toEqual([
      'ManifestWork:forbidden',
      'Subscription:channel not found',
    ]);
  });
});

describe('placementSummary', () => {
  it('collects the clusters of each placement from its decisions', () => {
    const rows = placementSummary(
      [
        {
          apiVersion: 'cluster.open-cluster-management.io/v1beta1',
          kind: 'Placement',
          metadata: { name: 'p', namespace: 'ns' },
          spec: { numberOfClusters: 3 },
          status: {
            numberOfSelectedClusters: 2,
            conditions: [{ type: 'PlacementSatisfied', status: 'False' }],
          },
        },
      ],
      [
        {
          apiVersion: 'cluster.open-cluster-management.io/v1beta1',
          kind: 'PlacementDecision',
          metadata: {
            name: 'p-decision-1',
            namespace: 'ns',
            labels: { 'cluster.open-cluster-management.io/placement': 'p' },
          },
          status: { decisions: [{ clusterName: 'a' }, { clusterName: 'b' }] },
        },
        {
          apiVersion: 'cluster.open-cluster-management.io/v1beta1',
          kind: 'PlacementDecision',
          metadata: {
            name: 'other',
            namespace: 'other',
            labels: { 'cluster.open-cluster-management.io/placement': 'p' },
          },
          status: { decisions: [{ clusterName: 'x' }] },
        },
      ]
    );
    expect(rows).toEqual([
      {
        name: 'p',
        namespace: 'ns',
        state: 'unsatisfied',
        selected: 2,
        requested: 3,
        clusters: ['a', 'b'],
      },
    ]);
  });
});

describe('Argo CD applications', () => {
  const app = (name: string, health: string, sync: string, phase?: string) => ({
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: { name, namespace: 'argocd' },
    spec: { project: 'default', destination: {} },
    status: {
      health: { status: health },
      sync: { status: sync },
      ...(phase ? { operationState: { phase, message: 'boom' } } : {}),
    },
  });

  it('reports degraded, out-of-sync and failed applications', () => {
    const issues = collectIssues({
      argoApps: [
        app('ok', 'Healthy', 'Synced'),
        app('drift', 'Healthy', 'OutOfSync'),
        app('bad', 'Degraded', 'Synced'),
        app('fail', 'Healthy', 'Synced', 'Failed'),
      ],
    });
    expect(issues.map(i => `${i.severity}:${i.name}`).sort()).toEqual([
      'error:bad',
      'error:fail',
      'warning:drift',
    ]);
  });

  it('counts health and sync states', () => {
    expect(
      argoCounts([app('a', 'Healthy', 'Synced'), app('b', 'Degraded', 'OutOfSync')])
    ).toMatchObject({
      total: 2,
      healthy: 1,
      degraded: 1,
      synced: 1,
      outOfSync: 1,
    });
  });
});

describe('kindHealthCounts', () => {
  it('counts failing and pending objects with kind-specific labels', () => {
    const counts = kindHealthCounts('ManagedCluster', [
      cluster('a', true, [
        ['ManagedClusterJoined', 'True'],
        ['ManagedClusterConditionAvailable', 'True'],
      ]),
      cluster('b', true, [
        ['ManagedClusterJoined', 'True'],
        ['ManagedClusterConditionAvailable', 'False'],
      ]),
      cluster('c', false, []),
    ]);
    expect(counts).toEqual({
      total: 3,
      error: 1,
      errorLabel: 'unavailable',
      warning: 1,
      warningLabel: 'pending',
    });
  });

  it('only counts objects for kinds without a health model', () => {
    expect(kindHealthCounts('ClusterClaim', [{}, {}])).toMatchObject({
      total: 2,
      error: 0,
      warning: 0,
    });
  });
});

describe('policies', () => {
  const policy = (
    name: string,
    compliant?: Compliance,
    extra: Record<string, unknown> = {}
  ): PolicyJson => ({
    apiVersion: 'policy.open-cluster-management.io/v1',
    kind: 'Policy',
    metadata: {
      name,
      namespace: 'policies',
      ...(extra.labels ? { labels: extra.labels as Record<string, string> } : {}),
    },
    spec: { remediationAction: (extra.remediation as string) || 'inform' },
    status: { compliant, status: [{ clustername: 'c1', compliant }] },
  });

  it('reports non-compliant root policies (errors when enforced) and ignores cluster copies', () => {
    const issues = collectIssues({
      policies: [
        policy('ok', 'Compliant'),
        policy('bad', 'NonCompliant'),
        policy('bad-enforced', 'NonCompliant', { remediation: 'enforce' }),
        policy('policies.bad', 'NonCompliant', {
          labels: { 'policy.open-cluster-management.io/root-policy': 'policies.bad' },
        }),
      ],
    });
    expect(issues.map(i => `${i.severity}:${i.name}`)).toEqual([
      'error:bad-enforced',
      'warning:bad',
    ]);
    expect(issues[0].message).toBe('Non-compliant on 1 cluster(s): c1');
  });

  it('counts root policies by compliance', () => {
    expect(
      policyCounts([
        policy('a', 'Compliant'),
        policy('b', 'NonCompliant', { remediation: 'enforce' }),
        policy('c'),
      ])
    ).toEqual({
      total: 3,
      compliant: 1,
      nonCompliant: 1,
      pending: 0,
      noStatus: 1,
      disabled: 0,
      enforced: 1,
    });
  });
});
