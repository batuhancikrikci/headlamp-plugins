/**
 * Pure aggregation for the overview dashboard: problems that need attention and placement
 * summaries. Free of Headlamp imports so it can be unit tested.
 */
import { addonState, ManagedClusterAddOnJson } from '../../resources/models/addon';
import {
  GitOpsClusterJson,
  gitOpsHealth,
  reportHealth,
  SubscriptionJson,
  SubscriptionReportJson,
  subscriptionState,
} from '../../resources/models/apps';
import {
  ArgoApplicationJson,
  healthStatus,
  isOperationFailed,
  syncStatus,
} from '../../resources/models/argo';
import {
  clusterState,
  CSRJson,
  csrState,
  ManagedClusterJson,
  pendingCSRsByCluster,
} from '../../resources/models/cluster';
import { findCondition } from '../../resources/models/common';
import {
  activeProblems,
  ClusterManagerJson,
  KlusterletJson,
  operatorHealth,
} from '../../resources/models/operator';
import {
  decidedClusters,
  decisionsOfPlacement,
  PlacementDecisionJson,
  PlacementJson,
  placementState,
} from '../../resources/models/placement';
import {
  compliance as policyCompliance,
  isReplicatedPolicy,
  PolicyJson,
  PolicySetJson,
} from '../../resources/models/policy';
import {
  ManifestWorkJson,
  ManifestWorkReplicaSetJson,
  mwrsState,
  workState,
} from '../../resources/models/work';

export type Severity = 'error' | 'warning';

export interface Issue {
  id: string;
  severity: Severity;
  kind?: string;
  name: string;
  namespace?: string;
  message: string;
  /** For sorting: newest first when known. */
  time?: string;
}

export interface IssueInput {
  clusterManagers?: ClusterManagerJson[];
  clusters?: ManagedClusterJson[];
  csrs?: CSRJson[];
  addons?: ManagedClusterAddOnJson[];
  placements?: PlacementJson[];
  works?: ManifestWorkJson[];
  replicaSets?: ManifestWorkReplicaSetJson[];
  subscriptions?: SubscriptionJson[];
  argoApps?: ArgoApplicationJson[];
  policies?: PolicyJson[];
}

function lastTransition(
  conditions: Array<{ lastTransitionTime?: string }> | undefined
): string | undefined {
  return (conditions || [])
    .map(c => c.lastTransitionTime)
    .filter((t): t is string => !!t)
    .sort()
    .pop();
}

/** Everything that needs an operator's attention, errors first, then newest first. */
export function collectIssues(input: IssueInput): Issue[] {
  const issues: Issue[] = [];

  for (const cm of input.clusterManagers || []) {
    for (const problem of activeProblems(cm.status?.conditions)) {
      issues.push({
        id: `cm/${cm.metadata.name}/${problem.type}`,
        severity: 'error',
        kind: 'ClusterManager',
        name: cm.metadata.name,
        message: `${problem.type}: ${problem.message || problem.reason || problem.status}`,
        time: problem.lastTransitionTime,
      });
    }
  }

  const pending = pendingCSRsByCluster(input.csrs || []);
  for (const cluster of input.clusters || []) {
    const name = cluster.metadata.name;
    const state = clusterState(cluster);
    const conditions = cluster.status?.conditions;
    if (state === 'pending-accept') {
      issues.push({
        id: `mc/${name}/accept`,
        severity: 'warning',
        kind: 'ManagedCluster',
        name,
        message: 'Waiting for the hub to accept the cluster.',
        time: cluster.metadata.creationTimestamp,
      });
    } else if (state === 'pending-join') {
      issues.push({
        id: `mc/${name}/join`,
        severity: 'warning',
        kind: 'ManagedCluster',
        name,
        message: pending[name]
          ? `${pending[name].length} certificate signing request(s) wait for approval.`
          : 'Accepted, but the agent has not joined yet.',
        time: cluster.metadata.creationTimestamp,
      });
    } else if (state === 'unavailable' || state === 'unknown' || state === 'denied') {
      const condition =
        state === 'denied'
          ? findCondition(conditions, 'HubDeniedManagedCluster')
          : findCondition(conditions, 'ManagedClusterConditionAvailable');
      issues.push({
        id: `mc/${name}/${state}`,
        severity: state === 'unknown' ? 'warning' : 'error',
        kind: 'ManagedCluster',
        name,
        message:
          condition?.message ||
          (state === 'unknown'
            ? 'The cluster status is unknown (lease not renewed).'
            : `Cluster is ${state}.`),
        time: condition?.lastTransitionTime,
      });
    }
  }

  for (const addon of input.addons || []) {
    const state = addonState(addon);
    if (state !== 'degraded' && state !== 'unavailable') continue;
    const condition =
      findCondition(addon.status?.conditions, 'Degraded') ||
      findCondition(addon.status?.conditions, 'Available');
    issues.push({
      id: `mca/${addon.metadata.namespace}/${addon.metadata.name}`,
      severity: 'error',
      kind: 'ManagedClusterAddOn',
      name: addon.metadata.name,
      namespace: addon.metadata.namespace,
      message: `${state === 'degraded' ? 'Degraded' : 'Unavailable'} on ${
        addon.metadata.namespace
      }${condition?.message ? `: ${condition.message}` : ''}`,
      time: condition?.lastTransitionTime,
    });
  }

  for (const placement of input.placements || []) {
    const state = placementState(placement);
    if (state !== 'misconfigured' && state !== 'unsatisfied') continue;
    const condition =
      findCondition(placement.status?.conditions, 'PlacementMisconfigured') ||
      findCondition(placement.status?.conditions, 'PlacementSatisfied');
    issues.push({
      id: `pl/${placement.metadata.namespace}/${placement.metadata.name}`,
      severity: state === 'misconfigured' ? 'error' : 'warning',
      kind: 'Placement',
      name: placement.metadata.name,
      namespace: placement.metadata.namespace,
      message: condition?.message || condition?.reason || state,
      time: condition?.lastTransitionTime,
    });
  }

  for (const work of input.works || []) {
    const state = workState(work);
    if (state !== 'failed' && state !== 'degraded') continue;
    const condition =
      findCondition(work.status?.conditions, 'Degraded') ||
      findCondition(work.status?.conditions, 'Applied');
    issues.push({
      id: `mw/${work.metadata.namespace}/${work.metadata.name}`,
      severity: 'error',
      kind: 'ManifestWork',
      name: work.metadata.name,
      namespace: work.metadata.namespace,
      message: condition?.message || condition?.reason || state,
      time: lastTransition(work.status?.conditions),
    });
  }

  for (const mwrs of input.replicaSets || []) {
    const state = mwrsState(mwrs);
    if (state !== 'degraded' && state !== 'placement-missing') continue;
    const condition = findCondition(mwrs.status?.conditions, 'PlacementVerified');
    issues.push({
      id: `mwrs/${mwrs.metadata.namespace}/${mwrs.metadata.name}`,
      severity: 'error',
      kind: 'ManifestWorkReplicaSet',
      name: mwrs.metadata.name,
      namespace: mwrs.metadata.namespace,
      message:
        state === 'placement-missing'
          ? condition?.message || 'The referenced placement was not found.'
          : 'Some ManifestWorks are degraded.',
      time: lastTransition(mwrs.status?.conditions),
    });
  }

  for (const sub of input.subscriptions || []) {
    if (subscriptionState(sub) !== 'failed') continue;
    issues.push({
      id: `sub/${sub.metadata.namespace}/${sub.metadata.name}`,
      severity: 'error',
      kind: 'Subscription',
      name: sub.metadata.name,
      namespace: sub.metadata.namespace,
      message: sub.status?.message || sub.status?.reason || sub.status?.phase || 'Failed',
      time: sub.status?.lastUpdateTime,
    });
  }

  for (const app of input.argoApps || []) {
    const health = healthStatus(app);
    const sync = syncStatus(app);
    const failed = isOperationFailed(app);
    if (!failed && health !== 'Degraded' && health !== 'Missing' && sync !== 'OutOfSync') continue;
    const op = app.status?.operationState;
    issues.push({
      id: `argo/${app.metadata.namespace}/${app.metadata.name}`,
      severity: failed || health === 'Degraded' || health === 'Missing' ? 'error' : 'warning',
      kind: 'Application',
      name: app.metadata.name,
      namespace: app.metadata.namespace,
      message: failed
        ? `Sync ${op?.phase}: ${op?.message || ''}`.trim()
        : health === 'Degraded' || health === 'Missing'
        ? `${health}${app.status?.health?.message ? `: ${app.status.health.message}` : ''}`
        : 'OutOfSync',
      time: op?.finishedAt || app.status?.reconciledAt,
    });
  }

  for (const policy of input.policies || []) {
    if (isReplicatedPolicy(policy) || policy.spec?.disabled) continue;
    if (policyCompliance(policy) !== 'NonCompliant') continue;
    const clusters = (policy.status?.status || [])
      .filter(s => s.compliant === 'NonCompliant')
      .map(s => s.clustername);
    issues.push({
      id: `policy/${policy.metadata.namespace}/${policy.metadata.name}`,
      severity:
        (policy.spec?.remediationAction || '').toLowerCase() === 'enforce' ? 'error' : 'warning',
      kind: 'Policy',
      name: policy.metadata.name,
      namespace: policy.metadata.namespace,
      message: `Non-compliant on ${clusters.length} cluster(s)${
        clusters.length
          ? `: ${clusters.slice(0, 5).join(', ')}${clusters.length > 5 ? ', …' : ''}`
          : ''
      }`,
    });
  }

  return issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    return (b.time || '').localeCompare(a.time || '');
  });
}

export interface PlacementSummaryRow {
  name: string;
  namespace: string;
  state: ReturnType<typeof placementState>;
  selected: number;
  requested?: number;
  clusters: string[];
}

/** One row per placement with the clusters its decisions selected. */
export function placementSummary(
  placements: PlacementJson[],
  decisions: PlacementDecisionJson[]
): PlacementSummaryRow[] {
  return placements
    .map(p => {
      const clusters = decidedClusters(decisionsOfPlacement(p, decisions));
      return {
        name: p.metadata.name,
        namespace: p.metadata.namespace || '',
        state: placementState(p),
        selected: p.status?.numberOfSelectedClusters ?? clusters.length,
        requested: p.spec?.numberOfClusters,
        clusters,
      };
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export interface ArgoCounts {
  total: number;
  healthy: number;
  degraded: number;
  progressing: number;
  other: number;
  synced: number;
  outOfSync: number;
  pull: number;
}

export function argoCounts(apps: ArgoApplicationJson[]): ArgoCounts {
  const c: ArgoCounts = {
    total: apps.length,
    healthy: 0,
    degraded: 0,
    progressing: 0,
    other: 0,
    synced: 0,
    outOfSync: 0,
    pull: 0,
  };
  for (const app of apps) {
    const h = healthStatus(app);
    if (h === 'Healthy') c.healthy++;
    else if (h === 'Degraded' || h === 'Missing') c.degraded++;
    else if (h === 'Progressing') c.progressing++;
    else c.other++;
    const s = syncStatus(app);
    if (s === 'Synced') c.synced++;
    else if (s === 'OutOfSync') c.outOfSync++;
    if (
      (app.metadata.labels?.['apps.open-cluster-management.io/pull-to-ocm-managed-cluster'] ||
        '') === 'true'
    )
      c.pull++;
  }
  return c;
}

// ----- Resource inventory -----

export interface KindHealthCounts {
  total: number;
  /** Objects in an error state, with a short label ("unavailable", "failing"). */
  error: number;
  errorLabel: string;
  /** Objects that need attention but are not failing ("pending", "degraded"). */
  warning: number;
  warningLabel: string;
}

type Classification = 'error' | 'warning' | 'ok';

interface ClassifierRule {
  classify: (item: unknown) => Classification;
  error: string;
  warning: string;
}

/** A rule whose classifier reads the JSON of its kind: the lists it gets hold objects of that kind. */
function rule<T>(
  classify: (item: T) => Classification,
  error: string,
  warning: string
): ClassifierRule {
  return { classify: item => classify(item as T), error, warning };
}

const fromHealth = (h: string): Classification =>
  h === 'error' ? 'error' : h === 'warning' ? 'warning' : 'ok';

/** Per kind: how objects are classified and how the problem chips are labelled. */
const CLASSIFIERS: Record<string, ClassifierRule> = {
  ManagedCluster: rule<ManagedClusterJson>(
    c => {
      const s = clusterState(c);
      if (s === 'unavailable' || s === 'denied') return 'error';
      if (s === 'unknown' || s === 'pending-accept' || s === 'pending-join') return 'warning';
      return 'ok';
    },
    'unavailable',
    'pending'
  ),
  CertificateSigningRequest: rule<CSRJson>(
    c => (csrState(c) === 'pending' ? 'warning' : csrState(c) === 'failed' ? 'error' : 'ok'),
    'failed',
    'pending'
  ),
  Placement: rule<PlacementJson>(
    p => {
      const s = placementState(p);
      return s === 'misconfigured' ? 'error' : s === 'unsatisfied' ? 'warning' : 'ok';
    },
    'misconfigured',
    'unsatisfied'
  ),
  ManifestWork: rule<ManifestWorkJson>(
    w => {
      const s = workState(w);
      return s === 'failed' || s === 'degraded' ? 'error' : s === 'pending' ? 'warning' : 'ok';
    },
    'failing',
    'pending'
  ),
  ManifestWorkReplicaSet: rule<ManifestWorkReplicaSetJson>(
    m => {
      const s = mwrsState(m);
      return s === 'degraded' || s === 'placement-missing'
        ? 'error'
        : s === 'pending'
        ? 'warning'
        : 'ok';
    },
    'failing',
    'pending'
  ),
  ManagedClusterAddOn: rule<ManagedClusterAddOnJson>(
    a => {
      const s = addonState(a);
      return s === 'degraded' || s === 'unavailable' ? 'error' : s === 'unknown' ? 'warning' : 'ok';
    },
    'failing',
    'unknown'
  ),
  Subscription: rule<SubscriptionJson>(
    s =>
      subscriptionState(s) === 'failed'
        ? 'error'
        : subscriptionState(s) === 'pending'
        ? 'warning'
        : 'ok',
    'failed',
    'pending'
  ),
  Application: rule<ArgoApplicationJson>(
    a => {
      if (isOperationFailed(a) || ['Degraded', 'Missing'].includes(healthStatus(a))) return 'error';
      return syncStatus(a) === 'OutOfSync' ? 'warning' : 'ok';
    },
    'failing',
    'out of sync'
  ),
  Policy: rule<PolicyJson>(
    p => {
      if (isReplicatedPolicy(p)) return 'ok';
      const c = policyCompliance(p);
      return c === 'NonCompliant' ? 'error' : c === 'Pending' ? 'warning' : 'ok';
    },
    'non-compliant',
    'pending'
  ),
  PolicySet: rule<PolicySetJson>(
    s =>
      s.status?.compliant === 'NonCompliant'
        ? 'error'
        : s.status?.compliant === 'Pending'
        ? 'warning'
        : 'ok',
    'non-compliant',
    'pending'
  ),
  GitOpsCluster: rule<GitOpsClusterJson>(g => fromHealth(gitOpsHealth(g)), 'failed', 'pending'),
  SubscriptionReport: rule<SubscriptionReportJson>(
    r => fromHealth(reportHealth(r)),
    'failing',
    'in progress'
  ),
  ClusterManager: rule<ClusterManagerJson>(
    c => fromHealth(operatorHealth(c.status?.conditions)),
    'degraded',
    'progressing'
  ),
  Klusterlet: rule<KlusterletJson>(
    k => fromHealth(operatorHealth(k.status?.conditions)),
    'degraded',
    'progressing'
  ),
};

/** Object count of a kind with the number of failing and degraded objects. */
export function kindHealthCounts(kind: string, items: readonly unknown[]): KindHealthCounts {
  const rule = CLASSIFIERS[kind];
  const counts: KindHealthCounts = {
    total: items.length,
    error: 0,
    errorLabel: rule?.error || 'failing',
    warning: 0,
    warningLabel: rule?.warning || 'degraded',
  };
  if (!rule) return counts;
  for (const item of items) {
    const c = rule.classify(item);
    if (c === 'error') counts.error++;
    else if (c === 'warning') counts.warning++;
  }
  return counts;
}

export interface PolicyCounts {
  total: number;
  compliant: number;
  nonCompliant: number;
  pending: number;
  noStatus: number;
  disabled: number;
  enforced: number;
}

/** Counts over root policies (replicated copies are ignored). */
export function policyCounts(policies: PolicyJson[]): PolicyCounts {
  const c: PolicyCounts = {
    total: 0,
    compliant: 0,
    nonCompliant: 0,
    pending: 0,
    noStatus: 0,
    disabled: 0,
    enforced: 0,
  };
  for (const p of policies) {
    if (isReplicatedPolicy(p)) continue;
    c.total++;
    if (p.spec?.disabled) c.disabled++;
    if ((p.spec?.remediationAction || '').toLowerCase() === 'enforce') c.enforced++;
    const s = policyCompliance(p);
    if (s === 'Compliant') c.compliant++;
    else if (s === 'NonCompliant') c.nonCompliant++;
    else if (s === 'Pending') c.pending++;
    else c.noStatus++;
  }
  return c;
}
