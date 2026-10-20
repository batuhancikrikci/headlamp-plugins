/**
 * Resolves which Kubernetes Service fronts a given Prometheus / Alertmanager
 * custom resource and builds API-server service-proxy URLs for it.
 */
import { Labels } from '../types';
import { instancePodLabels } from './relations';

export type InstanceKind = 'Prometheus' | 'Alertmanager';

export interface ServicePort {
  name?: string;
  port: number;
  targetPort?: number | string;
  appProtocol?: string;
}

export interface ServiceJSON {
  metadata: { name: string; namespace?: string; labels?: Labels };
  spec?: { selector?: Labels; clusterIP?: string; ports?: ServicePort[] };
}

export interface ServiceEndpoint {
  namespace: string;
  name: string;
  /** Port name or number used in the proxy URL. */
  port: string;
  scheme: 'http' | 'https';
  /** Prefix under which the web UI/API is served (routePrefix), without trailing slash. */
  pathPrefix: string;
}

const DEFAULT_PORT: Record<InstanceKind, number> = { Prometheus: 9090, Alertmanager: 9093 };
const PREFERRED_PORT_NAMES = ['http-web', 'web', 'https-web', 'http'];

export function pickServicePort(service: ServiceJSON, kind: InstanceKind): ServicePort | null {
  const ports = service.spec?.ports || [];
  if (ports.length === 0) return null;
  for (const name of PREFERRED_PORT_NAMES) {
    const p = ports.find(port => port.name === name);
    if (p) return p;
  }
  return ports.find(p => p.port === DEFAULT_PORT[kind]) || ports[0];
}

function portScheme(port: ServicePort): 'http' | 'https' {
  const hint = `${port.appProtocol || ''} ${port.name || ''}`.toLowerCase();
  return hint.includes('https') ? 'https' : 'http';
}

/** Score how specifically a Service routes to the given instance (higher is better). */
function serviceScore(svc: ServiceJSON, podLabels: Labels): number {
  const selector = svc.spec?.selector || {};
  const keys = Object.keys(selector);
  if (keys.length === 0) return -1;
  for (const k of keys) {
    if (podLabels[k] !== selector[k]) return -1;
  }
  let score = keys.length;
  const specific = [
    'operator.prometheus.io/name',
    'app.kubernetes.io/instance',
    'prometheus',
    'alertmanager',
  ];
  if (keys.some(k => specific.includes(k))) score += 10;
  if (svc.spec?.clusterIP && svc.spec.clusterIP !== 'None') score += 5;
  return score;
}

/**
 * Finds the best Service for a Prometheus/Alertmanager CR among the services of
 * its namespace. Falls back to the operator-managed `<kind>-operated` service.
 */
export function findInstanceService(
  kind: InstanceKind,
  instance: {
    metadata: { name: string; namespace?: string };
    spec?: { routePrefix?: string; externalUrl?: string };
  },
  services: ServiceJSON[]
): ServiceEndpoint | null {
  const ns = instance.metadata.namespace || '';
  const podLabels = instancePodLabels(kind, instance.metadata.name);
  const candidates = services
    .filter(s => (s.metadata.namespace || '') === ns)
    .map(s => ({ s, score: serviceScore(s, podLabels) }))
    .filter(c => c.score >= 0)
    .sort((a, b) => b.score - a.score);

  let svc: ServiceJSON | undefined = candidates[0]?.s;
  if (!svc) {
    const operated = `${kind.toLowerCase()}-operated`;
    svc = services.find(s => s.metadata.name === operated && (s.metadata.namespace || '') === ns);
  }
  if (!svc) return null;

  const port = pickServicePort(svc, kind);
  if (!port) return null;
  return {
    namespace: ns,
    name: svc.metadata.name,
    port: port.name || String(port.port),
    scheme: portScheme(port),
    pathPrefix: routePrefixOf(instance.spec),
  };
}

/** Route prefix per operator semantics: routePrefix, else the path of externalUrl. */
export function routePrefixOf(spec?: { routePrefix?: string; externalUrl?: string }): string {
  let prefix = spec?.routePrefix || '';
  if (!prefix && spec?.externalUrl) {
    try {
      prefix = new URL(spec.externalUrl).pathname;
    } catch {
      prefix = '';
    }
  }
  prefix = prefix.replace(/\/+$/, '');
  if (prefix && !prefix.startsWith('/')) prefix = `/${prefix}`;
  return prefix;
}

/** API-server service proxy path (without the cluster prefix, ApiProxy adds it). */
export function serviceProxyBase(ep: ServiceEndpoint): string {
  const scheme = ep.scheme === 'https' ? 'https:' : '';
  return `/api/v1/namespaces/${encodeURIComponent(
    ep.namespace
  )}/services/${scheme}${encodeURIComponent(ep.name)}:${encodeURIComponent(ep.port)}/proxy${
    ep.pathPrefix
  }`;
}

/**
 * Parses a manual override: `namespace/service:port[/prefix]`, optionally with
 * an `https://` prefix, e.g. `monitoring/prometheus-k8s:web` or
 * `https://monitoring/thanos-query:9090/prefix`.
 */
export function parseServiceOverride(value: string | undefined | null): ServiceEndpoint | null {
  if (!value) return null;
  let v = value.trim();
  let scheme: 'http' | 'https' = 'http';
  const schemeMatch = v.match(/^(https?):\/\//);
  if (schemeMatch) {
    scheme = schemeMatch[1] as 'http' | 'https';
    v = v.slice(schemeMatch[0].length);
  }
  const m = v.match(/^([a-z0-9-]+)\/([a-z0-9-.]+):([a-zA-Z0-9-]+)(\/.*)?$/);
  if (!m) return null;
  return {
    namespace: m[1],
    name: m[2],
    port: m[3],
    scheme,
    pathPrefix: (m[4] || '').replace(/\/+$/, ''),
  };
}

export function formatServiceEndpoint(ep: ServiceEndpoint): string {
  return `${ep.scheme === 'https' ? 'https://' : ''}${ep.namespace}/${ep.name}:${ep.port}${
    ep.pathPrefix
  }`;
}
