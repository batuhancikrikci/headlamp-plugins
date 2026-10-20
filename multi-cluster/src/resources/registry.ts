/**
 * UI registry: sidebar sections, and per kind the resource class, labels, icon, description,
 * documentation link and routes.
 */
import { KindMeta, KINDS, SectionId } from '../api/kinds';
import { SIDEBAR_ROOT, URL_PREFIX } from '../routes';
import { OcmClass, OcmObject } from './base';

export interface SectionInfo {
  id: SectionId;
  /** URL segment below the plugin prefix. */
  slug: string;
  label: string;
  icon: string;
  description: string;
}

/** Sidebar sections in display order, grouped by user intent. */
export const SECTIONS: SectionInfo[] = [
  {
    id: 'clusters',
    slug: 'clusters',
    label: 'Clusters',
    icon: 'mdi:server-network',
    description: 'Managed clusters, their registration requests and cluster profiles.',
  },
  {
    id: 'clustersets',
    slug: 'cluster-sets',
    label: 'Cluster Sets',
    icon: 'mdi:select-group',
    description: 'Groups of clusters and the namespaces they are bound to.',
  },
  {
    id: 'placements',
    slug: 'placements',
    label: 'Placements',
    icon: 'mdi:target',
    description: 'Rules that select clusters, and the decisions the scheduler made.',
  },
  {
    id: 'workloads',
    slug: 'workloads',
    label: 'Workloads',
    icon: 'mdi:package-variant-closed',
    description: 'Kubernetes resources distributed to managed clusters with ManifestWorks.',
  },
  {
    id: 'applications',
    slug: 'applications',
    label: 'Applications',
    icon: 'mdi:apps',
    description: 'Application subscriptions to Git, Helm and object bucket channels.',
  },
  {
    id: 'gitops',
    slug: 'gitops',
    label: 'GitOps',
    icon: 'mdi:source-branch-sync',
    description: 'Argo CD integration: register managed clusters in Argo CD.',
  },
  {
    id: 'governance',
    slug: 'governance',
    label: 'Governance',
    icon: 'mdi:shield-check-outline',
    description: 'Policies, policy sets and their compliance across managed clusters.',
  },
  {
    id: 'addons',
    slug: 'addons',
    label: 'Add-ons',
    icon: 'mdi:puzzle-outline',
    description: 'Add-ons available on the hub and installed on managed clusters.',
  },
  {
    id: 'settings',
    slug: 'settings',
    label: 'Hub Settings',
    icon: 'mdi:cog-outline',
    description: 'Cluster manager and agent configuration.',
  },
];

const DOCS = 'https://open-cluster-management.io/docs';

export interface CRDInfo extends KindMeta {
  cls: OcmClass;
  /** Singular label for buttons and titles. */
  label: string;
  /** Plural label for list titles. */
  labelPlural: string;
  /** Short tab label inside the section page. */
  tabLabel: string;
  icon: string;
  description: string;
  /** Written by controllers or agents: no create and no form editing. */
  readOnly: boolean;
  /** Superseded API kept for existing objects (PlacementRule). */
  legacy?: string;
  docsUrl?: string;
}

interface Seed {
  label: string;
  labelPlural: string;
  tabLabel: string;
  icon: string;
  description: string;
  readOnly?: boolean;
  legacy?: string;
  docsUrl?: string;
}

const SEEDS: Record<string, Seed> = {
  ManagedCluster: {
    label: 'Managed Cluster',
    labelPlural: 'Managed Clusters',
    tabLabel: 'Managed Clusters',
    icon: 'mdi:server-network',
    description: 'A Kubernetes cluster registered with this hub.',
    docsUrl: `${DOCS}/concepts/cluster-inventory/managedcluster/`,
  },
  CertificateSigningRequest: {
    label: 'Certificate Request',
    labelPlural: 'Cluster Certificate Requests',
    tabLabel: 'Certificate Requests',
    icon: 'mdi:certificate-outline',
    description: 'Registration and renewal requests from cluster agents (CSRs).',
    docsUrl: `${DOCS}/getting-started/installation/register-a-cluster/`,
  },
  ClusterProfile: {
    label: 'Cluster Profile',
    labelPlural: 'Cluster Profiles',
    tabLabel: 'Cluster Profiles',
    icon: 'mdi:card-account-details-outline',
    description: 'Cluster inventory API (multicluster.x-k8s.io) maintained by the hub.',
    readOnly: true,
    docsUrl: `${DOCS}/scenarios/clusterprofile-access-providers/`,
  },
  ManagedClusterSet: {
    label: 'Cluster Set',
    labelPlural: 'Managed Cluster Sets',
    tabLabel: 'Cluster Sets',
    icon: 'mdi:select-group',
    description: 'A group of managed clusters that can be bound to namespaces.',
    docsUrl: `${DOCS}/concepts/cluster-inventory/managedclusterset/`,
  },
  ManagedClusterSetBinding: {
    label: 'Cluster Set Binding',
    labelPlural: 'Managed Cluster Set Bindings',
    tabLabel: 'Bindings',
    icon: 'mdi:link-variant',
    description: 'Makes a cluster set usable by placements in a namespace.',
    docsUrl: `${DOCS}/concepts/cluster-inventory/managedclusterset/`,
  },
  Placement: {
    label: 'Placement',
    labelPlural: 'Placements',
    tabLabel: 'Placements',
    icon: 'mdi:target',
    description: 'Selects managed clusters from bound cluster sets.',
    docsUrl: `${DOCS}/concepts/content-placement/placement/`,
  },
  PlacementDecision: {
    label: 'Placement Decision',
    labelPlural: 'Placement Decisions',
    tabLabel: 'Decisions',
    icon: 'mdi:check-decagram-outline',
    description: 'Clusters selected by a placement (written by the scheduler).',
    readOnly: true,
    docsUrl: `${DOCS}/concepts/content-placement/placement/`,
  },
  AddOnPlacementScore: {
    label: 'Add-on Placement Score',
    labelPlural: 'Add-on Placement Scores',
    tabLabel: 'Add-on Scores',
    icon: 'mdi:scoreboard-outline',
    description: 'Scores published by add-ons for placement prioritizers.',
    readOnly: true,
    docsUrl: `${DOCS}/scenarios/extend-multicluster-scheduling-capabilities/`,
  },
  PlacementRule: {
    label: 'Placement Rule',
    labelPlural: 'Placement Rules',
    tabLabel: 'Placement Rules',
    icon: 'mdi:target-variant',
    description: 'Legacy cluster selection used by older subscriptions.',
    legacy:
      'PlacementRule is the legacy cluster selector of the application add-on. New subscriptions should reference a Placement (cluster.open-cluster-management.io).',
  },
  ManifestWork: {
    label: 'ManifestWork',
    labelPlural: 'ManifestWorks',
    tabLabel: 'ManifestWorks',
    icon: 'mdi:package-variant-closed',
    description: 'Kubernetes resources applied to one managed cluster.',
    docsUrl: `${DOCS}/concepts/work-distribution/manifestwork/`,
  },
  ManifestWorkReplicaSet: {
    label: 'ManifestWork Replica Set',
    labelPlural: 'ManifestWork Replica Sets',
    tabLabel: 'Replica Sets',
    icon: 'mdi:package-variant',
    description: 'Fans a ManifestWork out to the clusters selected by placements.',
    docsUrl: `${DOCS}/concepts/work-distribution/manifestworkreplicaset/`,
  },
  Subscription: {
    label: 'Subscription',
    labelPlural: 'Subscriptions',
    tabLabel: 'Subscriptions',
    icon: 'mdi:apps',
    description: 'Deploys the content of a channel to the clusters of a placement.',
    docsUrl: `${DOCS}/getting-started/integration/app-lifecycle/`,
  },
  Channel: {
    label: 'Channel',
    labelPlural: 'Channels',
    tabLabel: 'Channels',
    icon: 'mdi:source-repository',
    description: 'A Git repository, Helm repository or object bucket to subscribe to.',
    docsUrl: `${DOCS}/getting-started/integration/app-lifecycle/`,
  },
  Application: {
    label: 'Argo CD Application',
    labelPlural: 'Argo CD Applications',
    tabLabel: 'Argo CD Applications',
    icon: 'mdi:rocket-launch-outline',
    description: 'Argo CD applications: sync and health of Git / Helm sources on clusters.',
    docsUrl: 'https://argo-cd.readthedocs.io/en/stable/core_concepts/',
  },
  ApplicationSet: {
    label: 'ApplicationSet',
    labelPlural: 'Argo CD ApplicationSets',
    tabLabel: 'ApplicationSets',
    icon: 'mdi:rocket-launch',
    description: 'Generates one Argo CD application per cluster selected by a placement.',
    docsUrl: `${DOCS}/scenarios/integration-with-argocd/`,
  },
  HelmRelease: {
    label: 'Helm Release',
    labelPlural: 'Helm Releases',
    tabLabel: 'Helm Releases',
    icon: 'mdi:ship-wheel',
    description: 'Helm releases created by subscriptions to Helm channels.',
    readOnly: true,
  },
  SubscriptionReport: {
    label: 'Subscription Report',
    labelPlural: 'Subscription Reports',
    tabLabel: 'Reports',
    icon: 'mdi:clipboard-text-outline',
    description: 'Deployment results per application or per cluster.',
    readOnly: true,
  },
  SubscriptionStatus: {
    label: 'Subscription Status',
    labelPlural: 'Subscription Statuses',
    tabLabel: 'Statuses',
    icon: 'mdi:list-status',
    description: 'Per-package deployment status reported by managed clusters.',
    readOnly: true,
  },
  GitOpsCluster: {
    label: 'GitOps Cluster',
    labelPlural: 'GitOps Clusters',
    tabLabel: 'GitOps Clusters',
    icon: 'mdi:source-branch-sync',
    description: 'Registers the clusters of a placement in an Argo CD instance.',
    docsUrl: `${DOCS}/scenarios/integration-with-argocd/`,
  },
  MulticlusterApplicationSetReport: {
    label: 'ApplicationSet Report',
    labelPlural: 'Multicluster ApplicationSet Reports',
    tabLabel: 'ApplicationSet Reports',
    icon: 'mdi:clipboard-pulse-outline',
    description: 'Health and sync status of an Argo CD ApplicationSet across clusters.',
    readOnly: true,
  },
  AppProject: {
    label: 'Argo CD Project',
    labelPlural: 'Argo CD Projects',
    tabLabel: 'Argo CD Projects',
    icon: 'mdi:folder-key-outline',
    description: 'Argo CD projects: allowed sources, destinations and resources.',
    docsUrl: 'https://argo-cd.readthedocs.io/en/stable/user-guide/projects/',
  },
  ManagedServiceAccount: {
    label: 'Managed Service Account',
    labelPlural: 'Managed Service Accounts',
    tabLabel: 'Service Accounts',
    icon: 'mdi:account-key-outline',
    description: 'Service account tokens of managed clusters projected to the hub.',
    docsUrl: `${DOCS}/getting-started/integration/managed-serviceaccount/`,
  },
  ClusterPermission: {
    label: 'Cluster Permission',
    labelPlural: 'Cluster Permissions',
    tabLabel: 'Cluster Permissions',
    icon: 'mdi:shield-account-outline',
    description: 'RBAC created on a managed cluster from the hub.',
  },
  Policy: {
    label: 'Policy',
    labelPlural: 'Policies',
    tabLabel: 'Policies',
    icon: 'mdi:shield-check-outline',
    description:
      'Configuration, operator and other policy templates delivered to the clusters of a placement.',
    docsUrl: `${DOCS}/getting-started/integration/policy-controllers/policy/`,
  },
  PolicySet: {
    label: 'Policy Set',
    labelPlural: 'Policy Sets',
    tabLabel: 'Policy Sets',
    icon: 'mdi:shield-star-outline',
    description: 'A group of policies placed and reported together.',
    docsUrl: `${DOCS}/getting-started/integration/policy-controllers/policy/`,
  },
  PlacementBinding: {
    label: 'Placement Binding',
    labelPlural: 'Placement Bindings',
    tabLabel: 'Placement Bindings',
    icon: 'mdi:link-lock',
    description: 'Binds policies and policy sets to a placement.',
    docsUrl: `${DOCS}/getting-started/integration/policy-controllers/policy/`,
  },
  PolicyAutomation: {
    label: 'Policy Automation',
    labelPlural: 'Policy Automations',
    tabLabel: 'Automations',
    icon: 'mdi:robot-industrial-outline',
    description: 'Runs an Ansible Automation Platform job when a policy becomes non-compliant.',
  },
  ConfigurationPolicy: {
    label: 'Configuration Policy',
    labelPlural: 'Configuration Policies',
    tabLabel: 'Configuration Policies',
    icon: 'mdi:file-cog-outline',
    description:
      'Configuration policies evaluated on this cluster by the config policy controller.',
    readOnly: true,
    docsUrl: `${DOCS}/getting-started/integration/policy-controllers/configuration-policy/`,
  },
  OperatorPolicy: {
    label: 'Operator Policy',
    labelPlural: 'Operator Policies',
    tabLabel: 'Operator Policies',
    icon: 'mdi:package-variant-closed-check',
    description: 'OLM operator policies evaluated on this cluster.',
    readOnly: true,
    docsUrl: `${DOCS}/getting-started/integration/policy-controllers/operator-policy/`,
  },
  ClusterManagementAddOn: {
    label: 'Cluster Add-on',
    labelPlural: 'Cluster Management Add-ons',
    tabLabel: 'Available Add-ons',
    icon: 'mdi:puzzle-outline',
    description: 'An add-on registered on the hub and how it is installed.',
    docsUrl: `${DOCS}/concepts/add-on-extensibility/addon/`,
  },
  ManagedClusterAddOn: {
    label: 'Installed Add-on',
    labelPlural: 'Managed Cluster Add-ons',
    tabLabel: 'Installed Add-ons',
    icon: 'mdi:puzzle-check-outline',
    description: 'An add-on installed on one managed cluster.',
    docsUrl: `${DOCS}/concepts/add-on-extensibility/addon/`,
  },
  AddOnDeploymentConfig: {
    label: 'Add-on Deployment Config',
    labelPlural: 'Add-on Deployment Configs',
    tabLabel: 'Deployment Configs',
    icon: 'mdi:tune-variant',
    description: 'Install namespace, node placement, proxy and registry settings for add-ons.',
    docsUrl: `${DOCS}/getting-started/installation/addon-management/`,
  },
  AddOnTemplate: {
    label: 'Add-on Template',
    labelPlural: 'Add-on Templates',
    tabLabel: 'Templates',
    icon: 'mdi:file-document-multiple-outline',
    description: 'Template-based add-ons that need no add-on manager code.',
    docsUrl: `${DOCS}/concepts/add-on-extensibility/addon/`,
  },
  ClusterManager: {
    label: 'Cluster Manager',
    labelPlural: 'Cluster Managers',
    tabLabel: 'Cluster Manager',
    icon: 'mdi:hub-outline',
    description: 'Hub control plane configuration (registration, work, placement, add-ons).',
    docsUrl: `${DOCS}/concepts/architecture/`,
  },
  Klusterlet: {
    label: 'Klusterlet',
    labelPlural: 'Klusterlets',
    tabLabel: 'Klusterlet',
    icon: 'mdi:robot-outline',
    description: 'Agent configuration of this cluster when it is itself managed.',
    docsUrl: `${DOCS}/concepts/architecture/`,
  },
  ClusterClaim: {
    label: 'Cluster Claim',
    labelPlural: 'Cluster Claims',
    tabLabel: 'Cluster Claims',
    icon: 'mdi:tag-text-outline',
    description: 'Facts this cluster reports about itself to its hub.',
    docsUrl: `${DOCS}/concepts/cluster-inventory/clusterclaim/`,
  },
  ClusterProperty: {
    label: 'Cluster Property',
    labelPlural: 'Cluster Properties',
    tabLabel: 'Cluster Properties',
    icon: 'mdi:tag-multiple-outline',
    description: 'About API (about.k8s.io) properties of this cluster.',
  },
  AppliedManifestWork: {
    label: 'Applied ManifestWork',
    labelPlural: 'Applied ManifestWorks',
    tabLabel: 'Applied Works',
    icon: 'mdi:package-down',
    description: 'ManifestWorks the local agent applied to this cluster.',
    readOnly: true,
  },
};

/** Route name of a kind's detail page. */
export function detailRouteName(meta: Pick<KindMeta, 'plural'>): string {
  return `${SIDEBAR_ROOT}-${meta.plural}-detail`;
}

function makeClass(meta: KindMeta): OcmClass {
  class Resource extends OcmObject {
    static kind = meta.kind;
    static apiName = meta.plural;
    static apiVersion: string | string[] = `${meta.group}/${meta.versions[0]}`;
    static isNamespaced = meta.namespaced;

    static get detailsRoute() {
      return detailRouteName(meta);
    }
  }
  return Resource as OcmClass;
}

export const CRDS: CRDInfo[] = KINDS.map(meta => {
  const seed = SEEDS[meta.kind];
  if (!seed) throw new Error(`Missing registry entry for ${meta.kind}`);
  return { ...meta, ...seed, readOnly: !!seed.readOnly, cls: makeClass(meta) };
});

const BY_KIND = new Map(CRDS.map(c => [c.kind, c]));
const BY_PLURAL = new Map(CRDS.map(c => [c.plural, c]));

export function crd(kind: string): CRDInfo {
  const info = BY_KIND.get(kind);
  if (!info) throw new Error(`Unknown kind: ${kind}`);
  return info;
}

export function crdByKind(kind: string): CRDInfo | undefined {
  return BY_KIND.get(kind);
}

export function crdByPlural(plural: string): CRDInfo | undefined {
  return BY_PLURAL.get(plural);
}

export function sectionById(id: SectionId): SectionInfo {
  return SECTIONS.find(s => s.id === id)!;
}

export function crdsOfSection(id: SectionId): CRDInfo[] {
  return CRDS.filter(c => c.section === id);
}

/** Route (and sidebar entry) name of a section page. */
export function sectionRouteName(id: SectionId): string {
  return `${SIDEBAR_ROOT}-${id}`;
}

export function sectionPath(id: SectionId): string {
  return `${URL_PREFIX}/${sectionById(id).slug}`;
}

export function listPath(info: CRDInfo): string {
  return `${sectionPath(info.section)}/${info.plural}`;
}

export function detailPath(info: CRDInfo): string {
  return info.namespaced ? `${listPath(info)}/:namespace/:name` : `${listPath(info)}/:name`;
}
