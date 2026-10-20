/**
 * Pure logic that finds the backend kinds, other than Service, a route can reference on a cluster:
 * every served `Backend` kind (whichever implementation provides it) and the Gateway API Inference
 * Extension's `InferencePool`. Kept free of I/O so it can be unit tested.
 */
import { asArray, asRecord, asString, isPlainObject } from '../utils/objects';
import { DiscoveredGroup, DiscoveredResource, preferredVersion } from './availability';

/** Kinds offered as backends, in any API group that serves them. */
export const BACKEND_KIND_NAMES = ['Backend', 'InferencePool'];

export interface BackendKind {
  group: string;
  kind: string;
  /** Version used to list the objects, e.g. `v1alpha1`. */
  version: string;
  /** Plural resource name, e.g. `backends`. */
  plural: string;
}

/**
 * Whether an API group belongs to the Kubernetes project (core, `*.k8s.io`, `*.x-k8s.io`). Kinds
 * of other groups are specific to one implementation.
 */
export function isKubernetesGroup(group: string): boolean {
  return (
    group === '' ||
    group === 'k8s.io' ||
    group.endsWith('.k8s.io') ||
    group === 'x-k8s.io' ||
    group.endsWith('.x-k8s.io')
  );
}

export function backendKindKey(group: string, kind: string): string {
  return `${group}/${kind}`;
}

/**
 * Converts an aggregated discovery document (`apidiscovery.k8s.io` `APIGroupDiscoveryList`) to the
 * per-group form. Returns null for any other document, e.g. the legacy `APIGroupList`.
 */
export function groupsFromAggregated(document: unknown): DiscoveredGroup[] | null {
  const doc = asRecord(document);
  if (doc.kind !== 'APIGroupDiscoveryList') return null;
  return asArray<Record<string, unknown>>(doc.items)
    .filter(isPlainObject)
    .map(item => ({
      group: asString(asRecord(item.metadata).name),
      versions: asArray<Record<string, unknown>>(item.versions)
        .filter(isPlainObject)
        .map(version => ({
          version: asString(version.version),
          resources: asArray<Record<string, unknown>>(version.resources)
            .filter(isPlainObject)
            .map(
              (resource): DiscoveredResource => ({
                name: asString(resource.resource),
                kind: asString(asRecord(resource.responseKind).kind),
                namespaced: resource.scope === 'Namespaced',
                verbs: asArray<string>(resource.verbs),
              })
            ),
        })),
    }));
}

/**
 * The backend kinds served by the given groups: namespaced (backend references point into a
 * namespace) and listable. Each kind is listed once per group, with its most stable served version.
 */
export function backendKindsFrom(groups: DiscoveredGroup[]): BackendKind[] {
  const found = new Map<
    string,
    { group: string; kind: string; plural: string; versions: string[] }
  >();
  for (const group of groups) {
    if (!group.group) continue;
    for (const version of group.versions) {
      for (const resource of version.resources) {
        if (resource.name.includes('/') || !resource.kind) continue;
        if (!BACKEND_KIND_NAMES.includes(resource.kind) || resource.namespaced === false) continue;
        if (resource.verbs && !resource.verbs.includes('list')) continue;
        const key = backendKindKey(group.group, resource.kind);
        const entry = found.get(key) || {
          group: group.group,
          kind: resource.kind,
          plural: resource.name,
          versions: [],
        };
        entry.versions.push(version.version);
        found.set(key, entry);
      }
    }
  }
  return [...found.values()]
    .map(({ versions, ...entry }) => ({ ...entry, version: preferredVersion(versions) || '' }))
    .filter(entry => entry.version !== '')
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        Number(isKubernetesGroup(b.group)) - Number(isKubernetesGroup(a.group)) ||
        a.group.localeCompare(b.group)
    );
}

function hostPort(host: string, port: string): string {
  return port ? `${host}:${port}` : host;
}

/** Short description of a backend object for the name suggestions: where it sends traffic. */
export function describeBackendObject(obj: unknown): string {
  const spec = asRecord(asRecord(obj).spec);
  // Envoy Gateway Backend: spec.endpoints[] of fqdn, ip or unix.
  const endpoints = asArray<Record<string, unknown>>(spec.endpoints)
    .filter(isPlainObject)
    .map(endpoint => {
      const fqdn = asRecord(endpoint.fqdn);
      const ip = asRecord(endpoint.ip);
      const unix = asRecord(endpoint.unix);
      if (fqdn.hostname) return hostPort(asString(fqdn.hostname), asString(fqdn.port));
      if (ip.address) return hostPort(asString(ip.address), asString(ip.port));
      if (unix.path) return `unix:${asString(unix.path)}`;
      return '';
    })
    .filter(Boolean);
  if (endpoints.length > 0) return endpoints.join(', ');
  // InferencePool: spec.targetPorts[].number (v1) or spec.targetPortNumber (v1alpha2).
  const ports = asArray<Record<string, unknown>>(spec.targetPorts)
    .filter(isPlainObject)
    .map(port => asString(port.number))
    .filter(Boolean);
  if (ports.length === 0 && spec.targetPortNumber !== undefined) {
    ports.push(asString(spec.targetPortNumber));
  }
  return ports.length > 0 ? `Target port ${ports.join(', ')}` : '';
}
