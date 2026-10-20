/**
 * Starting objects for the create dialogs and wizards. Defaults follow the CRD defaults; no
 * cluster or namespace names are hardcoded (the namespace is chosen by the caller).
 */
import { isNamespacedKind } from '../api/kinds';
import { KubeJson } from '../resources/models/common';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const initialSpecs: Record<string, (apiVersion: string) => Spec | undefined> = {
  ManagedCluster: () => ({ hubAcceptsClient: true }),
  ManagedClusterSet: () => ({ clusterSelector: { selectorType: 'ExclusiveClusterSetLabel' } }),
  ManagedClusterSetBinding: () => ({ clusterSet: '' }),
  ClusterClaim: () => ({ value: '' }),
  ClusterProperty: () => ({ value: '' }),
  Placement: () => ({ clusterSets: [] }),
  PlacementRule: () => ({ clusterSelector: { matchLabels: {} } }),
  ManifestWork: () => ({ workload: { manifests: [] } }),
  ManifestWorkReplicaSet: () => ({
    placementRefs: [{ name: '', rolloutStrategy: { type: 'All' } }],
    manifestWorkTemplate: { workload: { manifests: [] } },
  }),
  Subscription: () => ({ channel: '' }),
  Channel: () => ({ type: 'Git', pathname: '' }),
  GitOpsCluster: apiVersion =>
    apiVersion.endsWith('/v1alpha1')
      ? {
          placementRef: {
            kind: 'Placement',
            apiVersion: 'cluster.open-cluster-management.io/v1beta1',
            name: '',
          },
          argoCDAgentAddon: { mode: 'managed' },
        }
      : {
          argoServer: { argoNamespace: '' },
          placementRef: {
            kind: 'Placement',
            apiVersion: 'cluster.open-cluster-management.io/v1beta1',
            name: '',
          },
        },
  // spec.rotation is required in v1alpha1 and v1beta1.
  ManagedServiceAccount: () => ({ rotation: { enabled: true } }),
  ApplicationSet: () => ({
    generators: [
      {
        clusterDecisionResource: {
          configMapRef: 'acm-placement',
          labelSelector: { matchLabels: { 'cluster.open-cluster-management.io/placement': '' } },
          requeueAfterSeconds: 180,
        },
      },
    ],
    template: {
      metadata: { name: '{{name}}-' },
      spec: {
        project: 'default',
        source: { repoURL: '', path: '' },
        destination: { server: '{{server}}' },
      },
    },
  }),
  AppProject: () => ({ sourceRepos: [], destinations: [] }),
  Policy: () => ({ remediationAction: 'inform', disabled: false, 'policy-templates': [] }),
  PolicySet: () => ({ policies: [] }),
  PolicyAutomation: () => ({
    mode: 'once',
    eventHook: 'noncompliant',
    automationDef: { name: '', secret: '' },
  }),
  ClusterManagementAddOn: () => ({ addOnMeta: {}, installStrategy: { type: 'Manual' } }),
  ManagedClusterAddOn: () => ({}),
  AddOnDeploymentConfig: () => ({}),
};

/** A new, mostly empty object of the given kind for the create dialogs. */
export function newResource(kind: string, apiVersion: string, namespace?: string): KubeJson {
  const namespaced = isNamespacedKind(kind);
  const spec = initialSpecs[kind] ? initialSpecs[kind](apiVersion) : {};
  const json: KubeJson = {
    apiVersion,
    kind,
    metadata: namespaced ? { name: '', namespace: namespace || '' } : { name: '' },
  };
  if (kind === 'PlacementBinding') {
    // PlacementBinding keeps placementRef and subjects at the top level (no spec).
    json.placementRef = {
      apiGroup: 'cluster.open-cluster-management.io',
      kind: 'Placement',
      name: '',
    };
    json.subjects = [];
    return json;
  }
  if (spec !== undefined) json.spec = spec;
  return json;
}
