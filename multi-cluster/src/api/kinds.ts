/**
 * Every Kubernetes kind the plugin knows, with the API versions it supports. The data comes from
 * the upstream CRDs (see docs/API_MATRIX.md). This module is free of Headlamp imports so the
 * version selection logic built on it can be unit tested.
 */

export const GROUPS = {
  cluster: 'cluster.open-cluster-management.io',
  work: 'work.open-cluster-management.io',
  addon: 'addon.open-cluster-management.io',
  operator: 'operator.open-cluster-management.io',
  apps: 'apps.open-cluster-management.io',
  authentication: 'authentication.open-cluster-management.io',
  rbac: 'rbac.open-cluster-management.io',
  clusterProfile: 'multicluster.x-k8s.io',
  about: 'about.k8s.io',
  certificates: 'certificates.k8s.io',
  argo: 'argoproj.io',
  policy: 'policy.open-cluster-management.io',
} as const;

export type SectionId =
  | 'clusters'
  | 'clustersets'
  | 'placements'
  | 'workloads'
  | 'applications'
  | 'gitops'
  | 'governance'
  | 'addons'
  | 'settings';

export interface KindMeta {
  kind: string;
  group: string;
  plural: string;
  namespaced: boolean;
  /** Versions the plugin can work with, in no particular order. */
  versions: string[];
  section: SectionId;
}

/** Kinds in sidebar section and tab order. */
export const KINDS: KindMeta[] = [
  // Clusters
  {
    kind: 'ManagedCluster',
    group: GROUPS.cluster,
    plural: 'managedclusters',
    namespaced: false,
    versions: ['v1'],
    section: 'clusters',
  },
  {
    kind: 'CertificateSigningRequest',
    group: GROUPS.certificates,
    plural: 'certificatesigningrequests',
    namespaced: false,
    versions: ['v1'],
    section: 'clusters',
  },
  {
    kind: 'ClusterProfile',
    group: GROUPS.clusterProfile,
    plural: 'clusterprofiles',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'clusters',
  },
  // Cluster sets
  {
    kind: 'ManagedClusterSet',
    group: GROUPS.cluster,
    plural: 'managedclustersets',
    namespaced: false,
    versions: ['v1beta2'],
    section: 'clustersets',
  },
  {
    kind: 'ManagedClusterSetBinding',
    group: GROUPS.cluster,
    plural: 'managedclustersetbindings',
    namespaced: true,
    versions: ['v1beta2'],
    section: 'clustersets',
  },
  // Placements
  {
    kind: 'Placement',
    group: GROUPS.cluster,
    plural: 'placements',
    namespaced: true,
    versions: ['v1beta1'],
    section: 'placements',
  },
  {
    kind: 'PlacementDecision',
    group: GROUPS.cluster,
    plural: 'placementdecisions',
    namespaced: true,
    versions: ['v1beta1'],
    section: 'placements',
  },
  {
    kind: 'AddOnPlacementScore',
    group: GROUPS.cluster,
    plural: 'addonplacementscores',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'placements',
  },
  {
    kind: 'PlacementRule',
    group: GROUPS.apps,
    plural: 'placementrules',
    namespaced: true,
    versions: ['v1'],
    section: 'placements',
  },
  // Workloads
  {
    kind: 'ManifestWork',
    group: GROUPS.work,
    plural: 'manifestworks',
    namespaced: true,
    versions: ['v1'],
    section: 'workloads',
  },
  {
    kind: 'ManifestWorkReplicaSet',
    group: GROUPS.work,
    plural: 'manifestworkreplicasets',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'workloads',
  },
  // Applications
  {
    kind: 'Subscription',
    group: GROUPS.apps,
    plural: 'subscriptions',
    namespaced: true,
    versions: ['v1'],
    section: 'applications',
  },
  {
    kind: 'Channel',
    group: GROUPS.apps,
    plural: 'channels',
    namespaced: true,
    versions: ['v1'],
    section: 'applications',
  },
  {
    kind: 'Application',
    group: GROUPS.argo,
    plural: 'applications',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'applications',
  },
  {
    kind: 'ApplicationSet',
    group: GROUPS.argo,
    plural: 'applicationsets',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'applications',
  },
  {
    kind: 'HelmRelease',
    group: GROUPS.apps,
    plural: 'helmreleases',
    namespaced: true,
    versions: ['v1'],
    section: 'applications',
  },
  {
    kind: 'SubscriptionReport',
    group: GROUPS.apps,
    plural: 'subscriptionreports',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'applications',
  },
  {
    kind: 'SubscriptionStatus',
    group: GROUPS.apps,
    plural: 'subscriptionstatuses',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'applications',
  },
  // GitOps
  {
    kind: 'GitOpsCluster',
    group: GROUPS.apps,
    plural: 'gitopsclusters',
    namespaced: true,
    // v1beta1: multicloud-integrations (push); v1alpha1: argocd-pull-integration (argocd-agent).
    versions: ['v1beta1', 'v1alpha1'],
    section: 'gitops',
  },
  {
    kind: 'MulticlusterApplicationSetReport',
    group: GROUPS.apps,
    plural: 'multiclusterapplicationsetreports',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'gitops',
  },
  {
    kind: 'AppProject',
    group: GROUPS.argo,
    plural: 'appprojects',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'gitops',
  },
  {
    kind: 'ManagedServiceAccount',
    group: GROUPS.authentication,
    plural: 'managedserviceaccounts',
    namespaced: true,
    versions: ['v1beta1', 'v1alpha1'],
    section: 'gitops',
  },
  {
    kind: 'ClusterPermission',
    group: GROUPS.rbac,
    plural: 'clusterpermissions',
    namespaced: true,
    versions: ['v1alpha1'],
    section: 'gitops',
  },
  // Governance
  {
    kind: 'Policy',
    group: GROUPS.policy,
    plural: 'policies',
    namespaced: true,
    versions: ['v1'],
    section: 'governance',
  },
  {
    kind: 'PolicySet',
    group: GROUPS.policy,
    plural: 'policysets',
    namespaced: true,
    versions: ['v1beta1'],
    section: 'governance',
  },
  {
    kind: 'PlacementBinding',
    group: GROUPS.policy,
    plural: 'placementbindings',
    namespaced: true,
    versions: ['v1'],
    section: 'governance',
  },
  {
    kind: 'PolicyAutomation',
    group: GROUPS.policy,
    plural: 'policyautomations',
    namespaced: true,
    versions: ['v1beta1'],
    section: 'governance',
  },
  {
    kind: 'ConfigurationPolicy',
    group: GROUPS.policy,
    plural: 'configurationpolicies',
    namespaced: true,
    versions: ['v1'],
    section: 'governance',
  },
  {
    kind: 'OperatorPolicy',
    group: GROUPS.policy,
    plural: 'operatorpolicies',
    namespaced: true,
    versions: ['v1beta1'],
    section: 'governance',
  },
  // Add-ons
  {
    kind: 'ClusterManagementAddOn',
    group: GROUPS.addon,
    plural: 'clustermanagementaddons',
    namespaced: false,
    versions: ['v1beta1', 'v1alpha1'],
    section: 'addons',
  },
  {
    kind: 'ManagedClusterAddOn',
    group: GROUPS.addon,
    plural: 'managedclusteraddons',
    namespaced: true,
    versions: ['v1beta1', 'v1alpha1'],
    section: 'addons',
  },
  {
    kind: 'AddOnDeploymentConfig',
    group: GROUPS.addon,
    plural: 'addondeploymentconfigs',
    namespaced: true,
    versions: ['v1beta1', 'v1alpha1'],
    section: 'addons',
  },
  {
    kind: 'AddOnTemplate',
    group: GROUPS.addon,
    plural: 'addontemplates',
    namespaced: false,
    versions: ['v1alpha1'],
    section: 'addons',
  },
  // Hub settings
  {
    kind: 'ClusterManager',
    group: GROUPS.operator,
    plural: 'clustermanagers',
    namespaced: false,
    versions: ['v1'],
    section: 'settings',
  },
  {
    kind: 'Klusterlet',
    group: GROUPS.operator,
    plural: 'klusterlets',
    namespaced: false,
    versions: ['v1'],
    section: 'settings',
  },
  {
    kind: 'ClusterClaim',
    group: GROUPS.cluster,
    plural: 'clusterclaims',
    namespaced: false,
    versions: ['v1alpha1'],
    section: 'settings',
  },
  {
    kind: 'ClusterProperty',
    group: GROUPS.about,
    plural: 'clusterproperties',
    namespaced: false,
    versions: ['v1alpha1'],
    section: 'settings',
  },
  {
    kind: 'AppliedManifestWork',
    group: GROUPS.work,
    plural: 'appliedmanifestworks',
    namespaced: false,
    versions: ['v1'],
    section: 'settings',
  },
];

/** Unique key of a kind: `plural.group`, the same as its CRD name. */
export function kindKey(meta: Pick<KindMeta, 'plural' | 'group'>): string {
  return `${meta.plural}.${meta.group}`;
}

const BY_KIND = new Map(KINDS.map(k => [k.kind, k]));

export function kindMeta(kind: string): KindMeta {
  const meta = BY_KIND.get(kind);
  if (!meta) throw new Error(`Unknown kind: ${kind}`);
  return meta;
}

export function findKindMeta(kind: string): KindMeta | undefined {
  return BY_KIND.get(kind);
}

/** Whether objects of the kind live in a namespace. Unknown kinds are treated as namespaced. */
export function isNamespacedKind(kind: string): boolean {
  return BY_KIND.get(kind)?.namespaced ?? true;
}

/** API groups the plugin discovers. */
export function discoveredGroups(): string[] {
  return Array.from(new Set(KINDS.map(k => k.group)));
}
