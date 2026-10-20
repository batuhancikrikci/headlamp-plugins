import {
  findInstanceService,
  formatServiceEndpoint,
  parseServiceOverride,
  routePrefixOf,
  ServiceJSON,
  serviceProxyBase,
} from './discovery';
import { formatSeconds, isValidPromDuration, parsePromDuration } from './duration';

const svc = (
  name: string,
  selector: Record<string, string>,
  ports: Array<{ name?: string; port: number }>,
  clusterIP = '10.0.0.1'
): ServiceJSON => ({
  metadata: { name, namespace: 'monitoring' },
  spec: { selector, clusterIP, ports },
});

describe('findInstanceService', () => {
  const instance = { metadata: { name: 'kps-prometheus', namespace: 'monitoring' }, spec: {} };
  const services: ServiceJSON[] = [
    svc(
      'prometheus-operated',
      { 'app.kubernetes.io/name': 'prometheus' },
      [{ name: 'web', port: 9090 }],
      'None'
    ),
    svc(
      'kps-prometheus',
      { 'app.kubernetes.io/name': 'prometheus', 'operator.prometheus.io/name': 'kps-prometheus' },
      [
        { name: 'http-web', port: 9090 },
        { name: 'reloader-web', port: 8080 },
      ]
    ),
    svc('other-prometheus', { 'operator.prometheus.io/name': 'other' }, [
      { name: 'web', port: 9090 },
    ]),
    svc('node-exporter', { 'app.kubernetes.io/name': 'prometheus-node-exporter' }, [
      { name: 'http-metrics', port: 9100 },
    ]),
  ];

  it('prefers the instance-specific ClusterIP service and its web port', () => {
    expect(findInstanceService('Prometheus', instance, services)).toEqual({
      namespace: 'monitoring',
      name: 'kps-prometheus',
      port: 'http-web',
      scheme: 'http',
      pathPrefix: '',
    });
  });

  it('falls back to the operated service', () => {
    const ep = findInstanceService('Prometheus', instance, [services[0]]);
    expect(ep?.name).toBe('prometheus-operated');
  });

  it('never picks services of another namespace or instance', () => {
    expect(findInstanceService('Prometheus', instance, [services[2], services[3]])).toBeNull();
  });
});

describe('proxy URLs and overrides', () => {
  it('builds https proxy paths with prefixes', () => {
    expect(
      serviceProxyBase({
        namespace: 'mon',
        name: 'prom',
        port: 'https-web',
        scheme: 'https',
        pathPrefix: '/prom',
      })
    ).toBe('/api/v1/namespaces/mon/services/https:prom:https-web/proxy/prom');
  });

  it('parses and formats manual overrides', () => {
    const ep = parseServiceOverride('https://monitoring/thanos-query:9090/prefix/');
    expect(ep).toEqual({
      namespace: 'monitoring',
      name: 'thanos-query',
      port: '9090',
      scheme: 'https',
      pathPrefix: '/prefix',
    });
    expect(formatServiceEndpoint(ep!)).toBe('https://monitoring/thanos-query:9090/prefix');
    expect(parseServiceOverride('not valid')).toBeNull();
  });

  it('derives the route prefix from routePrefix or externalUrl', () => {
    expect(routePrefixOf({ routePrefix: 'prom/' })).toBe('/prom');
    expect(routePrefixOf({ externalUrl: 'https://x.example.com/alertmanager' })).toBe(
      '/alertmanager'
    );
    expect(routePrefixOf({ routePrefix: '/' })).toBe('');
  });
});

describe('durations', () => {
  it('validates and parses Prometheus durations', () => {
    expect(isValidPromDuration('30s')).toBe(true);
    expect(isValidPromDuration('1h30m')).toBe(true);
    expect(isValidPromDuration('5 m')).toBe(false);
    expect(isValidPromDuration('')).toBe(false);
    expect(parsePromDuration('1h30m')).toBe(5_400_000);
    expect(parsePromDuration('abc')).toBeNull();
  });

  it('formats seconds compactly', () => {
    expect(formatSeconds(0.25)).toBe('250ms');
    expect(formatSeconds(3725)).toBe('1h2m');
    expect(formatSeconds(undefined)).toBe('-');
  });
});
