/**
 * Pure helpers of the upgrade readiness dashboard: kubelet versions against the API server
 * (the kubelet may be up to three minor versions older and never newer), PodDisruptionBudgets that
 * block node drains, and deprecated APIs still requested (apiserver_requested_deprecated_apis).
 */
import { Issue, NodeJson } from '../overview/clusterHealth';
import type { InstantSample } from '../overview/prometheus';

/** Oldest supported kubelet: this many minor versions below the API server. */
export const KUBELET_SKEW = 3;

export function minorOf(version?: string): [number, number] | undefined {
  const m = version?.match(/^v?(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

export interface VersionRow {
  version: string;
  nodes: string[];
  /** API server minor minus kubelet minor; negative when the kubelet is newer. */
  behind?: number;
}

export function kubeletVersions(nodes: NodeJson[], apiServer?: string): VersionRow[] {
  const api = minorOf(apiServer);
  const rows = new Map<string, VersionRow>();
  for (const node of nodes) {
    const version = node.status?.nodeInfo?.kubeletVersion || 'unknown';
    const row = rows.get(version) ?? { version, nodes: [] };
    row.nodes.push(node.metadata?.name ?? '');
    const kubelet = minorOf(version);
    if (api && kubelet && api[0] === kubelet[0]) row.behind = api[1] - kubelet[1];
    rows.set(version, row);
  }
  return [...rows.values()].sort((a, b) => (b.behind ?? 0) - (a.behind ?? 0));
}

export function skewIssues(rows: VersionRow[], apiServer?: string): Issue[] {
  const issues: Issue[] = [];
  for (const row of rows) {
    if (row.behind === undefined) continue;
    const base = {
      kind: 'Node',
      name: row.nodes.length === 1 ? row.nodes[0] : `${row.nodes.length} nodes`,
      link: row.nodes.length === 1 ? { route: 'node', params: { name: row.nodes[0] } } : undefined,
      detail: row.nodes.length > 1 ? row.nodes.join(', ') : undefined,
    };
    if (row.behind < 0) {
      issues.push({
        ...base,
        level: 'error',
        title: `Kubelet ${row.version} is newer than the API server ${apiServer}`,
      });
    } else if (row.behind > KUBELET_SKEW) {
      issues.push({
        ...base,
        level: 'error',
        title: `Kubelet ${row.version} is ${row.behind} minor versions behind`,
        detail: `Only ${KUBELET_SKEW} are supported. ${base.detail ?? ''}`.trim(),
      });
    } else if (row.behind === KUBELET_SKEW) {
      issues.push({
        ...base,
        level: 'warning',
        title: `Kubelet ${row.version} is at the oldest supported version`,
        detail: `Upgrade these kubelets before the control plane's next minor version. ${
          base.detail ?? ''
        }`.trim(),
      });
    }
  }
  return issues;
}

export interface PdbJson {
  metadata?: { name?: string; namespace?: string };
  spec?: { minAvailable?: number | string; maxUnavailable?: number | string };
  status?: {
    disruptionsAllowed?: number;
    currentHealthy?: number;
    desiredHealthy?: number;
    expectedPods?: number;
  };
}

/** Budgets that allow no disruption now: draining a node with their pods waits forever. */
export function blockingPdbs(pdbs: PdbJson[]): PdbJson[] {
  return pdbs.filter(
    p => (p.status?.expectedPods ?? 0) > 0 && (p.status?.disruptionsAllowed ?? 0) === 0
  );
}

export function pdbIssues(pdbs: PdbJson[]): Issue[] {
  return blockingPdbs(pdbs).map(p => {
    const name = p.metadata?.name ?? '';
    const namespace = p.metadata?.namespace ?? '';
    const s = p.status ?? {};
    const unhealthy = (s.currentHealthy ?? 0) < (s.desiredHealthy ?? 0);
    const rule =
      p.spec?.maxUnavailable !== undefined
        ? `maxUnavailable ${p.spec.maxUnavailable}`
        : `minAvailable ${p.spec?.minAvailable}`;
    return {
      kind: 'PodDisruptionBudget',
      name,
      namespace,
      link: { route: 'podDisruptionBudget', params: { namespace, name } },
      level: 'warning' as const,
      title: 'Blocks node drains',
      detail: unhealthy
        ? `${s.currentHealthy}/${s.desiredHealthy} healthy pods: wait until the pods are healthy.`
        : `${rule} with ${s.expectedPods} pod(s) allows no eviction; add replicas or relax the budget.`,
    };
  });
}

export const DEPRECATED_QUERY = 'apiserver_requested_deprecated_apis == 1';

export interface DeprecatedApi {
  api: string;
  resource: string;
  removedRelease?: string;
}

export function deprecatedApis(samples: InstantSample[]): DeprecatedApi[] {
  const rows = new Map<string, DeprecatedApi>();
  for (const s of samples) {
    const m = s.metric;
    const api = m.group ? `${m.group}/${m.version}` : m.version ?? '';
    const resource = m.subresource ? `${m.resource}/${m.subresource}` : m.resource ?? '';
    rows.set(`${api} ${resource}`, {
      api,
      resource,
      removedRelease: m.removed_release || undefined,
    });
  }
  return [...rows.values()].sort(
    (a, b) =>
      (a.removedRelease ?? '9').localeCompare(b.removedRelease ?? '9', undefined, {
        numeric: true,
      }) || a.api.localeCompare(b.api)
  );
}

/** APIs removed in the next minor version or earlier are errors, later removals warnings. */
export function deprecatedIssues(rows: DeprecatedApi[], apiServer?: string): Issue[] {
  const api = minorOf(apiServer);
  return rows.map(row => {
    const removed = minorOf(row.removedRelease);
    const soon = !!api && !!removed && removed[0] === api[0] && removed[1] <= api[1] + 1;
    return {
      kind: 'API',
      name: `${row.api} ${row.resource}`,
      level: soon ? ('error' as const) : ('warning' as const),
      title: row.removedRelease
        ? `Deprecated, removed in ${row.removedRelease}`
        : 'Deprecated API still requested',
      detail: 'Some client still calls it; the API server audit log shows which one.',
    };
  });
}
