/**
 * Pure helpers of the network dashboard: services by type, load balancers without an address,
 * services without ready endpoints, ingresses without an address or with missing backends, and
 * namespaces that run pods without any NetworkPolicy.
 */
import { Issue, PENDING_GRACE_MS } from '../overview/clusterHealth';
import { SYSTEM_NAMESPACES } from './security';

interface Meta {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
}

export interface NetServiceJson {
  metadata?: Meta;
  spec?: { type?: string; selector?: Record<string, string>; clusterIP?: string };
  status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
}

export interface EndpointSliceJson {
  metadata?: Meta;
  endpoints?: Array<{ conditions?: { ready?: boolean } }>;
}

interface Backend {
  service?: { name?: string };
}

export interface IngressJson {
  metadata?: Meta;
  spec?: {
    ingressClassName?: string;
    defaultBackend?: Backend;
    rules?: Array<{ host?: string; http?: { paths?: Array<{ backend?: Backend }> } }>;
  };
  status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
}

export interface NetworkPolicyJson {
  metadata?: Meta;
}

export interface NamespacedJson {
  metadata?: Meta;
}

export const SERVICE_TYPES = ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'] as const;

export function serviceTypes(services: NetServiceJson[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(SERVICE_TYPES.map(t => [t, 0]));
  for (const svc of services) {
    const type = svc.spec?.type || 'ClusterIP';
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

const key = (namespace?: string, name?: string) => `${namespace ?? ''}/${name ?? ''}`;

/** Ready endpoints per service ("namespace/name"), from the EndpointSlices. */
export function readyEndpoints(slices: EndpointSliceJson[]): Map<string, number> {
  const ready = new Map<string, number>();
  for (const slice of slices) {
    const service = slice.metadata?.labels?.['kubernetes.io/service-name'];
    if (!service) continue;
    const k = key(slice.metadata?.namespace, service);
    const count = (slice.endpoints ?? []).filter(e => e.conditions?.ready !== false).length;
    ready.set(k, (ready.get(k) ?? 0) + count);
  }
  return ready;
}

function olderThanGrace(meta: Meta | undefined, now: number): boolean {
  const created = Date.parse(meta?.creationTimestamp ?? '');
  return Number.isNaN(created) || now - created > PENDING_GRACE_MS;
}

export function serviceIssues(
  services: NetServiceJson[],
  slices: EndpointSliceJson[],
  now: number = Date.now()
): Issue[] {
  const ready = readyEndpoints(slices);
  const issues: Issue[] = [];
  for (const svc of services) {
    const name = svc.metadata?.name ?? '';
    const namespace = svc.metadata?.namespace;
    const base = {
      kind: 'Service',
      name,
      namespace,
      link: { route: 'service', params: { namespace: namespace ?? '', name } },
    };
    if (!olderThanGrace(svc.metadata, now)) continue;
    if (svc.spec?.type === 'LoadBalancer' && !(svc.status?.loadBalancer?.ingress ?? []).length) {
      issues.push({
        ...base,
        level: 'warning',
        title: 'No external address',
        detail: 'The LoadBalancer service has no address; is a load balancer controller running?',
      });
    }
    const selects = Object.keys(svc.spec?.selector ?? {}).length > 0;
    if (selects && svc.spec?.type !== 'ExternalName' && !(ready.get(key(namespace, name)) ?? 0)) {
      issues.push({
        ...base,
        level: 'warning',
        title: 'No ready endpoints',
        detail: 'No ready pod matches its selector, so connections to it fail.',
      });
    }
  }
  return issues;
}

/** Service names an ingress sends traffic to. */
export function ingressBackends(ingress: IngressJson): string[] {
  const names = new Set<string>();
  const add = (b?: Backend) => b?.service?.name && names.add(b.service.name);
  add(ingress.spec?.defaultBackend);
  for (const rule of ingress.spec?.rules ?? []) {
    for (const path of rule.http?.paths ?? []) add(path.backend);
  }
  return [...names];
}

export function ingressIssues(
  ingresses: IngressJson[],
  services: NetServiceJson[],
  now: number = Date.now()
): Issue[] {
  const known = new Set(services.map(s => key(s.metadata?.namespace, s.metadata?.name)));
  const issues: Issue[] = [];
  for (const ing of ingresses) {
    const name = ing.metadata?.name ?? '';
    const namespace = ing.metadata?.namespace;
    const base = {
      kind: 'Ingress',
      name,
      namespace,
      link: { route: 'ingress', params: { namespace: namespace ?? '', name } },
    };
    const missing = ingressBackends(ing).filter(s => !known.has(key(namespace, s)));
    if (missing.length > 0) {
      issues.push({
        ...base,
        level: 'error',
        title: 'Backend service missing',
        detail: missing.join(', '),
      });
    }
    if (olderThanGrace(ing.metadata, now) && !(ing.status?.loadBalancer?.ingress ?? []).length) {
      issues.push({
        ...base,
        level: 'warning',
        title: 'No address',
        detail: ing.spec?.ingressClassName
          ? `No controller of class ${ing.spec.ingressClassName} has published an address.`
          : 'No ingress class is set and no controller has published an address.',
      });
    }
  }
  return issues;
}

export interface PolicyRow {
  namespace: string;
  pods: number;
  policies: number;
}

/** Namespaces with running pods and how many NetworkPolicies select in them. */
export function policyCoverage(
  pods: NamespacedJson[],
  policies: NetworkPolicyJson[],
  includeSystem = false
): PolicyRow[] {
  const rows = new Map<string, PolicyRow>();
  for (const pod of pods) {
    const ns = pod.metadata?.namespace ?? '';
    if (!includeSystem && SYSTEM_NAMESPACES.includes(ns)) continue;
    const row = rows.get(ns) ?? { namespace: ns, pods: 0, policies: 0 };
    row.pods += 1;
    rows.set(ns, row);
  }
  for (const policy of policies) {
    const row = rows.get(policy.metadata?.namespace ?? '');
    if (row) row.policies += 1;
  }
  return [...rows.values()].sort(
    (a, b) => Number(a.policies > 0) - Number(b.policies > 0) || b.pods - a.pods
  );
}
