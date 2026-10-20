import { parsePromText } from './promText';
import {
  aggregate,
  formatSeconds,
  metricsFromProm,
  metricsFromScrape,
  podMatcher,
  VLLM_PROM_QUERIES,
} from './vllmMetrics';

const V1 = `
# HELP vllm:num_requests_running Number of requests in model execution batches.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 3.0
vllm:num_requests_waiting{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1.0
vllm:kv_cache_usage_perc{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 0.42
vllm:generation_tokens_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1000.0
vllm:prompt_tokens_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 4000.0
vllm:prefix_cache_hits_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 300.0
vllm:prefix_cache_queries_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1000.0
vllm:request_success_total{engine="0",finished_reason="stop",model_name="Qwen/Qwen2.5-7B-Instruct"} 8.0
vllm:request_success_total{engine="0",finished_reason="length",model_name="Qwen/Qwen2.5-7B-Instruct"} 2.0
vllm:time_to_first_token_seconds_bucket{engine="0",le="+Inf",model_name="Qwen/Qwen2.5-7B-Instruct"} 10.0
vllm:time_to_first_token_seconds_sum{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 2.0
vllm:time_to_first_token_seconds_count{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 10.0
vllm:inter_token_latency_seconds_sum{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 25.0
vllm:inter_token_latency_seconds_count{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1000.0
python_gc_objects_collected_total{generation="0"} 123.0
`;

// Older V0 engine names.
const V0 = `
vllm:num_requests_running{model_name="m"} 1
vllm:gpu_cache_usage_perc{model_name="m"} 0.9
vllm:gpu_prefix_cache_hit_rate{model_name="m"} 0.25
vllm:time_per_output_token_seconds_sum{model_name="m"} 1
vllm:time_per_output_token_seconds_count{model_name="m"} 50
`;

describe('parsePromText', () => {
  it('parses labels, special values and skips comments', () => {
    const samples = parsePromText(
      '# TYPE x gauge\nx{a="1",b="q\\"uote"} 2.5\ny 3 1700000000\nz{} +Inf\nbad line\n'
    );
    expect(samples).toEqual([
      { name: 'x', labels: { a: '1', b: 'q"uote' }, value: 2.5 },
      { name: 'y', labels: {}, value: 3 },
      { name: 'z', labels: {}, value: Infinity },
    ]);
  });
});

describe('metricsFromScrape', () => {
  it('reads V1 gauges and lifetime averages from a single scrape', () => {
    const { metrics } = metricsFromScrape(parsePromText(V1), 1000);
    expect(metrics).toMatchObject({
      running: 3,
      waiting: 1,
      kvCachePercent: 42,
      ttftSeconds: 0.2,
      itlSeconds: 0.025,
      prefixHitPercent: 30,
      modelName: 'Qwen/Qwen2.5-7B-Instruct',
      windowed: false,
    });
    expect(metrics.generationTps).toBeUndefined();
  });

  it('derives rates from two scrapes', () => {
    const first = metricsFromScrape(parsePromText(V1), 0);
    const later = V1.replace(
      'generation_tokens_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1000.0',
      'generation_tokens_total{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 1500.0'
    )
      .replace(
        'time_to_first_token_seconds_sum{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 2.0',
        'time_to_first_token_seconds_sum{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 3.0'
      )
      .replace(
        'time_to_first_token_seconds_count{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 10.0',
        'time_to_first_token_seconds_count{engine="0",model_name="Qwen/Qwen2.5-7B-Instruct"} 12.0'
      );
    const { metrics } = metricsFromScrape(parsePromText(later), 10000, first.counters);
    expect(metrics.windowed).toBe(true);
    expect(metrics.generationTps).toBe(50);
    expect(metrics.ttftSeconds).toBe(0.5);
    // No new prefix cache queries in the interval: no rate.
    expect(metrics.prefixHitPercent).toBeUndefined();
  });

  it('ignores counter resets', () => {
    const first = metricsFromScrape(parsePromText(V1), 0);
    const reset = V1.replace('1000.0\nvllm:prompt', '5.0\nvllm:prompt');
    const { metrics } = metricsFromScrape(parsePromText(reset), 10000, first.counters);
    expect(metrics.generationTps).toBeUndefined();
  });

  it('falls back to V0 metric names', () => {
    const { metrics } = metricsFromScrape(parsePromText(V0), 0);
    expect(metrics).toMatchObject({ kvCachePercent: 90, prefixHitPercent: 25, itlSeconds: 0.02 });
  });
});

describe('Prometheus path', () => {
  it('builds tolerant queries', () => {
    expect(VLLM_PROM_QUERIES.kvCache).toContain('vllm:kv_cache_usage_perc');
    expect(VLLM_PROM_QUERIES.kvCache).toContain(' or ');
    expect(VLLM_PROM_QUERIES.itl).toContain('vllm:time_per_output_token_seconds_sum');
  });

  it('maps vectors per pod', () => {
    const v = (pod: string, value: number) => ({
      metric: { namespace: 'ai', pod },
      value: [0, String(value)] as [number, string],
    });
    const byPod = metricsFromProm({
      running: [v('a', 2), v('b', 1)],
      kvCache: [v('a', 0.5)],
      generationTps: [v('a', 120.5)],
      ttft: [v('b', 'NaN' as unknown as number)],
    });
    expect(byPod.get('ai/a')).toMatchObject({
      running: 2,
      kvCachePercent: 50,
      generationTps: 120.5,
    });
    expect(byPod.get('ai/b')?.ttftSeconds).toBeUndefined();
    expect(aggregate([...byPod.values()])).toMatchObject({ running: 3, generationTps: 120.5 });
  });
});

describe('formatting', () => {
  it('formats latencies', () => {
    expect(formatSeconds(0.1234)).toBe('123 ms');
    expect(formatSeconds(2.5)).toBe('2.50 s');
    expect(formatSeconds(undefined)).toBe('—');
  });
});

describe('podMatcher', () => {
  it('escapes regex metacharacters for PromQL strings', () => {
    expect(podMatcher('ai', ['a.b-0', 'c'])).toBe('namespace="ai",pod=~"a\\\\.b-0|c"');
  });
});
