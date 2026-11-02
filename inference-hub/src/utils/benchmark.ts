/**
 * A small load test for model endpoints: a number of chat requests sent with a fixed
 * concurrency, and the latency and throughput they saw. Everything here is pure; the requests
 * themselves are made by the caller.
 */

/** Limits that keep a test from hurting an endpoint that serves real traffic. */
export const MAX_CONCURRENCY = 32;
export const MAX_REQUESTS = 500;
/**
 * Browsers open at most 6 HTTP/1.1 connections to one host. Headlamp desktop talks to its local
 * backend over HTTP/1.1, so higher concurrency waits in the browser.
 */
export const BROWSER_CONNECTIONS = 6;

export interface BenchmarkConfig {
  concurrency: number;
  requests: number;
  maxTokens: number;
  prompt: string;
}

export const PROMPT_PRESETS = [
  {
    id: 'short',
    label: 'Short question',
    prompt: 'In two sentences, what is Kubernetes?',
    maxTokens: 128,
  },
  {
    id: 'reasoning',
    label: 'Step-by-step answer',
    prompt:
      'A cluster has 4 nodes with 8 GPUs each. Three models need 2, 4 and 8 GPUs per replica. How many replicas of each fit if all three must run at least once? Explain step by step.',
    maxTokens: 512,
  },
  {
    id: 'long',
    label: 'Long generation',
    prompt:
      'Write a detailed guide on running large language models on Kubernetes: model serving, GPU scheduling, autoscaling, routing and monitoring.',
    maxTokens: 1024,
  },
] as const;

export function clampConfig(config: BenchmarkConfig): BenchmarkConfig {
  const int = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
  return {
    ...config,
    concurrency: int(config.concurrency, 1, MAX_CONCURRENCY),
    requests: int(config.requests, 1, MAX_REQUESTS),
    maxTokens: int(config.maxTokens, 1, 32768),
  };
}

export interface RequestResult {
  ok: boolean;
  /** ms from send to the first token (streaming). */
  ttftMs?: number;
  /** ms from send to the last byte. */
  totalMs: number;
  outputTokens?: number;
  error?: string;
  /** Cut off by stopping the test; not counted in the summary. */
  aborted?: boolean;
}

/**
 * Runs `total` tasks with at most `concurrency` at a time, in order of their index. Stops
 * starting new tasks once `signal` is aborted.
 */
export async function runPool<T>(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
  signal?: AbortSignal,
  onDone?: (result: T, index: number) => void
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < total && !signal?.aborted) {
      const index = next++;
      const result = await task(index);
      results[index] = result;
      onDone?.(result, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, worker));
  return results.filter(r => r !== undefined);
}

/** Nearest-rank percentile; undefined for no values. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface Percentiles {
  p50?: number;
  p95?: number;
  p99?: number;
}

function percentiles(values: number[]): Percentiles {
  return { p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99) };
}

export interface BenchmarkSummary {
  completed: number;
  failed: number;
  errorRate: number;
  ttftMs: Percentiles;
  e2eMs: Percentiles;
  /** Mean output tokens per second of one request, after its first token. */
  perRequestTps?: number;
  /** Output tokens per second of the whole run. */
  totalTps?: number;
  requestsPerSecond?: number;
  outputTokens: number;
  wallMs: number;
  /** Most frequent error messages. */
  errors: Array<{ message: string; count: number }>;
}

export function summarize(all: RequestResult[], wallMs: number): BenchmarkSummary {
  const results = all.filter(r => !r.aborted);
  const ok = results.filter(r => r.ok);
  const failed = results.length - ok.length;
  const outputTokens = ok.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
  const speeds = ok
    .filter(r => r.outputTokens && r.ttftMs !== undefined && r.totalMs > r.ttftMs)
    .map(r => (r.outputTokens! * 1000) / (r.totalMs - r.ttftMs!));
  const counts = new Map<string, number>();
  for (const r of results) {
    if (!r.ok) counts.set(r.error || 'Error', (counts.get(r.error || 'Error') || 0) + 1);
  }
  const seconds = wallMs / 1000;
  return {
    completed: ok.length,
    failed,
    errorRate: results.length ? failed / results.length : 0,
    ttftMs: percentiles(ok.flatMap(r => (r.ttftMs !== undefined ? [r.ttftMs] : []))),
    e2eMs: percentiles(ok.map(r => r.totalMs)),
    perRequestTps: speeds.length ? speeds.reduce((s, v) => s + v, 0) / speeds.length : undefined,
    totalTps: seconds > 0 && outputTokens > 0 ? outputTokens / seconds : undefined,
    requestsPerSecond: seconds > 0 ? ok.length / seconds : undefined,
    outputTokens,
    wallMs,
    errors: [...counts.entries()]
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export interface HistogramBucket {
  /** Upper bound in ms. */
  upTo: number;
  count: number;
}

/** Latencies in `buckets` equal-width buckets between the minimum and the maximum. */
export function histogram(values: number[], buckets = 10): HistogramBucket[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max(1, (max - min) / buckets);
  const out = Array.from({ length: buckets }, (_, i) => ({
    upTo: min + width * (i + 1),
    count: 0,
  }));
  for (const v of values) {
    out[Math.min(buckets - 1, Math.floor((v - min) / width))].count++;
  }
  return out;
}

/** Results as CSV, one line per request. */
export function toCsv(results: RequestResult[]): string {
  const rows = results.map((r, i) =>
    [
      i + 1,
      r.ok,
      r.ttftMs?.toFixed(0) ?? '',
      r.totalMs.toFixed(0),
      r.outputTokens ?? '',
      JSON.stringify(r.error || ''),
    ].join(',')
  );
  return ['request,ok,ttft_ms,total_ms,output_tokens,error', ...rows].join('\n');
}
