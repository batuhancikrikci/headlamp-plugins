/**
 * Pure helpers of the resource efficiency dashboard: what each workload requests and what its
 * pods use, now (metrics API) or over the last day (Prometheus), to size requests right. There is
 * no cost here, only resources.
 */
import { parseCpu, parseMemory } from '../overview/clusterHealth';
import type { InstantSample } from '../overview/prometheus';

export interface EffPodJson {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
  };
  spec?: {
    containers?: Array<{ resources?: { requests?: Record<string, string> } }>;
  };
  status?: { phase?: string };
}

export interface WorkloadRef {
  kind: string;
  namespace: string;
  name: string;
}

/** The workload a pod belongs to; a ReplicaSet with a pod-template-hash counts as its Deployment. */
export function workloadOf(pod: EffPodJson): WorkloadRef {
  const namespace = pod.metadata?.namespace ?? '';
  const owners = pod.metadata?.ownerReferences ?? [];
  const owner = owners.find(o => o.controller) ?? owners[0];
  if (!owner?.kind || !owner.name) {
    return { kind: 'Pod', namespace, name: pod.metadata?.name ?? '' };
  }
  const hash = pod.metadata?.labels?.['pod-template-hash'];
  if (owner.kind === 'ReplicaSet' && hash && owner.name.endsWith(`-${hash}`)) {
    return { kind: 'Deployment', namespace, name: owner.name.slice(0, -hash.length - 1) };
  }
  return { kind: owner.kind, namespace, name: owner.name };
}

export interface Usage {
  cpu: number;
  memory: number;
}

export interface WorkloadRow extends WorkloadRef {
  pods: number;
  requested: Usage;
  /** Undefined when no pod of the workload has usage data. */
  used?: Usage;
}

const podKey = (namespace?: string, name?: string) => `${namespace ?? ''}/${name ?? ''}`;

/** Requests and usage per workload, from running pods. `usage` is keyed "namespace/pod". */
export function workloadRows(pods: EffPodJson[], usage: Map<string, Usage>): WorkloadRow[] {
  const rows = new Map<string, WorkloadRow>();
  for (const pod of pods) {
    if (pod.status?.phase !== 'Running') continue;
    const ref = workloadOf(pod);
    const key = `${ref.kind}/${ref.namespace}/${ref.name}`;
    const row = rows.get(key) ?? { ...ref, pods: 0, requested: { cpu: 0, memory: 0 } };
    row.pods += 1;
    for (const c of pod.spec?.containers ?? []) {
      row.requested.cpu += parseCpu(c.resources?.requests?.cpu);
      row.requested.memory += parseMemory(c.resources?.requests?.memory);
    }
    const used = usage.get(podKey(pod.metadata?.namespace, pod.metadata?.name));
    if (used) {
      row.used = {
        cpu: (row.used?.cpu ?? 0) + used.cpu,
        memory: (row.used?.memory ?? 0) + used.memory,
      };
    }
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** Requested but unused: positive when the workload asks for more than it uses. */
export function idle(row: WorkloadRow, resource: keyof Usage): number {
  return row.used ? row.requested[resource] - row.used[resource] : 0;
}

export type SortBy = 'idleCpu' | 'idleMemory' | 'cpu' | 'memory';

export function sortRows(rows: WorkloadRow[], by: SortBy): WorkloadRow[] {
  const value = (r: WorkloadRow) =>
    by === 'idleCpu'
      ? idle(r, 'cpu')
      : by === 'idleMemory'
      ? idle(r, 'memory')
      : by === 'cpu'
      ? r.used?.cpu ?? 0
      : r.used?.memory ?? 0;
  return [...rows].sort((a, b) => value(b) - value(a));
}

/** Usage from the metrics API's pod metrics. */
export function usageFromMetrics(
  metrics: Array<{
    metadata?: { name?: string; namespace?: string };
    containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
  }>
): Map<string, Usage> {
  return new Map(
    metrics.map(m => [
      podKey(m.metadata?.namespace, m.metadata?.name),
      {
        cpu: (m.containers ?? []).reduce((s, c) => s + parseCpu(c.usage?.cpu), 0),
        memory: (m.containers ?? []).reduce((s, c) => s + parseMemory(c.usage?.memory), 0),
      },
    ])
  );
}

const CONTAINERS = '{container!="",container!="POD"}';

/** Average CPU and peak memory per pod over the last 24 hours (5 minute resolution). */
export const DAY_QUERIES = {
  cpu: `avg_over_time(sum by (namespace, pod) (rate(container_cpu_usage_seconds_total${CONTAINERS}[5m]))[24h:5m])`,
  memory: `max_over_time(sum by (namespace, pod) (container_memory_working_set_bytes${CONTAINERS})[24h:5m])`,
};

export function usageFromPrometheus(
  cpu: InstantSample[],
  memory: InstantSample[]
): Map<string, Usage> {
  const usage = new Map<string, Usage>();
  const add = (samples: InstantSample[], resource: keyof Usage) => {
    for (const s of samples) {
      const value = Number(s.value[1]);
      if (!Number.isFinite(value)) continue;
      const key = podKey(s.metric.namespace, s.metric.pod);
      const entry = usage.get(key) ?? { cpu: 0, memory: 0 };
      entry[resource] = value;
      usage.set(key, entry);
    }
  };
  add(cpu, 'cpu');
  add(memory, 'memory');
  return usage;
}

export function totals(rows: WorkloadRow[]): {
  requested: Usage;
  used: Usage;
  withoutRequests: number;
} {
  const requested = { cpu: 0, memory: 0 };
  const used = { cpu: 0, memory: 0 };
  let withoutRequests = 0;
  for (const row of rows) {
    requested.cpu += row.requested.cpu;
    requested.memory += row.requested.memory;
    used.cpu += row.used?.cpu ?? 0;
    used.memory += row.used?.memory ?? 0;
    if (row.requested.cpu === 0 && row.requested.memory === 0) withoutRequests += 1;
  }
  return { requested, used, withoutRequests };
}
