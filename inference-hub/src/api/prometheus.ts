/**
 * Prometheus access.
 *
 * Queries go through the Kubernetes API server service proxy (auto-discovered or configured
 * service), or, only when the user configures a direct URL, straight from the browser.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { PrometheusServiceRef, PrometheusSettings } from '../settings/settings';
import { clusterParams, serviceProxyPath } from './paths';

export interface PrometheusEndpoint {
  kind: 'proxy' | 'url';
  /** Proxy path (kind 'proxy') or absolute URL (kind 'url') in front of /api/v1. */
  base: string;
  orgId?: string;
  /** Human readable description, e.g. "monitoring/prometheus-operated:9090". */
  label: string;
}

interface ServiceJson {
  metadata: { name: string; namespace: string };
  spec?: { ports?: Array<{ name?: string; port: number }> };
}

/**
 * Known query frontends: name pattern, usable ports, path prefix. Earlier entries win.
 * Thanos comes first: it sees the long-term and global (multi-Prometheus) view, and its query
 * frontend adds caching and query splitting on top of the querier.
 */
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

/** Ranks services that look like Prometheus compatible query APIs (pure, for tests). */
export function rankPrometheusServices(services: ServiceJson[]): PrometheusServiceRef[] {
  const found: Array<{ rank: number; ref: PrometheusServiceRef }> = [];
  for (const svc of services) {
    const name = svc.metadata.name;
    CANDIDATES.some((c, rank) => {
      if (!c.match.test(name)) return false;
      const port = (svc.spec?.ports || []).find(p => c.ports.includes(p.port));
      if (!port) return false;
      found.push({
        rank,
        ref: {
          namespace: svc.metadata.namespace,
          name,
          port: port.port,
          pathPrefix: c.prefix,
        },
      });
      return true;
    });
  }
  return found.sort((a, b) => a.rank - b.rank).map(f => f.ref);
}

export function endpointFromService(ref: PrometheusServiceRef, orgId?: string): PrometheusEndpoint {
  return {
    kind: 'proxy',
    base: serviceProxyPath(ref.namespace, ref.name, ref.port, ref.scheme) + (ref.pathPrefix || ''),
    orgId,
    label: `${ref.namespace}/${ref.name}:${ref.port}${ref.pathPrefix || ''}`,
  };
}

export interface PromVectorSample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PromMatrixSeries {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

interface PromResponse<T> {
  status: 'success' | 'error';
  data?: { resultType: string; result: T };
  error?: string;
}

async function promGet<T>(endpoint: PrometheusEndpoint, path: string, cluster: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (endpoint.orgId) headers['X-Scope-OrgID'] = endpoint.orgId;
  let body: PromResponse<T>;
  if (endpoint.kind === 'url') {
    const resp = await fetch(endpoint.base.replace(/\/$/, '') + path, { headers });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    body = await resp.json();
  } else {
    body = await ApiProxy.request(endpoint.base + path, clusterParams(cluster, { headers }));
  }
  if (body?.status !== 'success' || !body.data) {
    throw new Error(body?.error || 'Unexpected Prometheus response');
  }
  return body.data.result;
}

export function promQuery(
  endpoint: PrometheusEndpoint,
  query: string,
  cluster: string
): Promise<PromVectorSample[]> {
  return promGet(endpoint, `/api/v1/query?query=${encodeURIComponent(query)}`, cluster);
}

export function promQueryRange(
  endpoint: PrometheusEndpoint,
  query: string,
  cluster: string,
  rangeSeconds: number,
  stepSeconds: number
): Promise<PromMatrixSeries[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - rangeSeconds;
  const q = encodeURIComponent(query);
  return promGet(
    endpoint,
    `/api/v1/query_range?query=${q}&start=${start}&end=${end}&step=${stepSeconds}`,
    cluster
  );
}

/** Checks that the endpoint answers PromQL. */
export async function testEndpoint(endpoint: PrometheusEndpoint, cluster: string) {
  const result = await promQuery(endpoint, 'vector(1)', cluster);
  if (!Array.isArray(result)) throw new Error('Unexpected Prometheus response');
}

const autoCache = new Map<string, PrometheusEndpoint | null>();
const autoInflight = new Map<string, Promise<PrometheusEndpoint | null>>();

/** Finds a working Prometheus service in the cluster (cached per cluster). */
export function autoDiscoverPrometheus(
  cluster: string,
  force = false
): Promise<PrometheusEndpoint | null> {
  if (!force && autoCache.has(cluster)) return Promise.resolve(autoCache.get(cluster) ?? null);
  const running = autoInflight.get(cluster);
  if (running) return running;
  const promise = (async () => {
    const list: { items?: ServiceJson[] } = await ApiProxy.request(
      '/api/v1/services',
      clusterParams(cluster)
    );
    for (const ref of rankPrometheusServices(list.items || []).slice(0, 5)) {
      const endpoint = endpointFromService(ref);
      try {
        await testEndpoint(endpoint, cluster);
        return endpoint;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  })()
    .then(result => {
      autoCache.set(cluster, result);
      return result;
    })
    .finally(() => autoInflight.delete(cluster));
  autoInflight.set(cluster, promise);
  return promise;
}

/** Resolves the endpoint configured in the settings (null when disabled or not found). */
export async function resolvePrometheus(
  settings: PrometheusSettings,
  cluster: string,
  force = false
): Promise<PrometheusEndpoint | null> {
  switch (settings.mode) {
    case 'off':
      return null;
    case 'url':
      return settings.url
        ? { kind: 'url', base: settings.url, orgId: settings.orgId, label: settings.url }
        : null;
    case 'service':
      return settings.service ? endpointFromService(settings.service, settings.orgId) : null;
    default: {
      const found = await autoDiscoverPrometheus(cluster, force);
      return found ? { ...found, orgId: settings.orgId } : null;
    }
  }
}
