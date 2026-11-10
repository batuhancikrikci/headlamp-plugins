/**
 * Usage trends from Prometheus: CPU and memory used by the containers of the cluster or of one
 * namespace, from the kubelet's cAdvisor metrics (container_cpu_usage_seconds_total and
 * container_memory_working_set_bytes), which most Prometheus setups scrape. The pause container
 * and pod-level cgroups (no container label) are left out so nothing is counted twice.
 */
import type { RangeSeries } from './prometheus';

export const RANGES = ['1h', '6h', '24h', '7d'] as const;
export type TrendRange = (typeof RANGES)[number];

const SECONDS: Record<TrendRange, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
};

/** About this many points per chart. */
const POINTS = 120;

/** Start, end and step (seconds) of a range ending now. */
export function rangeWindow(range: TrendRange, nowMs = Date.now()) {
  const end = Math.floor(nowMs / 1000);
  const span = SECONDS[range];
  // A step of at least 30 s keeps the rate window meaningful.
  const step = Math.max(30, Math.round(span / POINTS));
  return { start: end - span, end, step };
}

function selector(namespace?: string): string {
  const parts = ['container!=""', 'container!="POD"'];
  if (namespace) parts.push(`namespace="${namespace.replace(/["\\]/g, '')}"`);
  return `{${parts.join(',')}}`;
}

/** PromQL of the CPU (cores) and memory (bytes) used, for the cluster or one namespace. */
export function trendQueries(namespace?: string, step = 60) {
  // The rate window covers several scrapes even for short steps.
  const window = `${Math.max(5 * 60, step * 2)}s`;
  return {
    cpu: `sum(rate(container_cpu_usage_seconds_total${selector(namespace)}[${window}]))`,
    memory: `sum(container_memory_working_set_bytes${selector(namespace)})`,
  };
}

export interface TrendPoint {
  ts: number;
  value: number;
}

/** The first series of a range result as points; non-numeric samples are dropped. */
export function toPoints(series: RangeSeries[] | undefined): TrendPoint[] {
  return (series?.[0]?.values || [])
    .map(([ts, v]) => ({ ts: ts * 1000, value: Number(v) }))
    .filter(p => Number.isFinite(p.value));
}

/** Lowest, highest and latest value of a trend. */
export function summarize(points: TrendPoint[]) {
  if (points.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.value);
    max = Math.max(max, p.value);
  }
  return { min, max, last: points[points.length - 1].value };
}

/** Axis label of a timestamp: the time of day for short ranges, the date for a week. */
export function timeLabel(ts: number, range: TrendRange): string {
  const date = new Date(ts);
  return range === '7d'
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
