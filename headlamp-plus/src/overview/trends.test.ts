import { endpointOf, parseService, rankPrometheusServices } from './prometheus';
import { rangeWindow, summarize, toPoints, trendQueries } from './trends';

describe('trends', () => {
  it('picks about 120 points with a step of at least 30 s', () => {
    expect(rangeWindow('1h', 3_600_000_000)).toEqual({
      start: 3_596_400,
      end: 3_600_000,
      step: 30,
    });
    expect(rangeWindow('7d', 3_600_000_000).step).toBe(5040);
  });

  it('builds cluster and namespace queries without pod-level cgroups', () => {
    const cluster = trendQueries(undefined, 60);
    expect(cluster.cpu).toBe(
      'sum(rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[300s]))'
    );
    expect(trendQueries('ml"x', 600).memory).toBe(
      'sum(container_memory_working_set_bytes{container!="",container!="POD",namespace="mlx"})'
    );
    expect(trendQueries('ml', 600).cpu).toContain('[1200s]');
  });

  it('reads range results', () => {
    const points = toPoints([
      {
        metric: {},
        values: [
          [100, '1.5'],
          [160, 'NaN'],
          [220, '2'],
        ],
      },
    ]);
    expect(points).toEqual([
      { ts: 100_000, value: 1.5 },
      { ts: 220_000, value: 2 },
    ]);
    expect(summarize(points)).toEqual({ min: 1.5, max: 2, last: 2 });
    expect(summarize([])).toBeUndefined();
  });
});

describe('prometheus services', () => {
  it('ranks query frontends and parses a typed service', () => {
    const svc = (namespace: string, name: string, port: number) => ({
      metadata: { name, namespace },
      spec: { ports: [{ port }] },
    });
    expect(
      rankPrometheusServices([
        svc('monitoring', 'prometheus-operated', 9090),
        svc('thanos', 'thanos-query', 10902),
        svc('x', 'grafana', 80),
      ]).map(s => s.name)
    ).toEqual(['thanos-query', 'prometheus-operated']);
    const parsed = parseService('monitoring/prometheus-operated:9090');
    expect(parsed && endpointOf(parsed).base).toBe(
      '/api/v1/namespaces/monitoring/services/prometheus-operated:9090/proxy'
    );
    expect(parseService('nope')).toBeUndefined();
  });
});
