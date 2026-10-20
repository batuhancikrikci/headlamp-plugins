import { describe, expect, it } from 'vitest';
import {
  configReferences,
  convertClusterManagementAddOn,
  defaultConfigs,
  newManagedClusterAddOn,
  registrations,
  withDefaultConfigs,
} from './addon';
import {
  isSubscriptionPaused,
  parseChannelRef,
  pausePatch,
  reportSummary,
  subscriptionState,
} from './apps';
import {
  clusterInSet,
  clusterSetPatch,
  clusterState,
  csrDecisionBody,
  csrState,
  ManagedClusterJson,
  ManagedClusterSetJson,
  pendingCSRsByCluster,
} from './cluster';
import { hubVersionHint, imageTag, operatorHealth } from './operator';
import { mwrsState, normalizeSummary, workState } from './work';

const A1 = 'addon.open-cluster-management.io/v1alpha1';
const B1 = 'addon.open-cluster-management.io/v1beta1';

const cluster = (
  name: string,
  labels: Record<string, string>,
  accepted = true,
  conds: Array<[string, string]> = []
): ManagedClusterJson => ({
  apiVersion: 'cluster.open-cluster-management.io/v1',
  kind: 'ManagedCluster',
  metadata: { name, labels },
  spec: { hubAcceptsClient: accepted },
  status: { conditions: conds.map(([type, status]) => ({ type, status })) },
});

describe('clusterState', () => {
  it('follows the registration lifecycle', () => {
    expect(clusterState(cluster('a', {}, false))).toBe('pending-accept');
    expect(clusterState(cluster('a', {}, true))).toBe('pending-join');
    expect(clusterState(cluster('a', {}, true, [['ManagedClusterJoined', 'True']]))).toBe(
      'unknown'
    );
    expect(
      clusterState(
        cluster('a', {}, true, [
          ['ManagedClusterJoined', 'True'],
          ['ManagedClusterConditionAvailable', 'True'],
        ])
      )
    ).toBe('available');
    expect(
      clusterState(
        cluster('a', {}, true, [
          ['ManagedClusterJoined', 'True'],
          ['ManagedClusterConditionAvailable', 'False'],
        ])
      )
    ).toBe('unavailable');
    expect(clusterState(cluster('a', {}, true, [['HubDeniedManagedCluster', 'True']]))).toBe(
      'denied'
    );
  });
});

describe('cluster set membership', () => {
  const exclusive: ManagedClusterSetJson = {
    apiVersion: 'cluster.open-cluster-management.io/v1beta2',
    kind: 'ManagedClusterSet',
    metadata: { name: 'prod' },
    spec: { clusterSelector: { selectorType: 'ExclusiveClusterSetLabel' } },
  };
  const global: ManagedClusterSetJson = {
    apiVersion: 'cluster.open-cluster-management.io/v1beta2',
    kind: 'ManagedClusterSet',
    metadata: { name: 'global' },
    spec: { clusterSelector: { selectorType: 'LabelSelector', labelSelector: {} } },
  };
  it('uses the cluster set label for exclusive sets and the selector otherwise', () => {
    const c = cluster('c1', { 'cluster.open-cluster-management.io/clusterset': 'prod' });
    expect(clusterInSet(c, exclusive)).toBe(true);
    expect(clusterInSet(cluster('c2', {}), exclusive)).toBe(false);
    expect(clusterInSet(cluster('c2', {}), global)).toBe(true);
  });
  it('builds the label patch (null removes the label)', () => {
    expect(clusterSetPatch(null)).toEqual({
      metadata: { labels: { 'cluster.open-cluster-management.io/clusterset': null } },
    });
  });
});

describe('CSR', () => {
  const csr = {
    apiVersion: 'certificates.k8s.io/v1',
    kind: 'CertificateSigningRequest',
    metadata: { name: 'c1-x', labels: { 'open-cluster-management.io/cluster-name': 'c1' } },
    spec: { username: 'system:serviceaccount:open-cluster-management:agent' },
  };
  it('detects pending CSRs per cluster', () => {
    expect(csrState(csr)).toBe('pending');
    expect(Object.keys(pendingCSRsByCluster([csr]))).toEqual(['c1']);
  });
  it('builds the approval body with an Approved condition', () => {
    const body = csrDecisionBody(csr, 'Approved', 'ok', '2026-01-01T00:00:00Z');
    expect(body.status?.conditions).toEqual([
      expect.objectContaining({ type: 'Approved', status: 'True', message: 'ok' }),
    ]);
    expect(csrState(body)).toBe('approved');
    expect(csrState(csrDecisionBody(csr, 'Denied', 'no', '2026-01-01T00:00:00Z'))).toBe('denied');
  });
});

describe('add-on version adaptation', () => {
  const alpha = {
    apiVersion: A1,
    kind: 'ClusterManagementAddOn',
    metadata: { name: 'observability' },
    spec: {
      supportedConfigs: [
        {
          group: 'addon.open-cluster-management.io',
          resource: 'addondeploymentconfigs',
          defaultConfig: { name: 'cfg', namespace: 'ns' },
        },
        { resource: 'configmaps' },
      ],
    },
  };
  const beta = {
    apiVersion: B1,
    kind: 'ClusterManagementAddOn',
    metadata: { name: 'observability' },
    spec: {
      defaultConfigs: [
        {
          group: 'addon.open-cluster-management.io',
          resource: 'addondeploymentconfigs',
          name: 'cfg',
          namespace: 'ns',
        },
      ],
    },
  };

  it('reads default configs from both shapes', () => {
    expect(defaultConfigs(alpha)).toEqual([
      {
        group: 'addon.open-cluster-management.io',
        resource: 'addondeploymentconfigs',
        name: 'cfg',
        namespace: 'ns',
      },
      { group: undefined, resource: 'configmaps', name: undefined, namespace: undefined },
    ]);
    expect(defaultConfigs(beta)).toEqual(beta.spec.defaultConfigs);
  });

  it('writes the shape of the target version', () => {
    const toBeta = convertClusterManagementAddOn(alpha, B1);
    expect(toBeta.apiVersion).toBe(B1);
    expect(toBeta.spec?.supportedConfigs).toBeUndefined();
    // v1beta1 entries need a name; the config type without a default is dropped.
    expect(toBeta.spec?.defaultConfigs).toEqual(beta.spec.defaultConfigs);
    const back = convertClusterManagementAddOn(beta, A1);
    expect(back.spec?.defaultConfigs).toBeUndefined();
    expect(back.spec?.supportedConfigs).toEqual([alpha.spec.supportedConfigs[0]]);
  });

  it('removes the configs key when the list becomes empty', () => {
    expect(withDefaultConfigs(alpha, []).spec).toEqual({});
  });

  it('only writes installNamespace for v1alpha1', () => {
    expect(newManagedClusterAddOn(A1, 'x', 'c1', 'agents').spec).toEqual({
      installNamespace: 'agents',
    });
    expect(newManagedClusterAddOn(B1, 'x', 'c1', 'agents').spec).toEqual({});
    expect(newManagedClusterAddOn(B1, 'x', 'c1').metadata).toEqual({ name: 'x', namespace: 'c1' });
  });

  it('normalizes status registrations and config references', () => {
    const v1alpha1 = {
      apiVersion: A1,
      kind: 'ManagedClusterAddOn',
      metadata: { name: 'x', namespace: 'c1' },
      status: {
        registrations: [
          { signerName: 'kubernetes.io/kube-apiserver-client', subject: { user: 'u' } },
        ],
        configReferences: [{ resource: 'addondeploymentconfigs', name: 'cfg', namespace: 'ns' }],
      },
    };
    const v1beta1 = {
      apiVersion: B1,
      kind: 'ManagedClusterAddOn',
      metadata: { name: 'x', namespace: 'c1' },
      status: {
        registrations: [
          { type: 'kubeClient', kubeClient: { driver: 'csr', subject: { user: 'u' } } },
        ],
        configReferences: [
          { resource: 'addondeploymentconfigs', desiredConfig: { name: 'cfg', namespace: 'ns' } },
        ],
      },
    };
    expect(registrations(v1alpha1)[0]).toMatchObject({ type: 'kubeClient', user: 'u' });
    expect(registrations(v1beta1)[0]).toMatchObject({
      type: 'kubeClient',
      user: 'u',
      driver: 'csr',
    });
    expect(configReferences(v1alpha1)).toEqual(configReferences(v1beta1));
  });
});

describe('ManifestWork and replica sets', () => {
  it('reads the MWRS summary before and after the Applied → applied rename (OCM v1.1.0)', () => {
    expect(
      normalizeSummary({ total: 3, Applied: 3, available: 2, degraded: 0, progressing: 1 })
    ).toMatchObject({ applied: 3 });
    expect(normalizeSummary({ total: 3, applied: 2, available: 2, desiredTotal: 3 })).toMatchObject(
      { applied: 2, desiredTotal: 3 }
    );
    expect(normalizeSummary(undefined)).toMatchObject({
      total: 0,
      applied: 0,
      desiredTotal: undefined,
    });
  });

  it('derives the replica set state', () => {
    const base = {
      apiVersion: 'work.open-cluster-management.io/v1alpha1',
      kind: 'ManifestWorkReplicaSet',
      metadata: { name: 'r', namespace: 'n' },
    };
    expect(mwrsState({ ...base, status: { summary: { total: 2, available: 2 } } })).toBe(
      'available'
    );
    expect(
      mwrsState({ ...base, status: { summary: { total: 2, available: 1, degraded: 1 } } })
    ).toBe('degraded');
    expect(
      mwrsState({
        ...base,
        status: { conditions: [{ type: 'PlacementVerified', status: 'False' }] },
      })
    ).toBe('placement-missing');
  });

  it('derives the work state from its conditions', () => {
    const work = (conds: Array<[string, string]>) => ({
      apiVersion: 'work.open-cluster-management.io/v1',
      kind: 'ManifestWork',
      metadata: { name: 'w', namespace: 'c1' },
      status: { conditions: conds.map(([type, status]) => ({ type, status })) },
    });
    expect(
      workState(
        work([
          ['Applied', 'True'],
          ['Available', 'True'],
        ])
      )
    ).toBe('available');
    expect(workState(work([['Applied', 'False']]))).toBe('failed');
    expect(
      workState(
        work([
          ['Applied', 'True'],
          ['Degraded', 'True'],
        ])
      )
    ).toBe('degraded');
    expect(workState(work([]))).toBe('pending');
  });
});

describe('subscriptions', () => {
  const sub = (labels: Record<string, string>, phase?: string) => ({
    apiVersion: 'apps.open-cluster-management.io/v1',
    kind: 'Subscription',
    metadata: { name: 's', namespace: 'apps', labels },
    spec: { channel: 'ch-ns/git' },
    status: { phase },
  });
  it('parses channel references', () => {
    expect(parseChannelRef('ch-ns/git')).toEqual({ namespace: 'ch-ns', name: 'git' });
    expect(parseChannelRef('git')).toBeUndefined();
  });
  it('pauses through the subscription-pause label', () => {
    expect(isSubscriptionPaused(sub({ 'subscription-pause': 'true' }))).toBe(true);
    expect(subscriptionState(sub({ 'subscription-pause': 'true' }, 'Propagated'))).toBe('paused');
    expect(pausePatch(false)).toEqual({ metadata: { labels: { 'subscription-pause': 'false' } } });
  });
  it('maps phases to states', () => {
    expect(subscriptionState(sub({}, 'Propagated'))).toBe('propagated');
    expect(subscriptionState(sub({}, 'PropagationFailed'))).toBe('failed');
    expect(subscriptionState(sub({}))).toBe('pending');
  });
  it('parses report counts stored as strings', () => {
    const report = {
      apiVersion: 'x/v1alpha1',
      kind: 'SubscriptionReport',
      metadata: { name: 's' },
      summary: { deployed: '2', failed: '1', clusters: '3' },
    };
    expect(reportSummary(report)).toEqual({
      deployed: 2,
      inProgress: 0,
      failed: 1,
      propagationFailed: 0,
      clusters: 3,
    });
  });
});

describe('operator', () => {
  it('derives the hub version from image tags', () => {
    expect(imageTag('quay.io/open-cluster-management/registration:v1.3.1')).toBe('v1.3.1');
    expect(imageTag('registry:5000/ocm/registration')).toBeUndefined();
    expect(imageTag('quay.io/ocm/work@sha256:abc')).toBeUndefined();
    expect(
      hubVersionHint({
        apiVersion: 'operator.open-cluster-management.io/v1',
        kind: 'ClusterManager',
        metadata: { name: 'cluster-manager' },
        spec: { registrationImagePullSpec: 'quay.io/open-cluster-management/registration:v0.14.0' },
      })
    ).toBe('v0.14.0');
  });
  it('reports degraded conditions as errors', () => {
    expect(
      operatorHealth([
        { type: 'Applied', status: 'True' },
        { type: 'HubRegistrationDegraded', status: 'False' },
      ])
    ).toBe('success');
    expect(
      operatorHealth([
        { type: 'Applied', status: 'True' },
        { type: 'HubPlacementDegraded', status: 'True' },
      ])
    ).toBe('error');
    expect(
      operatorHealth([
        { type: 'Applied', status: 'True' },
        { type: 'Progressing', status: 'True' },
      ])
    ).toBe('warning');
  });
});
