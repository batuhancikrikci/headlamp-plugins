/**
 * NVIDIA DCGM exporter metrics read from Prometheus.
 */
import { PromVectorSample } from './prometheus';

export const DCGM_QUERIES = {
  util: 'DCGM_FI_DEV_GPU_UTIL',
  memUsed: 'DCGM_FI_DEV_FB_USED',
  memFree: 'DCGM_FI_DEV_FB_FREE',
  temp: 'DCGM_FI_DEV_GPU_TEMP',
  power: 'DCGM_FI_DEV_POWER_USAGE',
} as const;

export type DcgmMetric = keyof typeof DCGM_QUERIES;

/** Cluster-wide time series for the GPU Fleet charts. */
export const DCGM_RANGE_QUERIES = {
  util: 'avg(DCGM_FI_DEV_GPU_UTIL)',
  memory: '100 * sum(DCGM_FI_DEV_FB_USED) / (sum(DCGM_FI_DEV_FB_USED) + sum(DCGM_FI_DEV_FB_FREE))',
};

export interface GpuMetrics {
  /** GPU utilization in percent. */
  util?: number;
  memUsedMiB?: number;
  memFreeMiB?: number;
  tempC?: number;
  powerW?: number;
}

export interface GpuDeviceMetrics extends GpuMetrics {
  /** GPU index or UUID. */
  id: string;
  uuid?: string;
  model?: string;
  /** Pod using the GPU (dcgm-exporter Kubernetes mapping). */
  pod?: string;
  namespace?: string;
}

export interface NodeGpuMetrics {
  gpus: GpuDeviceMetrics[];
  avg: GpuMetrics;
}

/** Node name of a DCGM series (label names differ between exporter setups). */
export function seriesNode(metric: Record<string, string>): string | undefined {
  const raw =
    metric.Hostname ||
    metric.node ||
    metric.kubernetes_node ||
    metric.nodename ||
    metric.instance?.replace(/:\d+$/, '');
  return raw || undefined;
}

/** Matches "node-1", "node-1.example.com" and similar spellings of the same node. */
export function sameNode(a: string, b: string): boolean {
  if (a === b) return true;
  return a.split('.')[0].toLowerCase() === b.split('.')[0].toLowerCase();
}

const FIELD: Record<DcgmMetric, keyof GpuMetrics> = {
  util: 'util',
  memUsed: 'memUsedMiB',
  memFree: 'memFreeMiB',
  temp: 'tempC',
  power: 'powerW',
};

/** Groups DCGM instant vectors by node and GPU. */
export function groupDcgm(
  results: Partial<Record<DcgmMetric, PromVectorSample[]>>
): Map<string, NodeGpuMetrics> {
  const byNode = new Map<string, Map<string, GpuDeviceMetrics>>();
  for (const [metric, samples] of Object.entries(results) as Array<
    [DcgmMetric, PromVectorSample[]]
  >) {
    for (const sample of samples || []) {
      const node = seriesNode(sample.metric);
      if (!node) continue;
      const id = sample.metric.UUID || sample.metric.gpu || sample.metric.device || '0';
      const gpus = byNode.get(node) || new Map<string, GpuDeviceMetrics>();
      const gpu = gpus.get(id) || {
        id: sample.metric.gpu ?? id,
        uuid: sample.metric.UUID,
        model: sample.metric.modelName,
      };
      const value = Number(sample.value[1]);
      if (isFinite(value)) gpu[FIELD[metric]] = value;
      if (sample.metric.pod) {
        gpu.pod = sample.metric.pod;
        gpu.namespace = sample.metric.namespace;
      }
      gpus.set(id, gpu);
      byNode.set(node, gpus);
    }
  }
  const result = new Map<string, NodeGpuMetrics>();
  byNode.forEach((gpus, node) => {
    const list = Array.from(gpus.values()).sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true })
    );
    result.set(node, { gpus: list, avg: average(list) });
  });
  return result;
}

function average(gpus: GpuMetrics[]): GpuMetrics {
  const avg = (key: keyof GpuMetrics) => {
    const values = gpus.map(g => g[key]).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined;
  };
  const sum = (key: keyof GpuMetrics) => {
    const values = gpus.map(g => g[key]).filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((s, v) => s + v, 0) : undefined;
  };
  return {
    util: avg('util'),
    tempC: avg('tempC'),
    memUsedMiB: sum('memUsedMiB'),
    memFreeMiB: sum('memFreeMiB'),
    powerW: sum('powerW'),
  };
}

export function metricsForNode(
  grouped: Map<string, NodeGpuMetrics> | undefined,
  node: string
): NodeGpuMetrics | undefined {
  if (!grouped) return undefined;
  const exact = grouped.get(node);
  if (exact) return exact;
  for (const [key, value] of grouped) if (sameNode(key, node)) return value;
  return undefined;
}
