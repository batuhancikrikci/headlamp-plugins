/**
 * Application lifecycle (apps.open-cluster-management.io, multicloud-operators-subscription)
 * and GitOps integration (multicloud-integrations) models.
 */
import { Condition, Health, KubeJson, LabelSelector, ObjectReference, toCount } from './common';

export const APPS_GROUP = 'apps.open-cluster-management.io';

/** Label that pauses a subscription (`apps/v1.LabelSubscriptionPause`). */
export const SUBSCRIPTION_PAUSE_LABEL = 'subscription-pause';

export const GIT_ANNOTATIONS = {
  branch: `${APPS_GROUP}/git-branch`,
  path: `${APPS_GROUP}/git-path`,
  tag: `${APPS_GROUP}/git-tag`,
  desiredCommit: `${APPS_GROUP}/git-desired-commit`,
  cloneDepth: `${APPS_GROUP}/git-clone-depth`,
  reconcileOption: `${APPS_GROUP}/reconcile-option`,
  reconcileRate: `${APPS_GROUP}/reconcile-rate`,
  currentCommit: `${APPS_GROUP}/git-current-commit`,
} as const;

/** Object bucket sub-folder (`apps/v1.AnnotationBucketPath`). */
export const BUCKET_PATH_ANNOTATION = `${APPS_GROUP}/bucket-path`;

// ----- Channel -----

/** Channel types accepted by the CRD; the lower-case spellings are equivalent. */
export const CHANNEL_TYPES = ['Git', 'HelmRepo', 'ObjectBucket', 'Namespace'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ChannelJson extends KubeJson {
  spec?: {
    type?: string;
    pathname?: string;
    secretRef?: ObjectReference;
    configMapRef?: ObjectReference;
    insecureSkipVerify?: boolean;
    sourceNamespaces?: string[];
  };
}

/** Canonical channel type ("github" and "git" are both Git). */
export function channelType(channel: ChannelJson): ChannelType | string {
  const raw = (channel.spec?.type || '').toLowerCase();
  if (raw === 'git' || raw === 'github') return 'Git';
  if (raw === 'helmrepo') return 'HelmRepo';
  if (raw === 'objectbucket') return 'ObjectBucket';
  if (raw === 'namespace') return 'Namespace';
  return channel.spec?.type || '';
}

// ----- Subscription -----

export interface SubscriptionJson extends KubeJson {
  spec?: {
    channel?: string;
    secondaryChannel?: string;
    name?: string;
    packageFilter?: {
      version?: string;
      labelSelector?: LabelSelector;
      annotations?: Record<string, string>;
    };
    packageOverrides?: Array<{
      packageName: string;
      packageAlias?: string;
      packageOverrides?: unknown[];
    }>;
    placement?: {
      placementRef?: ObjectReference;
      clusterSelector?: LabelSelector;
      clusters?: Array<{ name: string }>;
      local?: boolean;
    };
    timewindow?: {
      windowtype?: string;
      location?: string;
      daysofweek?: string[];
      hours?: Array<{ start?: string; end?: string }>;
    };
    allow?: Array<{ apiVersion?: string; kinds?: string[] }>;
    deny?: Array<{ apiVersion?: string; kinds?: string[] }>;
    watchHelmNamespaceScopedResources?: boolean;
  };
  status?: {
    phase?: string;
    message?: string;
    reason?: string;
    lastUpdateTime?: string;
    appstatusReference?: string;
  };
}

/** Parses "namespace/name" channel references. */
export function parseChannelRef(
  ref: string | undefined
): { namespace: string; name: string } | undefined {
  if (!ref) return undefined;
  const parts = ref.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { namespace: parts[0], name: parts[1] };
}

export function isSubscriptionPaused(sub: SubscriptionJson): boolean {
  return sub.metadata.labels?.[SUBSCRIPTION_PAUSE_LABEL] === 'true';
}

/** Merge patch that pauses or resumes a subscription. */
export function pausePatch(paused: boolean) {
  return { metadata: { labels: { [SUBSCRIPTION_PAUSE_LABEL]: paused ? 'true' : 'false' } } };
}

/** Placement referenced by a subscription (Placement or legacy PlacementRule). */
export function subscriptionPlacementRef(
  sub: SubscriptionJson
): { kind: 'Placement' | 'PlacementRule'; name: string; namespace: string } | undefined {
  const ref = sub.spec?.placement?.placementRef;
  if (!ref?.name) return undefined;
  return {
    kind: ref.kind === 'Placement' ? 'Placement' : 'PlacementRule',
    name: ref.name,
    namespace: ref.namespace || sub.metadata.namespace || '',
  };
}

export type SubscriptionState = 'propagated' | 'subscribed' | 'failed' | 'paused' | 'pending';

/**
 * State from `status.phase`. The hub subscription reports "Propagated" (or "PropagationFailed");
 * managed-cluster subscriptions report "Subscribed" / "Failed".
 */
export function subscriptionState(sub: SubscriptionJson): SubscriptionState {
  if (isSubscriptionPaused(sub)) return 'paused';
  const phase = (sub.status?.phase || '').toLowerCase();
  if (phase.includes('fail')) return 'failed';
  if (phase === 'propagated') return 'propagated';
  if (phase === 'subscribed') return 'subscribed';
  return 'pending';
}

export const SUBSCRIPTION_STATE_HEALTH: Record<SubscriptionState, Health> = {
  propagated: 'success',
  subscribed: 'success',
  failed: 'error',
  paused: 'unknown',
  pending: 'warning',
};

export const SUBSCRIPTION_STATE_LABEL: Record<SubscriptionState, string> = {
  propagated: 'Propagated',
  subscribed: 'Subscribed',
  failed: 'Failed',
  paused: 'Paused',
  pending: 'Pending',
};

// ----- SubscriptionReport / SubscriptionStatus / HelmRelease -----

export interface SubscriptionReportJson extends KubeJson {
  reportType?: 'Application' | 'Cluster' | string;
  summary?: Record<string, string>;
  results?: Array<{ source?: string; result?: string; timestamp?: { seconds?: number } }>;
  resources?: ObjectReference[];
}

export interface ReportSummary {
  deployed: number;
  inProgress: number;
  failed: number;
  propagationFailed: number;
  clusters: number;
}

/** Report summaries store counts as strings. */
export function reportSummary(report: SubscriptionReportJson): ReportSummary {
  const s = report.summary || {};
  return {
    deployed: toCount(s.deployed),
    inProgress: toCount(s.inProgress),
    failed: toCount(s.failed),
    propagationFailed: toCount(s.propagationFailed),
    clusters: toCount(s.clusters),
  };
}

export function reportHealth(report: SubscriptionReportJson): Health {
  const s = reportSummary(report);
  if (s.failed + s.propagationFailed > 0) return 'error';
  if (s.inProgress > 0) return 'warning';
  if (s.deployed > 0) return 'success';
  return 'unknown';
}

export interface SubscriptionStatusJson extends KubeJson {
  statuses?: {
    packages?: Array<{
      name?: string;
      namespace?: string;
      kind?: string;
      apiVersion?: string;
      phase?: string;
      message?: string;
      lastUpdateTime?: string;
    }>;
    subscription?: { phase?: string; message?: string; lastUpdateTime?: string };
  };
}

export interface HelmReleaseJson extends KubeJson {
  repo?: {
    chartName?: string;
    version?: string;
    source?: { type?: string; helmRepo?: { urls?: string[] }; git?: { urls?: string[] } };
  };
  status?: { conditions?: Condition[]; deployedRelease?: { name?: string } };
}

// ----- GitOps -----

/**
 * GitOpsCluster exists in two incompatible versions with the same CRD name:
 * - v1beta1 (multicloud-integrations, archived before OCM v1.0): registers the clusters of a
 *   placement as Argo CD cluster secrets in `argoServer.argoNamespace` (push model);
 * - v1alpha1 (argocd-pull-integration, `clusteradm install hub-addon --names argocd-agent`):
 *   deploys the argocd-agent add-on to the clusters of a placement (advanced pull model).
 */
export interface GitOpsClusterJson extends KubeJson {
  spec?: {
    // v1beta1
    argoServer?: { argoNamespace?: string; cluster?: string };
    managedServiceAccountRef?: string;
    createBlankClusterSecrets?: boolean;
    createPolicyTemplate?: boolean;
    // both
    placementRef?: ObjectReference;
    // v1alpha1
    argoCDAgentAddon?: {
      principalServerAddress?: string;
      principalServerPort?: string;
      mode?: 'managed' | 'autonomous' | string;
      operatorNamespace?: string;
      agentNamespace?: string;
      argoCDCRManifestWork?: { manifests?: unknown[] };
    };
  };
  status?: { phase?: string; message?: string; lastUpdateTime?: string; conditions?: Condition[] };
}

/** The GitOpsCluster uses the argocd-agent API (v1alpha1). */
export function isAgentGitOpsCluster(gitops: {
  apiVersion?: string;
  spec?: GitOpsClusterJson['spec'];
}): boolean {
  return (gitops.apiVersion || '').endsWith('/v1alpha1') || !!gitops.spec?.argoCDAgentAddon;
}

/**
 * Argo CD namespace of a GitOpsCluster: `argoServer.argoNamespace` (v1beta1); the agent API has
 * no such field, the GitOpsCluster lives next to Argo CD.
 */
export function gitOpsArgoNamespace(gitops: GitOpsClusterJson): string | undefined {
  return (
    gitops.spec?.argoServer?.argoNamespace ||
    (isAgentGitOpsCluster(gitops) ? gitops.metadata.namespace : undefined)
  );
}

export function gitOpsHealth(gitops: GitOpsClusterJson): Health {
  const conditions = gitops.status?.conditions || [];
  if (conditions.length > 0) {
    if (conditions.some(c => c.status === 'False')) return 'error';
    if (conditions.every(c => c.status === 'True')) return 'success';
    return 'unknown';
  }
  const phase = (gitops.status?.phase || '').toLowerCase();
  if (phase === 'successful') return 'success';
  if (phase === 'failed') return 'error';
  return 'unknown';
}

/** Short status text of a GitOpsCluster (phase, or the first false condition). */
export function gitOpsStatusText(gitops: GitOpsClusterJson): string {
  const conditions = gitops.status?.conditions || [];
  const bad = conditions.find(c => c.status === 'False');
  if (bad) return `${bad.type}: ${bad.message || bad.reason || 'False'}`;
  if (conditions.length > 0)
    return conditions.every(c => c.status === 'True') ? 'Ready' : 'Pending';
  return gitops.status?.phase || '';
}

export interface AppSetReportJson extends KubeJson {
  statuses?: {
    summary?: Record<string, string>;
    clusterConditions?: Array<{
      cluster?: string;
      app?: string;
      healthStatus?: string;
      syncStatus?: string;
      conditions?: Array<{ type?: string; message?: string }>;
      operationStatePhase?: string;
      syncRevision?: string;
    }>;
    resources?: ObjectReference[];
  };
}

export interface AppSetSummary {
  clusters: number;
  healthy: number;
  notHealthy: number;
  synced: number;
  notSynced: number;
  inProgress: number;
}

export function appSetSummary(report: AppSetReportJson): AppSetSummary {
  const s = report.statuses?.summary || {};
  return {
    clusters: toCount(s.clusters),
    healthy: toCount(s.healthy),
    notHealthy: toCount(s.notHealthy),
    synced: toCount(s.synced),
    notSynced: toCount(s.notSynced),
    inProgress: toCount(s.inProgress),
  };
}
