/**
 * Pure helpers behind the namespace dashboard: claims that are not bound, how full the
 * ResourceQuotas are, what the pods request and what they use. They work on plain Kubernetes
 * JSON, like clusterHealth.ts.
 */
import { Issue, parseCpu, parseMemory, PENDING_GRACE_MS } from './clusterHealth';

interface Meta {
  name?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
}

export interface PvcJson {
  metadata?: Meta;
  spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } };
  status?: { phase?: string };
}

/** A claim that is lost, or still pending after the grace period. */
export function pvcIssues(pvc: PvcJson, now: number = Date.now()): Issue[] {
  const base = {
    kind: 'PersistentVolumeClaim',
    name: pvc.metadata?.name ?? '',
    namespace: pvc.metadata?.namespace,
    uid: pvc.metadata?.uid,
  };
  const phase = pvc.status?.phase;
  if (phase === 'Lost') {
    return [
      {
        ...base,
        level: 'error',
        title: 'Volume lost',
        detail: 'The bound volume no longer exists.',
      },
    ];
  }
  if (phase === 'Pending') {
    const created = Date.parse(pvc.metadata?.creationTimestamp ?? '');
    if (!Number.isNaN(created) && now - created > PENDING_GRACE_MS) {
      return [
        {
          ...base,
          level: 'warning',
          title: 'Claim not bound',
          detail: pvc.spec?.storageClassName
            ? `No volume from storage class ${pvc.spec.storageClassName} after 5 minutes (a WaitForFirstConsumer class binds when a pod uses it).`
            : 'No volume after 5 minutes.',
        },
      ];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------------------------

export interface QuotaJson {
  metadata?: Meta;
  status?: { hard?: Record<string, string>; used?: Record<string, string> };
}

export type QuotaKind = 'cpu' | 'memory' | 'count';

export interface QuotaRow {
  quota: string;
  resource: string;
  kind: QuotaKind;
  /** Cores, bytes or a count. */
  used: number;
  hard: number;
}

export function quotaKind(resource: string): QuotaKind {
  if (/(^|\.)cpu$/.test(resource)) return 'cpu';
  if (/(^|\.)(memory|storage|ephemeral-storage)$/.test(resource) || resource.endsWith('.storage')) {
    return 'memory';
  }
  return 'count';
}

function parse(kind: QuotaKind, value?: string): number {
  if (kind === 'cpu') return parseCpu(value);
  if (kind === 'memory') return parseMemory(value);
  return parseMemory(value); // Counts may use suffixes such as "1k".
}

/** Every limited resource of every quota, fullest first. */
export function quotaRows(quotas: QuotaJson[]): QuotaRow[] {
  const rows: QuotaRow[] = [];
  for (const quota of quotas) {
    for (const [resource, hardValue] of Object.entries(quota.status?.hard ?? {})) {
      const kind = quotaKind(resource);
      rows.push({
        quota: quota.metadata?.name ?? '',
        resource,
        kind,
        hard: parse(kind, hardValue),
        used: parse(kind, quota.status?.used?.[resource]),
      });
    }
  }
  const ratio = (row: QuotaRow) =>
    row.hard > 0 ? row.used / row.hard : row.used > 0 ? Infinity : 0;
  return rows.sort((a, b) => ratio(b) - ratio(a));
}

/** Quotas at 90 % or more: new pods or objects may soon be rejected. */
export function quotaIssues(rows: QuotaRow[], namespace?: string): Issue[] {
  return rows.flatMap((row): Issue[] => {
    if (row.hard <= 0 && row.used === 0) return [];
    const ratio = row.hard > 0 ? row.used / row.hard : Infinity;
    if (ratio < 0.9) return [];
    return [
      {
        level: ratio >= 1 ? 'error' : 'warning',
        kind: 'ResourceQuota',
        name: row.quota,
        namespace,
        title: ratio >= 1 ? `${row.resource} quota used up` : `${row.resource} quota nearly used`,
        detail: `${Math.round(
          ratio * 100
        )}% of the limit; new objects that need more are rejected.`,
      },
    ];
  });
}

/** CPU (cores) and memory (bytes) a quota gives the namespace, for the trend's dashed line. */
export function quotaCapacity(rows: QuotaRow[]): { cpu?: number; memory?: number } {
  const pick = (names: string[]) => {
    for (const name of names) {
      const row = rows.find(r => r.resource === name);
      if (row) return row.hard;
    }
    return undefined;
  };
  return {
    cpu: pick(['limits.cpu', 'requests.cpu', 'cpu']),
    memory: pick(['limits.memory', 'requests.memory', 'memory']),
  };
}

// ---------------------------------------------------------------------------------------------
// Requests and usage
// ---------------------------------------------------------------------------------------------

export interface PodSpecJson {
  metadata?: Meta;
  spec?: {
    containers?: Array<{
      resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
    }>;
  };
  status?: { phase?: string };
}

export interface Resources {
  cpu: number;
  memory: number;
}

/** Requests and limits of the pods that hold resources (running or pending). */
export function podResources(pods: PodSpecJson[]): { requests: Resources; limits: Resources } {
  const requests = { cpu: 0, memory: 0 };
  const limits = { cpu: 0, memory: 0 };
  for (const pod of pods) {
    const phase = pod.status?.phase;
    if (phase === 'Succeeded' || phase === 'Failed') continue;
    for (const c of pod.spec?.containers ?? []) {
      requests.cpu += parseCpu(c.resources?.requests?.cpu);
      requests.memory += parseMemory(c.resources?.requests?.memory);
      limits.cpu += parseCpu(c.resources?.limits?.cpu);
      limits.memory += parseMemory(c.resources?.limits?.memory);
    }
  }
  return { requests, limits };
}

export interface PodMetricsJson {
  metadata?: Meta;
  containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
}

export interface PodUsage extends Resources {
  name: string;
}

/** CPU and memory used by each pod, from the metrics API. */
export function podUsage(metrics: PodMetricsJson[]): PodUsage[] {
  return metrics.map(m => ({
    name: m.metadata?.name ?? '',
    cpu: (m.containers ?? []).reduce((sum, c) => sum + parseCpu(c.usage?.cpu), 0),
    memory: (m.containers ?? []).reduce((sum, c) => sum + parseMemory(c.usage?.memory), 0),
  }));
}

export function totalUsage(usage: PodUsage[]): Resources {
  return usage.reduce((sum, u) => ({ cpu: sum.cpu + u.cpu, memory: sum.memory + u.memory }), {
    cpu: 0,
    memory: 0,
  });
}

/** The pods using the most of a resource. */
export function topPods(usage: PodUsage[], by: keyof Resources, count = 5): PodUsage[] {
  return [...usage].sort((a, b) => b[by] - a[by]).slice(0, count);
}
