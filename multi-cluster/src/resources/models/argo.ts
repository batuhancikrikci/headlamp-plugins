/**
 * Argo CD (argoproj.io/v1alpha1) Application, ApplicationSet and AppProject models, and the OCM
 * integration around them (multicloud-integrations):
 *
 * - push model: the GitOpsCluster controller registers the clusters of a placement as Argo CD
 *   cluster secrets; ApplicationSets use the `clusterDecisionResource` generator with the
 *   `acm-placement` ConfigMap to create one Application per decided cluster.
 * - pull model: hub Applications labelled `apps.open-cluster-management.io/pull-to-ocm-managed-cluster`
 *   are not reconciled on the hub; the propagation controller wraps them in a ManifestWork for
 *   the cluster named by the `ocm-managed-cluster` annotation.
 *
 * Field names follow the Argo CD CRDs v2.10.0 – v3.5.0 and the multicloud-integrations sources.
 */
import { Condition, Health, KubeJson, LabelSelector } from './common';
import { PLACEMENT_LABEL } from './placement';

export const ARGO_GROUP = 'argoproj.io';

/** Argo CD's refresh request annotation (`AnnotationKeyRefresh`). */
export const REFRESH_ANNOTATION = 'argocd.argoproj.io/refresh';
export const SKIP_RECONCILE_ANNOTATION = 'argocd.argoproj.io/skip-reconcile';
export const ARGO_SECRET_TYPE_LABEL = 'argocd.argoproj.io/secret-type';

/** Labels and annotations of the OCM integration (multicloud-integrations). */
export const OCM_ARGO = {
  pullLabel: 'apps.open-cluster-management.io/pull-to-ocm-managed-cluster',
  managedClusterAnnotation: 'apps.open-cluster-management.io/ocm-managed-cluster',
  appNamespaceAnnotation: 'apps.open-cluster-management.io/ocm-managed-cluster-app-namespace',
  hubAppNamespaceAnnotation: 'apps.open-cluster-management.io/hub-application-namespace',
  hubAppNameAnnotation: 'apps.open-cluster-management.io/hub-application-name',
  acmClusterLabel: 'apps.open-cluster-management.io/acm-cluster',
  clusterNameLabel: 'apps.open-cluster-management.io/cluster-name',
  clusterServerLabel: 'apps.open-cluster-management.io/cluster-server',
  /** ConfigMaps created by the GitOpsCluster controller for the clusterDecisionResource generator. */
  placementConfigMap: 'acm-placement',
  placementRuleConfigMap: 'acm-placementrule',
  /** ConfigMap installed by argocd-pull-integration (basic pull model and argocd-agent). */
  pullIntegrationConfigMap: 'ocm-placement-generator',
} as const;

// ----- Application -----

export interface ArgoSource {
  repoURL: string;
  path?: string;
  chart?: string;
  targetRevision?: string;
  ref?: string;
  name?: string;
}

export interface ArgoDestination {
  server?: string;
  name?: string;
  namespace?: string;
}

export interface ArgoSyncPolicy {
  automated?: { prune?: boolean; selfHeal?: boolean; allowEmpty?: boolean; enabled?: boolean };
  syncOptions?: string[];
  retry?: unknown;
}

export interface ArgoApplicationSpec {
  project: string;
  source?: ArgoSource;
  sources?: ArgoSource[];
  destination: ArgoDestination;
  syncPolicy?: ArgoSyncPolicy;
}

export interface ArgoApplicationJson extends KubeJson {
  spec?: ArgoApplicationSpec;
  operation?: {
    sync?: { revision?: string; prune?: boolean; dryRun?: boolean; syncOptions?: string[] };
    initiatedBy?: { username?: string; automated?: boolean };
  };
  status?: {
    sync?: { status?: string; revision?: string; revisions?: string[] };
    health?: { status?: string; message?: string };
    operationState?: {
      phase?: string;
      message?: string;
      startedAt?: string;
      finishedAt?: string;
    };
    conditions?: Array<{ type: string; message?: string; lastTransitionTime?: string }>;
    history?: Array<{
      id: number;
      revision?: string;
      revisions?: string[];
      deployedAt: string;
      initiatedBy?: { username?: string; automated?: boolean };
    }>;
    resources?: Array<{
      group?: string;
      kind?: string;
      name?: string;
      namespace?: string;
      status?: string;
      health?: { status?: string; message?: string };
    }>;
    summary?: { images?: string[]; externalURLs?: string[] };
    reconciledAt?: string;
    sourceType?: string;
  };
}

/** Sync status codes (`SyncStatusCode`). */
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Unknown' | string;
/** Health status codes (gitops-engine `HealthStatusCode`). */
export type HealthStatus =
  | 'Healthy'
  | 'Progressing'
  | 'Suspended'
  | 'Degraded'
  | 'Missing'
  | 'Unknown'
  | string;

export function syncStatus(app: ArgoApplicationJson): SyncStatus {
  return app.status?.sync?.status || 'Unknown';
}

export function healthStatus(app: ArgoApplicationJson): HealthStatus {
  return app.status?.health?.status || 'Unknown';
}

export function syncHealth(status: SyncStatus): Health {
  if (status === 'Synced') return 'success';
  if (status === 'OutOfSync') return 'warning';
  return 'unknown';
}

export function argoHealth(status: HealthStatus): Health {
  switch (status) {
    case 'Healthy':
      return 'success';
    case 'Degraded':
    case 'Missing':
      return 'error';
    case 'Progressing':
    case 'Suspended':
      return 'unknown';
    default:
      return 'warning';
  }
}

/** Phase of the last (or running) operation, e.g. Running, Succeeded, Failed, Error. */
export function operationPhase(app: ArgoApplicationJson): string | undefined {
  return app.status?.operationState?.phase;
}

export function isOperationFailed(app: ArgoApplicationJson): boolean {
  const phase = operationPhase(app);
  return phase === 'Failed' || phase === 'Error';
}

/** Sources of single- and multi-source applications. */
export function appSources(
  spec: Pick<ArgoApplicationSpec, 'source' | 'sources'> | undefined
): ArgoSource[] {
  if (!spec) return [];
  if (spec.sources && spec.sources.length > 0) return spec.sources;
  return spec.source ? [spec.source] : [];
}

/** "repo › path @ revision" (or chart) of a source. */
export function sourceText(source: ArgoSource): string {
  const what = source.chart ? `${source.chart}` : source.path || '.';
  return `${source.repoURL} › ${what}${source.targetRevision ? ` @ ${source.targetRevision}` : ''}`;
}

/** The application is deployed with the OCM pull model (not reconciled by the hub Argo CD). */
export function isPullModel(app: { metadata: { labels?: Record<string, string> } }): boolean {
  return (app.metadata.labels?.[OCM_ARGO.pullLabel] || '').toLowerCase() === 'true';
}

/** Managed cluster of a pull-model application. */
export function pullTargetCluster(app: {
  metadata: { annotations?: Record<string, string> };
}): string | undefined {
  return app.metadata.annotations?.[OCM_ARGO.managedClusterAnnotation] || undefined;
}

// ----- Argo CD cluster secrets -----

export interface ArgoClusterSecret {
  name: string;
  namespace: string;
  /** Managed cluster name (OCM-created secrets carry it as a label). */
  cluster?: string;
  /** API server host from the `cluster-server` label (a dummy value for blank pull-model secrets). */
  serverLabel?: string;
  /** Created by the GitOpsCluster controller. */
  ocmManaged: boolean;
}

/**
 * Cluster secret info from metadata only: the plugin never reads or shows credentials.
 */
export function clusterSecretInfo(secret: { metadata: KubeJson['metadata'] }): ArgoClusterSecret {
  const labels = secret.metadata.labels || {};
  return {
    name: secret.metadata.name,
    namespace: secret.metadata.namespace || '',
    cluster: labels[OCM_ARGO.clusterNameLabel] || undefined,
    serverLabel: labels[OCM_ARGO.clusterServerLabel] || undefined,
    ocmManaged: labels[OCM_ARGO.acmClusterLabel] === 'true',
  };
}

/**
 * Managed cluster an application deploys to: the pull-model annotation, or the Argo CD cluster
 * whose secret (in the application's Argo CD namespace) matches the destination name. Argo CD
 * names OCM-registered clusters after the managed cluster.
 */
export function destinationCluster(
  app: ArgoApplicationJson,
  secrets: ArgoClusterSecret[]
): string | undefined {
  const pull = isPullModel(app) ? pullTargetCluster(app) : undefined;
  if (pull) return pull;
  const dest = app.spec?.destination;
  if (!dest) return undefined;
  const inNs = secrets.filter(s => s.namespace === app.metadata.namespace);
  if (dest.name) {
    return inNs.find(s => s.cluster === dest.name)?.cluster || undefined;
  }
  if (dest.server) {
    const host = serverHost(dest.server);
    return inNs.find(s => s.serverLabel && s.serverLabel === host)?.cluster || undefined;
  }
  return undefined;
}

/**
 * Host part of an API server URL, the way the GitOpsCluster controller writes the
 * `cluster-server` label (scheme and port removed, at most 63 characters).
 */
export function serverHost(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, '');
  const host = withoutScheme.split('/')[0].split(':')[0];
  return host.slice(0, 63);
}

// ----- ApplicationSet -----

export interface ClusterDecisionGenerator {
  configMapRef: string;
  labelSelector?: LabelSelector;
  name?: string;
  requeueAfterSeconds?: number;
  values?: Record<string, string>;
}

export interface ArgoApplicationSetJson extends KubeJson {
  spec?: {
    goTemplate?: boolean;
    generators?: Array<{
      clusterDecisionResource?: ClusterDecisionGenerator;
      [key: string]: unknown;
    }>;
    template?: {
      metadata?: {
        name?: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
      };
      spec?: ArgoApplicationSpec;
    };
    syncPolicy?: { applicationsSync?: string; preserveResourcesOnDeletion?: boolean };
    strategy?: { type?: string };
  };
  status?: {
    conditions?: Array<Condition & { type: string }>;
    resources?: Array<{
      name?: string;
      namespace?: string;
      status?: string;
      health?: { status?: string };
    }>;
    applicationStatus?: Array<{
      application: string;
      status: string;
      message: string;
      step: string;
    }>;
    health?: { status?: string; message?: string };
    resourcesCount?: number;
  };
}

/** Generator types used by an ApplicationSet (keys of each generator). */
export function generatorTypes(appset: ArgoApplicationSetJson): string[] {
  return (appset.spec?.generators || []).flatMap(g =>
    Object.keys(g).filter(k => g[k] !== undefined)
  );
}

/**
 * Placements an ApplicationSet uses through `clusterDecisionResource` generators that select
 * PlacementDecisions by the placement label (top-level generators only).
 */
export function appSetPlacements(
  appset: ArgoApplicationSetJson
): Array<{ name: string; configMapRef: string }> {
  const out: Array<{ name: string; configMapRef: string }> = [];
  for (const g of appset.spec?.generators || []) {
    const cdr = g.clusterDecisionResource;
    const placement = cdr?.labelSelector?.matchLabels?.[PLACEMENT_LABEL];
    if (cdr && placement) out.push({ name: placement, configMapRef: cdr.configMapRef });
  }
  return out;
}

/** The ApplicationSet template deploys with the pull model. */
export function appSetIsPull(appset: ArgoApplicationSetJson): boolean {
  return (
    (appset.spec?.template?.metadata?.labels?.[OCM_ARGO.pullLabel] || '').toLowerCase() === 'true'
  );
}

/** Applications owned by an ApplicationSet (owner reference, same namespace). */
export function appsOfAppSet(
  appset: ArgoApplicationSetJson,
  apps: ArgoApplicationJson[]
): ArgoApplicationJson[] {
  return apps.filter(
    a =>
      a.metadata.namespace === appset.metadata.namespace &&
      (a.metadata.ownerReferences || []).some(
        o => o.kind === 'ApplicationSet' && o.name === appset.metadata.name
      )
  );
}

/** The ApplicationSet that owns an application, if any. */
export function owningAppSet(app: ArgoApplicationJson): string | undefined {
  return (app.metadata.ownerReferences || []).find(o => o.kind === 'ApplicationSet')?.name;
}

// ----- Actions -----

/** Merge patch requesting a refresh (`normal`) or a hard refresh (manifest cache bypass). */
export function refreshPatch(type: 'normal' | 'hard') {
  return { metadata: { annotations: { [REFRESH_ANNOTATION]: type } } };
}

/**
 * Merge patch that starts a sync by writing the `operation` field, as `argocd app sync` does.
 * The application controller picks it up and clears it when the operation completes.
 */
export function syncPatch(options: {
  revision?: string;
  prune?: boolean;
  dryRun?: boolean;
  username?: string;
}) {
  const sync: Record<string, unknown> = {};
  if (options.revision) sync.revision = options.revision;
  if (options.prune) sync.prune = true;
  if (options.dryRun) sync.dryRun = true;
  return {
    operation: {
      initiatedBy: { username: options.username || 'headlamp' },
      sync,
    },
  };
}

// ----- GitOps consistency -----

export interface GitOpsConsistency {
  /** Decided clusters without an Argo CD cluster secret (no application can target them). */
  missing: string[];
  /** OCM-managed secrets for clusters the placement no longer selects. */
  extra: string[];
  /** Secrets for decided clusters that were not created by OCM (the controller refuses these). */
  foreign: string[];
}

export function gitOpsConsistency(
  decided: string[],
  secretsInArgoNs: ArgoClusterSecret[]
): GitOpsConsistency {
  const ocm = secretsInArgoNs.filter(s => s.ocmManaged && s.cluster);
  const ocmClusters = new Set(ocm.map(s => s.cluster as string));
  const foreignSecrets = secretsInArgoNs.filter(s => !s.ocmManaged);
  return {
    missing: decided.filter(c => !ocmClusters.has(c)),
    extra: Array.from(ocmClusters)
      .filter(c => !decided.includes(c))
      .sort(),
    foreign: decided.filter(c => foreignSecrets.some(s => s.cluster === c || s.name === c)),
  };
}

// ----- Wizard -----

export interface ArgoDeployState {
  name: string;
  namespace: string;
  placement: string;
  project: string;
  repoURL: string;
  path?: string;
  chart?: string;
  targetRevision?: string;
  destinationNamespace: string;
  /**
   * push: hub Argo CD deploys through cluster secrets; pull: basic pull model (ManifestWork);
   * agent: argocd-agent, applications routed by destination name.
   */
  model: 'push' | 'pull' | 'agent';
  /** Generator ConfigMap (acm-placement for GitOpsCluster v1beta1, ocm-placement-generator otherwise). */
  configMapRef?: string;
  automated: boolean;
  prune: boolean;
  selfHeal: boolean;
  createNamespace: boolean;
  requeueAfterSeconds?: number;
}

/**
 * ApplicationSet with a clusterDecisionResource generator over the placement's decisions. The
 * generator provides `name` (the Argo CD cluster, named after the managed cluster) and `server`.
 * In the pull model the template is labelled for the propagation controller and skipped by the
 * hub Argo CD; the destination is the in-cluster API server of the managed cluster.
 */
export function buildApplicationSet(
  state: ArgoDeployState,
  apiVersion = `${ARGO_GROUP}/v1alpha1`
): ArgoApplicationSetJson {
  const pull = state.model === 'pull';
  const source: ArgoSource = { repoURL: state.repoURL };
  if (state.chart) source.chart = state.chart;
  else source.path = state.path || '.';
  if (state.targetRevision) source.targetRevision = state.targetRevision;
  const syncOptions = state.createNamespace ? ['CreateNamespace=true'] : undefined;
  const syncPolicy: ArgoSyncPolicy | undefined =
    state.automated || syncOptions
      ? {
          ...(state.automated
            ? {
                automated: {
                  ...(state.prune ? { prune: true } : {}),
                  ...(state.selfHeal ? { selfHeal: true } : {}),
                },
              }
            : {}),
          ...(syncOptions ? { syncOptions } : {}),
        }
      : undefined;
  const template: NonNullable<ArgoApplicationSetJson['spec']>['template'] = {
    metadata: {
      name: `{{name}}-${state.name}`,
      ...(pull
        ? {
            labels: { [OCM_ARGO.pullLabel]: 'true' },
            annotations: {
              [OCM_ARGO.managedClusterAnnotation]: '{{name}}',
              [SKIP_RECONCILE_ANNOTATION]: 'true',
            },
          }
        : {}),
    },
    spec: {
      project: state.project || 'default',
      source,
      destination: pull
        ? { server: 'https://kubernetes.default.svc', namespace: state.destinationNamespace }
        : state.model === 'agent'
        ? // argocd-agent routes applications to the agent by destination name.
          { name: '{{name}}', namespace: state.destinationNamespace }
        : { server: '{{server}}', namespace: state.destinationNamespace },
      ...(syncPolicy ? { syncPolicy } : {}),
    },
  };
  return {
    apiVersion,
    kind: 'ApplicationSet',
    metadata: { name: state.name, namespace: state.namespace },
    spec: {
      generators: [
        {
          clusterDecisionResource: {
            configMapRef: state.configMapRef || OCM_ARGO.placementConfigMap,
            labelSelector: { matchLabels: { [PLACEMENT_LABEL]: state.placement } },
            requeueAfterSeconds: state.requeueAfterSeconds ?? 180,
          },
        },
      ],
      template,
    },
  };
}

/**
 * Switches an ApplicationSet template between the push and the pull model: adds or removes the
 * pull label and annotations, and points the destination at the cluster's own API server (pull)
 * or at the generator's `{{server}}` parameter (push).
 */
export function withAppSetModel(
  appset: ArgoApplicationSetJson,
  model: 'push' | 'pull'
): ArgoApplicationSetJson {
  const copy = JSON.parse(JSON.stringify(appset)) as ArgoApplicationSetJson;
  const spec = (copy.spec = copy.spec || {});
  const template = (spec.template = spec.template || {});
  const meta = (template.metadata = template.metadata || {});
  const labels = { ...(meta.labels || {}) };
  const annotations = { ...(meta.annotations || {}) };
  if (model === 'pull') {
    labels[OCM_ARGO.pullLabel] = 'true';
    annotations[OCM_ARGO.managedClusterAnnotation] =
      annotations[OCM_ARGO.managedClusterAnnotation] || '{{name}}';
    annotations[SKIP_RECONCILE_ANNOTATION] = 'true';
  } else {
    delete labels[OCM_ARGO.pullLabel];
    delete annotations[OCM_ARGO.managedClusterAnnotation];
    delete annotations[OCM_ARGO.appNamespaceAnnotation];
    delete annotations[SKIP_RECONCILE_ANNOTATION];
  }
  if (Object.keys(labels).length > 0) meta.labels = labels;
  else delete meta.labels;
  if (Object.keys(annotations).length > 0) meta.annotations = annotations;
  else delete meta.annotations;
  if (template.spec) {
    const destination = { ...(template.spec.destination || {}) };
    delete destination.name;
    destination.server = model === 'pull' ? 'https://kubernetes.default.svc' : '{{server}}';
    template.spec = { ...template.spec, destination };
  }
  return copy;
}
