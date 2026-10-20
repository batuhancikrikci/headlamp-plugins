import { describe, expect, it } from 'vitest';
import { APIResource, buildAvailability } from '../api/availability';
import { GROUPS } from '../api/kinds';
import { ClusterManagementAddOnJson, ManagedClusterAddOnJson } from '../resources/models/addon';
import { GitOpsClusterJson } from '../resources/models/apps';
import { ManagedClusterJson } from '../resources/models/cluster';
import { ClusterManagerJson } from '../resources/models/operator';
import {
  argoNamespaces,
  assessReadiness,
  gateEnabled,
  parseOcmVersion,
  ReadinessInput,
  StackReadiness,
  summarize,
} from './model';

const res = (name: string): APIResource => ({ name, verbs: ['get', 'list'] });

/** OCM v1.3 hub with Argo CD, argocd-agent (GitOpsCluster v1alpha1) and the policy framework. */
function availability(extra: Record<string, string[]> = {}) {
  return buildAvailability(
    {
      [GROUPS.cluster]: ['v1', 'v1beta1', 'v1beta2'],
      [GROUPS.work]: ['v1', 'v1alpha1'],
      [GROUPS.addon]: ['v1alpha1'],
      [GROUPS.operator]: ['v1'],
      [GROUPS.argo]: ['v1alpha1'],
      [GROUPS.apps]: ['v1alpha1'],
      [GROUPS.policy]: ['v1'],
      ...Object.fromEntries(Object.keys(extra).map(g => [g, ['v1alpha1']])),
    },
    {
      [`${GROUPS.cluster}/v1`]: [res('managedclusters')],
      [`${GROUPS.cluster}/v1beta2`]: [res('managedclustersets'), res('managedclustersetbindings')],
      [`${GROUPS.cluster}/v1beta1`]: [res('placements'), res('placementdecisions')],
      [`${GROUPS.work}/v1`]: [res('manifestworks')],
      [`${GROUPS.work}/v1alpha1`]: [res('manifestworkreplicasets')],
      [`${GROUPS.addon}/v1alpha1`]: [res('clustermanagementaddons'), res('managedclusteraddons')],
      [`${GROUPS.operator}/v1`]: [res('clustermanagers')],
      [`${GROUPS.argo}/v1alpha1`]: [
        res('applications'),
        res('applicationsets'),
        res('appprojects'),
      ],
      [`${GROUPS.apps}/v1alpha1`]: [res('gitopsclusters')],
      [`${GROUPS.policy}/v1`]: [res('policies'), res('placementbindings')],
      ...Object.fromEntries(Object.entries(extra).map(([g, r]) => [`${g}/v1alpha1`, r.map(res)])),
    }
  );
}

const cm = (gates: Array<{ feature: string; mode?: string }> = []): ClusterManagerJson =>
  ({
    apiVersion: 'operator.open-cluster-management.io/v1',
    kind: 'ClusterManager',
    metadata: { name: 'cluster-manager' },
    spec: {
      registrationImagePullSpec: 'quay.io/open-cluster-management/registration:v1.3.1',
      workConfiguration: { featureGates: gates },
    },
    status: { conditions: [{ type: 'Applied', status: 'True' }] },
  } as unknown as ClusterManagerJson);

const cluster = (name: string, available: boolean): ManagedClusterJson =>
  ({
    apiVersion: 'cluster.open-cluster-management.io/v1',
    kind: 'ManagedCluster',
    metadata: { name },
    spec: { hubAcceptsClient: true },
    status: {
      conditions: [
        { type: 'HubAcceptedManagedCluster', status: 'True' },
        { type: 'ManagedClusterJoined', status: 'True' },
        { type: 'ManagedClusterConditionAvailable', status: available ? 'True' : 'False' },
      ],
    },
  } as unknown as ManagedClusterJson);

const cma = (name: string) => ({ metadata: { name } } as unknown as ClusterManagementAddOnJson);
const mca = (name: string, ns: string) =>
  ({
    metadata: { name, namespace: ns },
    status: { conditions: [{ type: 'Available', status: 'True' }] },
  } as unknown as ManagedClusterAddOnJson);

function base(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    availability: availability(),
    clusterManager: cm(),
    clusters: [cluster('c1', true), cluster('c2', true)],
    csrs: [],
    sets: [{ metadata: { name: 'global' } } as never],
    cmas: [],
    mcas: [],
    gitops: [],
    argoSecrets: [],
    generatorConfigMaps: [],
    ...over,
  };
}

const byId = (stacks: StackReadiness[], id: string) => stacks.find(s => s.id === id)!;

describe('parseOcmVersion', () => {
  it('reads major and minor from image tags', () => {
    expect(parseOcmVersion('v1.3.1')).toEqual({ major: 1, minor: 3 });
    expect(parseOcmVersion('0.14.0')).toEqual({ major: 0, minor: 14 });
    expect(parseOcmVersion('latest')).toBeUndefined();
    expect(parseOcmVersion(undefined)).toBeUndefined();
  });
});

describe('gateEnabled', () => {
  it('uses the default when the gate is not listed and Disable when mode is omitted', () => {
    expect(gateEnabled(undefined, 'DefaultClusterSet', true)).toBe(true);
    expect(gateEnabled([{ feature: 'X', mode: 'Enable' }], 'X', false)).toBe(true);
    expect(gateEnabled([{ feature: 'X' }], 'X', true)).toBe(false);
  });
});

describe('assessReadiness', () => {
  it('reports the core stacks of a healthy hub as ready', () => {
    const stacks = assessReadiness(base());
    expect(byId(stacks, 'hub').status).toBe('ready');
    expect(byId(stacks, 'registration').status).toBe('ready');
    expect(byId(stacks, 'placement').status).toBe('ready');
    expect(byId(stacks, 'addons').status).toBe('ready');
  });

  it('marks everything missing on a non-hub cluster', () => {
    const stacks = assessReadiness({ availability: buildAvailability({}, {}) });
    expect(stacks.every(s => s.status === 'missing')).toBe(true);
    expect(summarize(stacks).requiredReady).toBe(0);
  });

  it('flags unavailable clusters and an empty hub as partial', () => {
    expect(
      byId(assessReadiness(base({ clusters: [cluster('c1', false)] })), 'registration').status
    ).toBe('partial');
    expect(byId(assessReadiness(base({ clusters: [] })), 'registration').status).toBe('partial');
  });

  it('warns when ManifestWorkReplicaSet is served but its gate is disabled', () => {
    expect(byId(assessReadiness(base()), 'work').status).toBe('partial');
    const enabled = base({
      clusterManager: cm([{ feature: 'ManifestWorkReplicaSet', mode: 'Enable' }]),
    });
    expect(byId(assessReadiness(enabled), 'work').status).toBe('ready');
  });

  it('detects the argocd-agent model from GitOpsCluster v1alpha1', () => {
    const gitops: GitOpsClusterJson = {
      apiVersion: 'apps.open-cluster-management.io/v1alpha1',
      kind: 'GitOpsCluster',
      metadata: { name: 'agent', namespace: 'argocd' },
      spec: {
        placementRef: { kind: 'Placement', name: 'all' },
        argoCDAgentAddon: { mode: 'managed' },
      },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    } as unknown as GitOpsClusterJson;
    const stacks = assessReadiness(
      base({
        gitops: [gitops],
        cmas: [cma('argocd-agent-addon')],
        mcas: [mca('argocd-agent-addon', 'c1')],
        generatorConfigMaps: ['ocm-placement-generator'],
      })
    );
    expect(byId(stacks, 'argocd').status).toBe('ready');
    expect(byId(stacks, 'gitops-agent').status).toBe('ready');
    expect(byId(stacks, 'gitops-push').status).toBe('missing');
    expect(summarize(stacks).gitopsModels).toEqual(['advanced pull (argocd-agent)']);
  });

  it('tells an unreadable generator ConfigMap from a missing one', () => {
    const gitops = {
      apiVersion: 'apps.open-cluster-management.io/v1alpha1',
      kind: 'GitOpsCluster',
      metadata: { name: 'agent', namespace: 'argocd' },
      spec: { placementRef: { kind: 'Placement', name: 'all' }, argoCDAgentAddon: {} },
      status: { conditions: [{ type: 'Ready', status: 'True' }] },
    } as unknown as GitOpsClusterJson;
    const detail = (over: Partial<ReadinessInput>) =>
      byId(assessReadiness(base({ gitops: [gitops], ...over })), 'gitops-agent').checks.find(
        c => c.label === 'ocm-placement-generator ConfigMap'
      );
    expect(detail({ generatorConfigMaps: [] })?.detail).toBe('not found in the Argo CD namespaces');
    expect(
      detail({ generatorConfigMaps: [], unreadableConfigMaps: ['ocm-placement-generator'] })?.detail
    ).toMatch(/could not be read/);
    expect(detail({ generatorConfigMaps: ['ocm-placement-generator'] })?.state).toBe('ok');
  });

  it('checks the policy framework add-ons', () => {
    const partial = assessReadiness(base({ cmas: [cma('governance-policy-framework')] }));
    expect(byId(partial, 'governance').status).toBe('partial');
    const ready = assessReadiness(
      base({
        cmas: [cma('governance-policy-framework'), cma('config-policy-controller')],
        mcas: [mca('governance-policy-framework', 'c1'), mca('config-policy-controller', 'c1')],
      })
    );
    expect(byId(ready, 'governance').status).toBe('ready');
  });

  it('detects cluster-proxy and search from their API groups', () => {
    const stacks = assessReadiness(
      base({
        availability: availability({
          'proxy.open-cluster-management.io': ['managedproxyconfigurations'],
        }),
        cmas: [cma('cluster-proxy')],
        mcas: [mca('cluster-proxy', 'c1')],
      })
    );
    expect(byId(stacks, 'cluster-proxy').status).toBe('ready');
    expect(byId(stacks, 'search').status).toBe('missing');
  });

  it('offers clusteradm commands for application-manager only before OCM v1', () => {
    expect(byId(assessReadiness(base()), 'subscriptions').install?.commands).toBeUndefined();
    const old = cm();
    (old.spec as { registrationImagePullSpec: string }).registrationImagePullSpec =
      'quay.io/open-cluster-management/registration:v0.15.2';
    expect(
      byId(assessReadiness(base({ clusterManager: old })), 'subscriptions').install?.commands
    ).toContain('clusteradm install hub-addon --names application-manager');
  });
});

describe('search readiness', () => {
  it('detects a Search install without the operator from its services', () => {
    const ready = byId(
      assessReadiness(
        base({
          searchServices: [
            'open-cluster-management/search-search-api',
            'open-cluster-management/search-indexer',
            'open-cluster-management/search-postgresql',
          ],
        })
      ),
      'search'
    );
    expect(ready.status).toBe('ready');
    const partial = byId(
      assessReadiness(base({ searchServices: ['open-cluster-management/search-search-api'] })),
      'search'
    );
    expect(partial.status).toBe('partial');
    expect(byId(assessReadiness(base({ searchServices: [] })), 'search').status).toBe('missing');
  });
});

describe('argoNamespaces', () => {
  it('collects distinct namespaces from GitOpsClusters, secrets and ApplicationSets', () => {
    const gitops = [
      {
        metadata: { name: 'g', namespace: 'ocm' },
        spec: { argoServer: { argoNamespace: 'argocd' } },
      },
    ] as unknown as GitOpsClusterJson[];
    const secrets = [{ name: 's', namespace: 'openshift-gitops', ocmManaged: true }];
    expect(argoNamespaces(gitops, secrets, ['argocd'])).toEqual(['argocd', 'openshift-gitops']);
  });
});
