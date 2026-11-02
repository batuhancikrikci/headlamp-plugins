import { describe, expect, it } from 'vitest';
import {
  clampConfig,
  histogram,
  MAX_CONCURRENCY,
  MAX_REQUESTS,
  percentile,
  RequestResult,
  runPool,
  summarize,
  toCsv,
} from './benchmark';

describe('clampConfig', () => {
  it('keeps the test within the limits', () => {
    expect(clampConfig({ concurrency: 100, requests: 9999, maxTokens: 0, prompt: 'x' })).toEqual({
      concurrency: MAX_CONCURRENCY,
      requests: MAX_REQUESTS,
      maxTokens: 1,
      prompt: 'x',
    });
    expect(
      clampConfig({ concurrency: NaN, requests: 2.6, maxTokens: 64, prompt: '' })
    ).toMatchObject({
      concurrency: 1,
      requests: 3,
    });
  });
});

describe('runPool', () => {
  it('never runs more than `concurrency` tasks at a time and keeps the order', async () => {
    let running = 0;
    let peak = 0;
    const results = await runPool(10, 3, async i => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 1));
      running--;
      return i * 2;
    });
    expect(peak).toBe(3);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('stops starting tasks when aborted', async () => {
    const controller = new AbortController();
    const done: number[] = [];
    const results = await runPool(
      20,
      2,
      async i => {
        if (i === 3) controller.abort();
        return i;
      },
      controller.signal,
      r => done.push(r)
    );
    expect(results.length).toBeLessThan(20);
    expect(done).toEqual(results);
  });
});

describe('summarize', () => {
  const results: RequestResult[] = [
    { ok: true, ttftMs: 100, totalMs: 1100, outputTokens: 100 },
    { ok: true, ttftMs: 200, totalMs: 2200, outputTokens: 100 },
    { ok: true, ttftMs: 300, totalMs: 1300, outputTokens: 50 },
    { ok: false, totalMs: 50, error: 'HTTP 503' },
  ];

  it('computes latency percentiles, throughput and errors', () => {
    const s = summarize(results, 4000);
    expect(s).toMatchObject({
      completed: 3,
      failed: 1,
      errorRate: 0.25,
      ttftMs: { p50: 200, p95: 300, p99: 300 },
      e2eMs: { p50: 1300, p95: 2200 },
      outputTokens: 250,
      totalTps: 62.5,
      requestsPerSecond: 0.75,
      errors: [{ message: 'HTTP 503', count: 1 }],
    });
    // (100 + 50 + 50) / 3 tokens per second after the first token.
    expect(s.perRequestTps).toBeCloseTo(66.67, 1);
  });

  it('handles empty runs', () => {
    expect(summarize([], 0)).toMatchObject({ completed: 0, errorRate: 0, ttftMs: {} });
    expect(percentile([], 50)).toBeUndefined();
  });

  it('builds histograms and CSV', () => {
    const buckets = histogram([100, 200, 300, 1000], 3);
    expect(buckets.map(b => b.count)).toEqual([3, 0, 1]);
    expect(histogram([])).toEqual([]);
    expect(toCsv(results).split('\n')).toEqual([
      'request,ok,ttft_ms,total_ms,output_tokens,error',
      '1,true,100,1100,100,""',
      '2,true,200,2200,100,""',
      '3,true,300,1300,50,""',
      '4,false,,50,,"HTTP 503"',
    ]);
  });
});
