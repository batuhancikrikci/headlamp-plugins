/**
 * GPU efficiency: how much the GPUs given to model endpoints (and other workloads) are used over
 * a time window, and which of them sit idle.
 *
 * GPU utilization comes from the DCGM exporter (per pod, through its Kubernetes mapping); traffic
 * comes from vLLM's request and token counters. Everything here is pure.
 */
import type { PromVectorSample } from '../api/prometheus';
import type { ModelEndpoint } from '../resources/endpoint';
import type { GpuWorkload } from '../resources/gpu';

export const WINDOWS = [
  { id: '1h', label: '1 hour', hours: 1 },
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '7d', label: '7 days', hours: 168 },
] as const;
export type WindowId = (typeof WINDOWS)[number]['id'];

export const DEFAULT_IDLE_THRESHOLD = 5;

/** PromQL per signal over the window, one series per pod. */
export function efficiencyQueries(window: WindowId) {
  return {
    // dcgm-exporter maps GPUs to pods; with honor_labels off Prometheus renames the pod labels
    // to exported_*, so both spellings are kept.
    util: `avg by (namespace, pod, exported_namespace, exported_pod) (avg_over_time(DCGM_FI_DEV_GPU_UTIL[${window}]))`,
    requests: `sum by (namespace, pod) (increase(vllm:request_success_total[${window}]))`,
    tokens: `sum by (namespace, pod) (increase(vllm:generation_tokens_total[${window}]))`,
  };
}

export interface PodUsage {
  /** Average GPU utilization in percent. */
  util?: number;
  requests?: number;
  /** Generated tokens. */
  tokens?: number;
}

function podKey(namespace: string | undefined, pod: string | undefined) {
  return `${namespace || ''}/${pod || ''}`;
}

/** Usage per "namespace/pod" from the results of efficiencyQueries. */
export function usageFromProm(results: {
  util?: PromVectorSample[];
  requests?: PromVectorSample[];
  tokens?: PromVectorSample[];
}): Map<string, PodUsage> {
  const usage = new Map<string, PodUsage>();
  const utilSamples = new Map<string, number[]>();
  const add = (
    samples: PromVectorSample[] | undefined,
    field: keyof PodUsage,
    labels: (m: Record<string, string>) => [string | undefined, string | undefined]
  ) => {
    for (const sample of samples || []) {
      const [namespace, pod] = labels(sample.metric);
      const value = Number(sample.value[1]);
      if (!pod || !isFinite(value)) continue;
      const key = podKey(namespace, pod);
      const entry = usage.get(key) || {};
      if (field === 'util') {
        // Several GPUs of one pod: their mean utilization.
        const values = [...(utilSamples.get(key) || []), value];
        utilSamples.set(key, values);
        entry.util = values.reduce((sum, v) => sum + v, 0) / values.length;
      } else {
        entry[field] = (entry[field] || 0) + value;
      }
      usage.set(key, entry);
    }
  };
  add(results.util, 'util', m =>
    m.exported_pod ? [m.exported_namespace, m.exported_pod] : [m.namespace, m.pod]
  );
  add(results.requests, 'requests', m => [m.namespace, m.pod]);
  add(results.tokens, 'tokens', m => [m.namespace, m.pod]);
  return usage;
}

export type EfficiencyState = 'busy' | 'underused' | 'idle' | 'stopped' | 'unknown';

export interface EfficiencyRow {
  endpoint?: ModelEndpoint;
  /** "namespace/name" of the endpoint, or "namespace/pod" of another workload. */
  id: string;
  pods: string[];
  gpus: number;
  /** GPU-weighted average utilization, when DCGM reports the pods. */
  util?: number;
  requests?: number;
  tokens?: number;
  tokensPerGpuHour?: number;
  state: EfficiencyState;
}

function gpuCount(workload: GpuWorkload): number {
  return Object.values(workload.requests).reduce((sum, n) => sum + n, 0);
}

function summarize(
  pods: GpuWorkload[],
  usage: Map<string, PodUsage>,
  hours: number,
  threshold: number,
  fallbackGpus = 0
): Omit<EfficiencyRow, 'id' | 'endpoint' | 'state'> & { state?: EfficiencyState } {
  const gpus = pods.length ? pods.reduce((sum, p) => sum + gpuCount(p), 0) : fallbackGpus;
  let weighted = 0;
  let weight = 0;
  let requests: number | undefined;
  let tokens: number | undefined;
  for (const pod of pods) {
    const u = usage.get(podKey(pod.namespace, pod.pod));
    if (!u) continue;
    if (u.util !== undefined) {
      const w = Math.max(1, gpuCount(pod));
      weighted += u.util * w;
      weight += w;
    }
    if (u.requests !== undefined) requests = (requests || 0) + u.requests;
    if (u.tokens !== undefined) tokens = (tokens || 0) + u.tokens;
  }
  const util = weight > 0 ? weighted / weight : undefined;
  let state: EfficiencyState;
  if (util === undefined && requests === undefined) state = 'unknown';
  else if ((util ?? 0) < threshold && !requests) state = 'idle';
  else if (util !== undefined && util < threshold) state = 'underused';
  else state = 'busy';
  return {
    pods: pods.map(p => p.pod),
    gpus,
    util,
    requests,
    tokens,
    tokensPerGpuHour: tokens !== undefined && gpus > 0 ? tokens / (gpus * hours) : undefined,
    state,
  };
}

/**
 * Efficiency of every endpoint that holds GPUs (or is stopped), and of the GPU workloads that
 * belong to no endpoint.
 */
export function efficiencyRows(
  endpoints: ModelEndpoint[],
  workloads: GpuWorkload[],
  usage: Map<string, PodUsage>,
  hours: number,
  threshold = DEFAULT_IDLE_THRESHOLD
): EfficiencyRow[] {
  const running = workloads.filter(w => w.phase === 'Running' || w.phase === 'Pending');
  const rows: EfficiencyRow[] = endpoints
    .map(endpoint => {
      const pods = running.filter(
        w =>
          w.namespace === endpoint.namespace &&
          w.endpoint?.kind === endpoint.kind &&
          w.endpoint?.name === endpoint.name
      );
      const id = `${endpoint.namespace}/${endpoint.name}`;
      if (endpoint.status.health === 'stopped') {
        return { endpoint, id, pods: [], gpus: 0, state: 'stopped' as const };
      }
      const s = summarize(pods, usage, hours, threshold, pods.length ? 0 : endpoint.totalGpus);
      return { endpoint, id, ...s, state: s.state || 'unknown' };
    })
    .filter(row => row.gpus > 0 || row.state === 'stopped');

  const others = running
    .filter(w => !w.endpoint && gpuCount(w) > 0)
    .map(w => {
      const s = summarize([w], usage, hours, threshold);
      return { id: `${w.namespace}/${w.pod}`, ...s, state: s.state || 'unknown' };
    });

  const order: Record<EfficiencyState, number> = {
    idle: 0,
    underused: 1,
    unknown: 2,
    busy: 3,
    stopped: 4,
  };
  return [...rows, ...others].sort(
    (a, b) => order[a.state] - order[b.state] || b.gpus - a.gpus || a.id.localeCompare(b.id)
  );
}

export interface EfficiencyTotals {
  gpus: number;
  idleGpus: number;
  /** GPU-weighted average utilization of the rows that report it. */
  util?: number;
  tokensPerGpuHour?: number;
}

export function efficiencyTotals(rows: EfficiencyRow[], hours: number): EfficiencyTotals {
  const active = rows.filter(r => r.state !== 'stopped');
  const gpus = active.reduce((sum, r) => sum + r.gpus, 0);
  const measured = active.filter(r => r.util !== undefined);
  const weight = measured.reduce((sum, r) => sum + r.gpus, 0);
  const tokens = active.reduce((sum, r) => sum + (r.tokens || 0), 0);
  const tokenGpus = active.filter(r => r.tokens !== undefined).reduce((s, r) => s + r.gpus, 0);
  return {
    gpus,
    idleGpus: active.filter(r => r.state === 'idle').reduce((sum, r) => sum + r.gpus, 0),
    util:
      weight > 0
        ? measured.reduce((sum, r) => sum + (r.util || 0) * r.gpus, 0) / weight
        : undefined,
    tokensPerGpuHour: tokenGpus > 0 ? tokens / (tokenGpus * hours) : undefined,
  };
}
