/**
 * Namespace quota check of a deployment: does the namespace's ResourceQuota leave room for the
 * model server pods, and what do the Kueue queues of the namespace offer?
 *
 * ResourceQuota is enforced when a pod is created, so the pods of every replica (and of every
 * replica an autoscaler may add) must fit in `hard - used`. When an endpoint is edited, its own
 * pods are part of `used` and are released once KServe replaces them; during a rolling update the
 * old and the new pods count together for a while.
 *
 * Kueue only admits workloads that carry the `kueue.x-k8s.io/queue-name` label (or all workloads
 * of a namespace when Kueue is configured to manage them), so its quotas are shown as
 * information, not as a verdict.
 */
import { KubeJson } from '../resources/types';
import { parseQuantity } from './quantity';

export interface PodShape {
  /** CPU request in cores. */
  cpu: number;
  /** Memory request (and limit) in bytes. */
  memory: number;
  /** Extended GPU resource name, e.g. nvidia.com/gpu. */
  gpuResource: string;
  gpus: number;
}

/** Requested and limited resources of the pods, keyed like ResourceQuota `hard` entries. */
function podUsage(pod: PodShape): Record<string, number> {
  const usage: Record<string, number> = {
    pods: 1,
    cpu: pod.cpu,
    'requests.cpu': pod.cpu,
    memory: pod.memory,
    'requests.memory': pod.memory,
    'limits.memory': pod.memory,
  };
  if (pod.gpus > 0) {
    usage[`requests.${pod.gpuResource}`] = pod.gpus;
    usage[`limits.${pod.gpuResource}`] = pod.gpus;
  }
  return usage;
}

export interface QuotaJson extends KubeJson {
  spec?: {
    hard?: Record<string, string>;
    scopes?: string[];
    scopeSelector?: unknown;
  };
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

export type QuotaVerdict = 'ok' | 'max-exceeds' | 'exceeds' | 'needs-limit';

export interface QuotaRow {
  quota: string;
  /** ResourceQuota key, e.g. requests.nvidia.com/gpu. */
  resource: string;
  hard: number;
  /** Used by other workloads (the edited endpoint's own pods are left out). */
  used: number;
  /** Needed by the minimum number of pods. */
  need: number;
  /** Needed by the maximum number of pods (autoscaling). */
  needMax: number;
  verdict: QuotaVerdict;
}

export interface QuotaCheck {
  rows: QuotaRow[];
  /** Quotas restricted by scopes; they may or may not apply to the pods. */
  scoped: string[];
}

/** Sum of the container requests and limits of existing pods, keyed like `podUsage`. */
export function usageOfPods(
  pods: Array<{
    spec?: {
      containers?: Array<{
        resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
      }>;
    };
  }>
): Record<string, number> {
  const total: Record<string, number> = {};
  const add = (key: string, value: number) => {
    if (Number.isFinite(value)) total[key] = (total[key] || 0) + value;
  };
  for (const pod of pods) {
    add('pods', 1);
    for (const c of pod.spec?.containers || []) {
      for (const [name, value] of Object.entries(c.resources?.requests || {})) {
        const v = parseQuantity(value);
        add(`requests.${name}`, v);
        if (name === 'cpu' || name === 'memory') add(name, v);
      }
      for (const [name, value] of Object.entries(c.resources?.limits || {})) {
        add(`limits.${name}`, parseQuantity(value));
      }
    }
  }
  return total;
}

/**
 * Compares the pods of a deployment with the ResourceQuotas of its namespace.
 * `own` is the current usage of the edited endpoint, released when its pods are replaced.
 */
export function checkQuotas(
  quotas: QuotaJson[],
  pod: PodShape,
  pods: { min: number; max: number },
  own: Record<string, number> = {},
  defaultCpuLimit = false
): QuotaCheck {
  const usage = podUsage(pod);
  const rows: QuotaRow[] = [];
  const scoped: string[] = [];
  for (const quota of quotas) {
    const name = quota.metadata?.name || '';
    if (quota.spec?.scopes?.length || quota.spec?.scopeSelector) {
      scoped.push(name);
      continue;
    }
    const hardList = quota.status?.hard || quota.spec?.hard || {};
    for (const [resource, hardValue] of Object.entries(hardList)) {
      const hard = parseQuantity(hardValue);
      if (!Number.isFinite(hard)) continue;
      const used = Math.max(
        0,
        (parseQuantity(quota.status?.used?.[resource]) || 0) - (own[resource] || 0)
      );
      if (resource === 'limits.cpu' && !defaultCpuLimit) {
        // The pods set no CPU limit, and a quota on CPU limits makes the API server reject pods
        // without one (unless a LimitRange of the namespace supplies a default).
        rows.push({
          quota: name,
          resource,
          hard,
          used,
          need: 0,
          needMax: 0,
          verdict: 'needs-limit',
        });
        continue;
      }
      const perPod = usage[resource];
      if (perPod === undefined) continue;
      const need = perPod * pods.min;
      const needMax = perPod * pods.max;
      const room = hard - used;
      rows.push({
        quota: name,
        resource,
        hard,
        used,
        need,
        needMax,
        verdict: need > room ? 'exceeds' : needMax > room ? 'max-exceeds' : 'ok',
      });
    }
  }
  return { rows, scoped };
}

/** True when a LimitRange of the namespace gives containers a default CPU limit. */
export function hasDefaultCpuLimit(
  limitRanges: Array<{
    spec?: { limits?: Array<{ type?: string; default?: Record<string, string> }> };
  }>
): boolean {
  return limitRanges.some(lr =>
    (lr.spec?.limits || []).some(l => l.type === 'Container' && !!l.default?.cpu)
  );
}

// ---------------------------------------------------------------------------------------------
// Kueue
// ---------------------------------------------------------------------------------------------

interface FlavorUsage {
  name?: string;
  resources?: Array<{ name?: string; total?: string; borrowed?: string }>;
}

export interface LocalQueueJson extends KubeJson {
  spec?: { clusterQueue?: string };
  status?: {
    pendingWorkloads?: number;
    admittedWorkloads?: number;
    /** v1beta2. */
    flavorsUsage?: FlavorUsage[];
    /** v1beta1. */
    flavorUsage?: FlavorUsage[];
  };
}

export interface ClusterQueueJson extends KubeJson {
  spec?: {
    resourceGroups?: Array<{
      flavors?: Array<{
        name?: string;
        resources?: Array<{ name?: string; nominalQuota?: string; borrowingLimit?: string }>;
      }>;
    }>;
  };
  status?: { flavorsUsage?: FlavorUsage[]; pendingWorkloads?: number };
}

export interface KueueQueue {
  localQueue: string;
  clusterQueue: string;
  /** GPUs used by the admitted workloads of this namespace's queue. */
  namespaceUsed: number;
  pending: number;
  /** Nominal GPU quota of the ClusterQueue over all flavors; undefined when unknown. */
  nominal?: number;
  /** GPUs in use in the whole ClusterQueue; undefined when unknown. */
  clusterUsed?: number;
  /** The ClusterQueue does not list the GPU resource: it admits no GPU workloads. */
  noGpuQuota?: boolean;
}

function totalOf(usage: FlavorUsage[] | undefined, resource: string): number {
  let sum = 0;
  for (const flavor of usage || []) {
    for (const r of flavor.resources || []) {
      if (r.name === resource) sum += parseQuantity(r.total) || 0;
    }
  }
  return sum;
}

/** GPU quota of the Kueue queues a namespace can submit to. */
export function kueueQueues(
  localQueues: LocalQueueJson[],
  clusterQueues: ClusterQueueJson[] | null,
  gpuResource: string
): KueueQueue[] {
  return localQueues.map(lq => {
    const cqName = lq.spec?.clusterQueue || '';
    const queue: KueueQueue = {
      localQueue: lq.metadata?.name || '',
      clusterQueue: cqName,
      namespaceUsed: totalOf(lq.status?.flavorsUsage || lq.status?.flavorUsage, gpuResource),
      pending: lq.status?.pendingWorkloads || 0,
    };
    const cq = clusterQueues?.find(c => c.metadata?.name === cqName);
    if (!cq) return queue;
    let nominal = 0;
    let listed = false;
    for (const group of cq.spec?.resourceGroups || []) {
      for (const flavor of group.flavors || []) {
        for (const r of flavor.resources || []) {
          if (r.name !== gpuResource) continue;
          listed = true;
          nominal += parseQuantity(r.nominalQuota) || 0;
        }
      }
    }
    return {
      ...queue,
      nominal: listed ? nominal : undefined,
      clusterUsed: totalOf(cq.status?.flavorsUsage, gpuResource),
      noGpuQuota: !listed,
    };
  });
}
