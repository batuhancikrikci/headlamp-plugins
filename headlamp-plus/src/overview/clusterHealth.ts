/**
 * Pure helpers behind the cluster overview: health of nodes, pods and workloads, the list of
 * things that need attention, and capacity/usage numbers. They work on plain Kubernetes JSON.
 */

export type Level = 'error' | 'warning';

export interface Issue {
  level: Level;
  kind: string;
  namespace?: string;
  name: string;
  uid?: string;
  title: string;
  detail?: string;
}

interface Condition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

interface Meta {
  name?: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  ownerReferences?: { kind?: string }[];
}

export interface NodeJson {
  metadata?: Meta;
  spec?: { unschedulable?: boolean };
  status?: {
    conditions?: Condition[];
    allocatable?: Record<string, string>;
    capacity?: Record<string, string>;
    nodeInfo?: { kubeletVersion?: string };
  };
}

interface ContainerStatus {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string; message?: string };
    terminated?: { reason?: string; exitCode?: number };
  };
}

export interface PodJson {
  metadata?: Meta;
  status?: {
    phase?: string;
    reason?: string;
    message?: string;
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
  };
}

export interface WorkloadJson {
  kind?: string;
  metadata?: Meta;
  spec?: { replicas?: number };
  status?: {
    readyReplicas?: number;
    numberReady?: number;
    desiredNumberScheduled?: number;
  };
}

export interface MetricsJson {
  metadata?: Meta;
  usage?: { cpu?: string; memory?: string };
}

// ---------------------------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------------------------

const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
};
const DECIMAL: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 };

/** CPU quantity ("250m", "2", "1500000n") in cores. */
export function parseCpu(value?: string): number {
  if (!value) return 0;
  const match = /^([0-9.]+)([num]?)$/.exec(value.trim());
  if (!match) return 0;
  const scale = { n: 1e-9, u: 1e-6, m: 1e-3, '': 1 }[match[2] as 'n' | 'u' | 'm' | ''];
  return parseFloat(match[1]) * scale;
}

/** Memory quantity ("16Gi", "512Mi", "1G", "1024") in bytes. */
export function parseMemory(value?: string): number {
  if (!value) return 0;
  const match = /^([0-9.]+(?:e[0-9]+)?)([A-Za-z]*)$/.exec(value.trim());
  if (!match) return 0;
  const scale =
    match[2] === '' ? 1 : BINARY[match[2]] ?? DECIMAL[match[2]] ?? (match[2] === 'm' ? 1e-3 : 0);
  return parseFloat(match[1]) * scale;
}

export function formatCores(cores: number): string {
  return cores >= 10 ? cores.toFixed(0) : cores.toFixed(1);
}

export function formatGiB(bytes: number): string {
  const gib = bytes / 2 ** 30;
  return gib >= 10 ? gib.toFixed(0) : gib.toFixed(1);
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

const PRESSURE_CONDITIONS: Record<string, string> = {
  MemoryPressure: 'Memory pressure',
  DiskPressure: 'Disk pressure',
  PIDPressure: 'PID pressure',
  NetworkUnavailable: 'Network unavailable',
};

export function isNodeReady(node: NodeJson): boolean {
  return !!node.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True');
}

/** Roles from the `node-role.kubernetes.io/<role>` labels; "worker" when there is none. */
export function nodeRoles(node: NodeJson): string[] {
  const roles = Object.keys(node.metadata?.labels ?? {})
    .filter(label => label.startsWith('node-role.kubernetes.io/'))
    .map(label => label.slice('node-role.kubernetes.io/'.length))
    .filter(Boolean)
    .sort();
  return roles.length > 0 ? roles : ['worker'];
}

export function nodeIssues(node: NodeJson): Issue[] {
  const base = { kind: 'Node', name: node.metadata?.name ?? '', uid: node.metadata?.uid };
  const issues: Issue[] = [];
  if (!isNodeReady(node)) {
    const ready = node.status?.conditions?.find(c => c.type === 'Ready');
    issues.push({
      ...base,
      level: 'error',
      title: 'Node is not ready',
      detail: ready?.message || ready?.reason,
    });
  }
  for (const condition of node.status?.conditions ?? []) {
    const title = condition.type ? PRESSURE_CONDITIONS[condition.type] : undefined;
    if (title && condition.status === 'True') {
      issues.push({ ...base, level: 'warning', title, detail: condition.message });
    }
  }
  if (node.spec?.unschedulable) {
    issues.push({
      ...base,
      level: 'warning',
      title: 'Scheduling disabled',
      detail: 'The node is cordoned; new pods are not scheduled on it.',
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Pods
// ---------------------------------------------------------------------------------------------

const FAILING_WAIT_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'InvalidImageName',
  'CreateContainerConfigError',
  'CreateContainerError',
  'RunContainerError',
]);

/** A pod pending longer than this is reported. */
export const PENDING_GRACE_MS = 5 * 60 * 1000;

export interface PodPhases {
  running: number;
  pending: number;
  succeeded: number;
  failed: number;
  unknown: number;
}

export function podPhases(pods: PodJson[]): PodPhases {
  const phases: PodPhases = { running: 0, pending: 0, succeeded: 0, failed: 0, unknown: 0 };
  for (const pod of pods) {
    const phase = (pod.status?.phase ?? 'Unknown').toLowerCase();
    if (phase in phases) phases[phase as keyof PodPhases] += 1;
    else phases.unknown += 1;
  }
  return phases;
}

export function podIssues(pod: PodJson, now: number = Date.now()): Issue[] {
  const base = {
    kind: 'Pod',
    name: pod.metadata?.name ?? '',
    namespace: pod.metadata?.namespace,
    uid: pod.metadata?.uid,
  };
  const phase = pod.status?.phase;
  if (phase === 'Succeeded') return [];
  if (phase === 'Failed') {
    return [
      {
        ...base,
        level: 'error',
        title: `Pod failed${pod.status?.reason ? ` (${pod.status.reason})` : ''}`,
        detail: pod.status?.message,
      },
    ];
  }

  const containers = [
    ...(pod.status?.initContainerStatuses ?? []),
    ...(pod.status?.containerStatuses ?? []),
  ];
  const failing = containers.find(c => FAILING_WAIT_REASONS.has(c.state?.waiting?.reason ?? ''));
  if (failing) {
    const restarts = failing.restartCount ? ` · ${failing.restartCount} restarts` : '';
    return [
      {
        ...base,
        level: 'error',
        title: `${failing.state?.waiting?.reason}`,
        detail: `Container ${failing.name}${restarts}${
          failing.state?.waiting?.message ? `: ${failing.state.waiting.message}` : ''
        }`,
      },
    ];
  }

  if (phase === 'Pending') {
    const created = Date.parse(pod.metadata?.creationTimestamp ?? '');
    if (!Number.isNaN(created) && now - created > PENDING_GRACE_MS) {
      return [
        {
          ...base,
          level: 'warning',
          title: 'Pod is pending',
          detail: pod.status?.message || 'Not scheduled or still starting after 5 minutes.',
        },
      ];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------------------------
// Workloads
// ---------------------------------------------------------------------------------------------

/** Desired and ready replica counts of a Deployment, StatefulSet or DaemonSet. */
export function workloadReplicas(workload: WorkloadJson): { desired: number; ready: number } {
  const status = workload.status ?? {};
  return status.desiredNumberScheduled !== undefined
    ? { desired: status.desiredNumberScheduled, ready: status.numberReady ?? 0 }
    : { desired: workload.spec?.replicas ?? 0, ready: status.readyReplicas ?? 0 };
}

export function isWorkloadHealthy(workload: WorkloadJson): boolean {
  const { desired, ready } = workloadReplicas(workload);
  return ready >= desired;
}

export function workloadIssues(kind: string, workload: WorkloadJson): Issue[] {
  const { desired, ready } = workloadReplicas(workload);
  if (ready >= desired) return [];
  return [
    {
      kind,
      name: workload.metadata?.name ?? '',
      namespace: workload.metadata?.namespace,
      uid: workload.metadata?.uid,
      level: ready === 0 ? 'error' : 'warning',
      title: ready === 0 ? 'No replica is ready' : 'Not all replicas are ready',
      detail: `${ready} of ${desired} ready`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

/** Errors first, then by kind (Node, workloads, Pod) and name. */
export function sortIssues(issues: Issue[]): Issue[] {
  const kindRank = (kind: string) => (kind === 'Node' ? 0 : kind === 'Pod' ? 2 : 1);
  return [...issues].sort(
    (a, b) =>
      Number(a.level !== 'error') - Number(b.level !== 'error') ||
      kindRank(a.kind) - kindRank(b.kind) ||
      `${a.namespace ?? ''}/${a.name}`.localeCompare(`${b.namespace ?? ''}/${b.name}`)
  );
}

export interface Usage {
  used: number;
  total: number;
}

export interface ClusterCapacity {
  /** Cores. `used` is undefined without metrics. */
  cpu: { used?: number; total: number };
  /** Bytes. `used` is undefined without metrics. */
  memory: { used?: number; total: number };
  /** Pod slots (allocatable `pods` of every node). */
  podSlots: number;
}

export function clusterCapacity(
  nodes: NodeJson[],
  metrics?: MetricsJson[] | null
): ClusterCapacity {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const allocatable = (key: string) => nodes.map(node => node.status?.allocatable?.[key]);
  return {
    cpu: {
      total: sum(allocatable('cpu').map(parseCpu)),
      used: metrics ? sum(metrics.map(m => parseCpu(m.usage?.cpu))) : undefined,
    },
    memory: {
      total: sum(allocatable('memory').map(parseMemory)),
      used: metrics ? sum(metrics.map(m => parseMemory(m.usage?.memory))) : undefined,
    },
    podSlots: sum(allocatable('pods').map(value => parseInt(value ?? '0', 10) || 0)),
  };
}

/** Usage of one node, or undefined when it has no metrics. */
export function nodeUsage(
  node: NodeJson,
  metrics?: MetricsJson[] | null
): { cpu: Usage; memory: Usage } | undefined {
  const metric = metrics?.find(m => m.metadata?.name === node.metadata?.name);
  if (!metric) return undefined;
  return {
    cpu: { used: parseCpu(metric.usage?.cpu), total: parseCpu(node.status?.allocatable?.cpu) },
    memory: {
      used: parseMemory(metric.usage?.memory),
      total: parseMemory(node.status?.allocatable?.memory),
    },
  };
}

/** Tone for a utilisation ratio: calm below 75%, warning below 90%, error above. */
export function usageTone(used: number, total: number): 'success' | 'warning' | 'error' {
  const ratio = total > 0 ? used / total : 0;
  return ratio >= 0.9 ? 'error' : ratio >= 0.75 ? 'warning' : 'success';
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

export interface JobJson {
  metadata?: Meta;
  status?: { conditions?: Condition[]; active?: number };
}

export interface CronJobJson {
  metadata?: Meta;
  spec?: { suspend?: boolean };
}

export type JobState = 'failed' | 'complete' | 'active';

/** State of a Job or JobSet from its conditions ("Complete"/"Completed", "Failed"). */
export function jobState(job: JobJson): JobState {
  const isTrue = (types: string[]) =>
    !!job.status?.conditions?.some(c => types.includes(c.type ?? '') && c.status === 'True');
  if (isTrue(['Failed'])) return 'failed';
  return isTrue(['Complete', 'Completed']) ? 'complete' : 'active';
}

export function jobIssues(kind: string, job: JobJson): Issue[] {
  if (jobState(job) !== 'failed') return [];
  const failed = job.status?.conditions?.find(c => c.type === 'Failed');
  return [
    {
      kind,
      name: job.metadata?.name ?? '',
      namespace: job.metadata?.namespace,
      uid: job.metadata?.uid,
      level: 'error',
      title: `${kind} failed${failed?.reason ? ` (${failed.reason})` : ''}`,
      detail: failed?.message,
    },
  ];
}

/** Sum of desired and ready replicas over workloads. */
export function totalReplicas(workloads: WorkloadJson[]): { desired: number; ready: number } {
  return workloads.reduce(
    (sum, workload) => {
      const { desired, ready } = workloadReplicas(workload);
      return { desired: sum.desired + desired, ready: sum.ready + Math.min(ready, desired) };
    },
    { desired: 0, ready: 0 }
  );
}
