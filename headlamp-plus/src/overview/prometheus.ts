/**
 * Prometheus access for the usage trends, through the Kubernetes API server service proxy. A
 * Prometheus compatible query service is found automatically (Thanos, Prometheus, Mimir,
 * VictoriaMetrics); another service can be entered by hand for the session.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

export interface PrometheusService {
  namespace: string;
  name: string;
  port: number;
  pathPrefix?: string;
}

export interface PrometheusEndpoint {
  /** Proxy path in front of /api/v1. */
  base: string;
  /** e.g. "monitoring/prometheus-operated:9090". */
  label: string;
}

interface ServiceJson {
  metadata: { name: string; namespace: string };
  spec?: { ports?: Array<{ name?: string; port: number }> };
}

/** Known query frontends: name pattern, usable ports, path prefix. Earlier entries win. */
const CANDIDATES: Array<{ match: RegExp; ports: number[]; prefix?: string }> = [
  { match: /thanos-query-frontend$/, ports: [9090, 10902] },
  { match: /thanos-query$/, ports: [9090, 10902] },
  { match: /thanos-querier$/, ports: [9090] },
  { match: /^prometheus-operated$/, ports: [9090] },
  { match: /prometheus$/, ports: [9090] },
  { match: /^prometheus-server$/, ports: [80, 9090] },
  { match: /mimir-(query-frontend|gateway|nginx)$/, ports: [8080, 80], prefix: '/prometheus' },
  { match: /^vmsingle/, ports: [8429] },
  { match: /^vmselect/, ports: [8481], prefix: '/select/0/prometheus' },
];

/** Services that look like Prometheus compatible query APIs, best first. */
export function rankPrometheusServices(services: ServiceJson[]): PrometheusService[] {
  const found: Array<{ rank: number; service: PrometheusService }> = [];
  for (const svc of services) {
    const name = svc.metadata.name;
    CANDIDATES.some((c, rank) => {
      if (!c.match.test(name)) return false;
      const port = (svc.spec?.ports || []).find(p => c.ports.includes(p.port));
      if (!port) return false;
      found.push({
        rank,
        service: { namespace: svc.metadata.namespace, name, port: port.port, pathPrefix: c.prefix },
      });
      return true;
    });
  }
  return found.sort((a, b) => a.rank - b.rank).map(f => f.service);
}

/** Parses "namespace/service:port[/path]". */
export function parseService(text: string): PrometheusService | undefined {
  const m = text.trim().match(/^([a-z0-9-]+)\/([a-z0-9-]+):(\d+)(\/.*)?$/);
  if (!m) return undefined;
  return { namespace: m[1], name: m[2], port: Number(m[3]), pathPrefix: m[4]?.replace(/\/$/, '') };
}

export function endpointOf(service: PrometheusService): PrometheusEndpoint {
  const prefix = service.pathPrefix || '';
  return {
    base: `/api/v1/namespaces/${encodeURIComponent(service.namespace)}/services/${service.name}:${
      service.port
    }/proxy${prefix}`,
    label: `${service.namespace}/${service.name}:${service.port}${prefix}`,
  };
}

export interface RangeSeries {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

const params = (cluster: string) => (cluster ? { cluster } : {});

async function query<T>(endpoint: PrometheusEndpoint, path: string, cluster: string): Promise<T> {
  const body: { status?: string; data?: { result?: T }; error?: string } = await ApiProxy.request(
    `${endpoint.base}/api/v1/${path}`,
    params(cluster)
  );
  if (body?.status !== 'success' || !Array.isArray(body.data?.result)) {
    throw new Error(body?.error || 'Unexpected Prometheus response');
  }
  return body.data!.result!;
}

/** Range query from `start` to `end` (seconds) with a step in seconds. */
export function promRange(
  endpoint: PrometheusEndpoint,
  promql: string,
  start: number,
  end: number,
  step: number,
  cluster: string
): Promise<RangeSeries[]> {
  return query<RangeSeries[]>(
    endpoint,
    `query_range?query=${encodeURIComponent(promql)}&start=${start}&end=${end}&step=${step}`,
    cluster
  );
}

const found = new Map<string, Promise<PrometheusEndpoint | null>>();

/** Finds a Prometheus service that answers PromQL (cached per cluster). */
export function discoverPrometheus(cluster: string): Promise<PrometheusEndpoint | null> {
  if (found.has(cluster)) return found.get(cluster)!;
  const promise = (async () => {
    const list: { items?: ServiceJson[] } = await ApiProxy.request(
      '/api/v1/services',
      params(cluster)
    );
    for (const service of rankPrometheusServices(list.items || []).slice(0, 5)) {
      const endpoint = endpointOf(service);
      try {
        await query(endpoint, `query?query=${encodeURIComponent('vector(1)')}`, cluster);
        return endpoint;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  })();
  found.set(cluster, promise);
  promise.catch(() => found.delete(cluster));
  return promise;
}
