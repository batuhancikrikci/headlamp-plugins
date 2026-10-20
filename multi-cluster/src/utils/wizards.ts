/**
 * Pure resource builders shared by the wizards. Every wizard turns its state into an ordered
 * list of objects that the review step shows as YAML and applies.
 */
import { CLUSTER_SET_LABEL } from '../resources/models/cluster';
import { KubeJson, LabelSelector } from '../resources/models/common';
import { PlacementSpec } from '../resources/models/placement';

/** ManagedClusterSetBindings for the requested sets that are not bound to the namespace yet. */
export function missingBindings(
  sets: string[],
  bound: string[],
  namespace: string,
  apiVersion: string
): KubeJson[] {
  return Array.from(new Set(sets))
    .filter(s => !bound.includes(s))
    .map(set => ({
      apiVersion,
      kind: 'ManagedClusterSetBinding',
      // The binding must be named after the set.
      metadata: { name: set, namespace },
      spec: { clusterSet: set },
    }));
}

/** State of the "choose or create a placement" step used by several wizards. */
export interface PlacementChoice {
  mode: 'existing' | 'new';
  name: string;
  /** Spec of a new placement. */
  spec: PlacementSpec;
  /** Create bindings for requested sets that are not bound to the namespace. */
  createBindings: boolean;
}

export function emptyPlacementChoice(): PlacementChoice {
  return { mode: 'new', name: '', spec: { clusterSets: [] }, createBindings: true };
}

/** Simple label predicate (the wizards offer the full editor as well). */
export function labelPredicate(selector: LabelSelector | undefined): PlacementSpec['predicates'] {
  if (!selector) return undefined;
  return [{ requiredClusterSelector: { labelSelector: selector } }];
}

/** Resources for a placement choice: missing bindings, then the new placement. */
export function placementResources(
  choice: PlacementChoice,
  namespace: string,
  bound: string[],
  versions: { placement: string; binding: string }
): KubeJson[] {
  if (choice.mode === 'existing') return [];
  const bindings = choice.createBindings
    ? missingBindings(choice.spec.clusterSets || [], bound, namespace, versions.binding)
    : [];
  const spec: PlacementSpec = { ...choice.spec };
  if (!spec.clusterSets || spec.clusterSets.length === 0) delete spec.clusterSets;
  return [
    ...bindings,
    {
      apiVersion: versions.placement,
      kind: 'Placement',
      metadata: { name: choice.name, namespace },
      spec,
    },
  ];
}

export interface ImportClusterState {
  name: string;
  labels: Record<string, string>;
  clusterSet?: string;
  url?: string;
  addons: string[];
  /** addon v1alpha1 only. */
  installNamespace?: string;
}

/**
 * Resources of the import wizard: the ManagedCluster (accepted) and, when add-ons are chosen,
 * the cluster namespace (normally created by the hub on acceptance; creating it up front lets
 * the add-ons be applied in the same step) and one ManagedClusterAddOn per add-on.
 */
export function importClusterResources(
  state: ImportClusterState,
  versions: { cluster: string; addon?: string }
): KubeJson[] {
  const labels: Record<string, string> = { ...state.labels };
  if (state.clusterSet) labels[CLUSTER_SET_LABEL] = state.clusterSet;
  const cluster: KubeJson = {
    apiVersion: versions.cluster,
    kind: 'ManagedCluster',
    metadata: { name: state.name, ...(Object.keys(labels).length > 0 ? { labels } : {}) },
    spec: {
      hubAcceptsClient: true,
      ...(state.url ? { managedClusterClientConfigs: [{ url: state.url }] } : {}),
    },
  };
  if (state.addons.length === 0 || !versions.addon) return [cluster];
  const v1alpha1 = versions.addon.endsWith('/v1alpha1');
  return [
    cluster,
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: state.name } },
    ...state.addons.map(addon => ({
      apiVersion: versions.addon!,
      kind: 'ManagedClusterAddOn',
      metadata: { name: addon, namespace: state.name },
      spec: v1alpha1 && state.installNamespace ? { installNamespace: state.installNamespace } : {},
    })),
  ];
}

/** `clusteradm join` command for the managed cluster (token from `clusteradm get token`). */
export function joinCommand(cluster: string, hubURL?: string): string {
  return [
    'clusteradm join \\',
    '  --hub-token <token from "clusteradm get token" on the hub> \\',
    `  --hub-apiserver ${hubURL || '<hub API server URL>'} \\`,
    `  --cluster-name ${cluster || '<cluster name>'}`,
  ].join('\n');
}

/** One ManifestWork per cluster, each in the cluster's namespace. */
export function manifestWorksForClusters(
  name: string,
  clusters: string[],
  spec: KubeJson['spec'],
  apiVersion: string
): KubeJson[] {
  return clusters.map(cluster => ({
    apiVersion,
    kind: 'ManifestWork',
    metadata: { name, namespace: cluster },
    spec: JSON.parse(JSON.stringify(spec || {})),
  }));
}
