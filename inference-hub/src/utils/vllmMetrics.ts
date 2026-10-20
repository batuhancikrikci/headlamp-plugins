/**
 * vLLM serving metrics, tolerant of the names used across vLLM versions (V0 and V1 engine,
 * counters with and without the _total suffix).
 */
import { PromVectorSample } from '../api/prometheus';
import { labelOf, maxOf, MetricSample, sumOf } from './promText';

/** Alternative names per signal, newest first. */
export const VLLM_NAMES = {
  running: ['vllm:num_requests_running'],
  waiting: ['vllm:num_requests_waiting'],
  kvCache: ['vllm:kv_cache_usage_perc', 'vllm:gpu_cache_usage_perc'],
  ttft: ['vllm:time_to_first_token_seconds'],
  itl: [
    'vllm:inter_token_latency_seconds',
    'vllm:request_time_per_output_token_seconds',
    'vllm:time_per_output_token_seconds',
  ],
  e2e: ['vllm:e2e_request_latency_seconds'],
  generationTokens: ['vllm:generation_tokens_total', 'vllm:generation_tokens'],
  promptTokens: ['vllm:prompt_tokens_total', 'vllm:prompt_tokens'],
  prefixHits: ['vllm:prefix_cache_hits_total', 'vllm:prefix_cache_hits'],
  prefixQueries: ['vllm:prefix_cache_queries_total', 'vllm:prefix_cache_queries'],
  legacyPrefixHitRate: ['vllm:gpu_prefix_cache_hit_rate'],
  preemptions: ['vllm:num_preemptions_total', 'vllm:num_preemptions'],
  requestSuccess: ['vllm:request_success_total', 'vllm:request_success'],
};

export interface VllmMetrics {
  running?: number;
  waiting?: number;
  /** KV cache usage, 0..100. */
  kvCachePercent?: number;
  /** Mean time to first token (seconds) over the window. */
  ttftSeconds?: number;
  /** Mean inter-token latency / time per output token (seconds). */
  itlSeconds?: number;
  e2eSeconds?: number;
  /** Generated tokens per second. */
  generationTps?: number;
  promptTps?: number;
  /** Prefix cache hit rate, 0..100. */
  prefixHitPercent?: number;
  /** Finished requests per second. */
  requestRate?: number;
  preemptions?: number;
  modelName?: string;
  /** Whether rates/latencies are over the last interval (true) or since start (false). */
  windowed: boolean;
}

/** Cumulative counters and histogram sums kept between scrapes to derive rates. */
export interface VllmCounters {
  at: number;
  generationTokens?: number;
  promptTokens?: number;
  prefixHits?: number;
  prefixQueries?: number;
  requestSuccess?: number;
  ttftSum?: number;
  ttftCount?: number;
  itlSum?: number;
  itlCount?: number;
  e2eSum?: number;
  e2eCount?: number;
}

function hist(samples: MetricSample[], names: string[], suffix: '_sum' | '_count') {
  return sumOf(
    samples,
    names.map(n => n + suffix)
  );
}

export function isVllmMetrics(samples: MetricSample[]): boolean {
  return samples.some(s => s.name.startsWith('vllm:'));
}

export function countersOf(samples: MetricSample[], at: number): VllmCounters {
  return {
    at,
    generationTokens: sumOf(samples, VLLM_NAMES.generationTokens),
    promptTokens: sumOf(samples, VLLM_NAMES.promptTokens),
    prefixHits: sumOf(samples, VLLM_NAMES.prefixHits),
    prefixQueries: sumOf(samples, VLLM_NAMES.prefixQueries),
    requestSuccess: sumOf(samples, VLLM_NAMES.requestSuccess),
    ttftSum: hist(samples, VLLM_NAMES.ttft, '_sum'),
    ttftCount: hist(samples, VLLM_NAMES.ttft, '_count'),
    itlSum: hist(samples, VLLM_NAMES.itl, '_sum'),
    itlCount: hist(samples, VLLM_NAMES.itl, '_count'),
    e2eSum: hist(samples, VLLM_NAMES.e2e, '_sum'),
    e2eCount: hist(samples, VLLM_NAMES.e2e, '_count'),
  };
}

function delta(cur?: number, prev?: number): number | undefined {
  if (cur === undefined || prev === undefined) return undefined;
  const d = cur - prev;
  // A counter reset (pod restart) makes the delta negative; skip that interval.
  return d >= 0 ? d : undefined;
}

function ratio(num?: number, den?: number): number | undefined {
  if (num === undefined || den === undefined || den <= 0) return undefined;
  return num / den;
}

/**
 * Metrics from one /metrics scrape. With a previous scrape, rates and latencies cover the
 * interval between the two; without one they are lifetime averages and rates are unknown.
 */
export function metricsFromScrape(
  samples: MetricSample[],
  at: number,
  previous?: VllmCounters
): { metrics: VllmMetrics; counters: VllmCounters } {
  const counters = countersOf(samples, at);
  const kv = maxOf(samples, VLLM_NAMES.kvCache);
  const base: VllmMetrics = {
    running: sumOf(samples, VLLM_NAMES.running),
    waiting: sumOf(samples, VLLM_NAMES.waiting),
    kvCachePercent: kv !== undefined ? kv * 100 : undefined,
    preemptions: sumOf(samples, VLLM_NAMES.preemptions),
    modelName: labelOf(samples, [...VLLM_NAMES.running, ...VLLM_NAMES.kvCache], 'model_name'),
    windowed: false,
  };

  const dt = previous ? (at - previous.at) / 1000 : 0;
  if (previous && dt > 0) {
    const d = (k: keyof VllmCounters) => delta(counters[k], previous[k]);
    const perSecond = (v?: number) => (v !== undefined ? v / dt : undefined);
    const hits = d('prefixHits');
    const queries = d('prefixQueries');
    return {
      counters,
      metrics: {
        ...base,
        windowed: true,
        generationTps: perSecond(d('generationTokens')),
        promptTps: perSecond(d('promptTokens')),
        requestRate: perSecond(d('requestSuccess')),
        ttftSeconds: ratio(d('ttftSum'), d('ttftCount')),
        itlSeconds: ratio(d('itlSum'), d('itlCount')),
        e2eSeconds: ratio(d('e2eSum'), d('e2eCount')),
        prefixHitPercent:
          queries && queries > 0 && hits !== undefined
            ? (hits / queries) * 100
            : legacyPrefix(samples),
      },
    };
  }
  return {
    counters,
    metrics: {
      ...base,
      ttftSeconds: ratio(counters.ttftSum, counters.ttftCount),
      itlSeconds: ratio(counters.itlSum, counters.itlCount),
      e2eSeconds: ratio(counters.e2eSum, counters.e2eCount),
      prefixHitPercent:
        ratio(counters.prefixHits, counters.prefixQueries) !== undefined
          ? (ratio(counters.prefixHits, counters.prefixQueries) as number) * 100
          : legacyPrefix(samples),
    },
  };
}

function legacyPrefix(samples: MetricSample[]): number | undefined {
  const v = maxOf(samples, VLLM_NAMES.legacyPrefixHitRate);
  return v !== undefined ? v * 100 : undefined;
}

const W = '5m';
const BY = 'namespace, pod';

function rateOf(names: string[], suffix = '') {
  return names.map(n => `sum by (${BY}) (rate(${n}${suffix}[${W}]))`).join(' or ');
}

function gaugeOf(names: string[], agg: 'sum' | 'max' = 'sum') {
  return names.map(n => `${agg} by (${BY}) (${n})`).join(' or ');
}

function meanOf(names: string[]) {
  return names
    .map(n => `(sum by (${BY}) (rate(${n}_sum[${W}])) / sum by (${BY}) (rate(${n}_count[${W}])))`)
    .join(' or ');
}

/**
 * PromQL per signal, returning one series per (namespace, pod). `or` falls back to older metric
 * names. Counter names are listed with _total only, as Prometheus stores them.
 */
export const VLLM_PROM_QUERIES = {
  running: gaugeOf(VLLM_NAMES.running),
  waiting: gaugeOf(VLLM_NAMES.waiting),
  kvCache: gaugeOf(VLLM_NAMES.kvCache, 'max'),
  ttft: meanOf(VLLM_NAMES.ttft),
  itl: meanOf(VLLM_NAMES.itl),
  e2e: meanOf(VLLM_NAMES.e2e),
  generationTps: rateOf(['vllm:generation_tokens_total']),
  promptTps: rateOf(['vllm:prompt_tokens_total']),
  requestRate: rateOf(['vllm:request_success_total']),
  prefixHit: `(${rateOf(['vllm:prefix_cache_hits_total'])}) / (${rateOf([
    'vllm:prefix_cache_queries_total',
  ])}) or ${gaugeOf(VLLM_NAMES.legacyPrefixHitRate, 'max')}`,
  preemptions: gaugeOf(['vllm:num_preemptions_total']),
};

export type VllmPromKey = keyof typeof VLLM_PROM_QUERIES;

/** Turns per-signal instant vectors into metrics per "namespace/pod". */
export function metricsFromProm(
  results: Partial<Record<VllmPromKey, PromVectorSample[]>>
): Map<string, VllmMetrics> {
  const byPod = new Map<string, VllmMetrics>();
  const set = (key: VllmPromKey, apply: (m: VllmMetrics, v: number) => void) => {
    for (const sample of results[key] || []) {
      const { namespace, pod } = sample.metric;
      if (!pod) continue;
      const value = Number(sample.value[1]);
      if (!isFinite(value)) continue;
      const id = `${namespace || ''}/${pod}`;
      const m = byPod.get(id) || { windowed: true };
      apply(m, value);
      byPod.set(id, m);
    }
  };
  set('running', (m, v) => (m.running = v));
  set('waiting', (m, v) => (m.waiting = v));
  set('kvCache', (m, v) => (m.kvCachePercent = v * 100));
  set('ttft', (m, v) => (m.ttftSeconds = v));
  set('itl', (m, v) => (m.itlSeconds = v));
  set('e2e', (m, v) => (m.e2eSeconds = v));
  set('generationTps', (m, v) => (m.generationTps = v));
  set('promptTps', (m, v) => (m.promptTps = v));
  set('requestRate', (m, v) => (m.requestRate = v));
  set('prefixHit', (m, v) => (m.prefixHitPercent = v * 100));
  set('preemptions', (m, v) => (m.preemptions = v));
  return byPod;
}

/** Totals across engines (sums for load, means for utilization and latency). */
export function aggregate(list: VllmMetrics[]): VllmMetrics {
  const vals = (pick: (m: VllmMetrics) => number | undefined) =>
    list.map(pick).filter((v): v is number => v !== undefined && isFinite(v));
  const sum = (pick: (m: VllmMetrics) => number | undefined) => {
    const v = vals(pick);
    return v.length ? v.reduce((s, x) => s + x, 0) : undefined;
  };
  const mean = (pick: (m: VllmMetrics) => number | undefined) => {
    const v = vals(pick);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  return {
    running: sum(m => m.running),
    waiting: sum(m => m.waiting),
    kvCachePercent: mean(m => m.kvCachePercent),
    ttftSeconds: mean(m => m.ttftSeconds),
    itlSeconds: mean(m => m.itlSeconds),
    e2eSeconds: mean(m => m.e2eSeconds),
    generationTps: sum(m => m.generationTps),
    promptTps: sum(m => m.promptTps),
    requestRate: sum(m => m.requestRate),
    prefixHitPercent: mean(m => m.prefixHitPercent),
    preemptions: sum(m => m.preemptions),
    windowed: list.every(m => m.windowed),
  };
}

export function formatSeconds(s?: number): string {
  if (s === undefined || !isFinite(s)) return '—';
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  return `${s.toFixed(2)} s`;
}

export function formatRate(v?: number, unit = '/s'): string {
  if (v === undefined || !isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k${unit}`;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}${unit}`;
}

export function formatPercent(v?: number): string {
  if (v === undefined || !isFinite(v)) return '—';
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}%`;
}

/** Escapes regex metacharacters for a PromQL double-quoted string (backslash doubled). */
function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}

/** Label matcher for a set of pods in one namespace. */
export function podMatcher(namespace: string, pods: string[]): string {
  return `namespace="${namespace}",pod=~"${pods.map(escapeRe).join('|')}"`;
}

/** Range queries (whole selection, one series each) for the engine charts. */
export function engineRangeQueries(matcher: string) {
  return {
    tps: `sum(rate(vllm:generation_tokens_total{${matcher}}[5m]))`,
    kv: `100 * (avg(vllm:kv_cache_usage_perc{${matcher}}) or avg(vllm:gpu_cache_usage_perc{${matcher}}))`,
    ttft: `sum(rate(vllm:time_to_first_token_seconds_sum{${matcher}}[5m])) / sum(rate(vllm:time_to_first_token_seconds_count{${matcher}}[5m]))`,
    queue: `sum(vllm:num_requests_waiting{${matcher}})`,
  };
}
