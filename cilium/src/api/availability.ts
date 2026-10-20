/**
 * Pure data model of API discovery: which Cilium resources are served in which versions, and
 * what the CRD objects say about deprecation. The fetching lives in discovery.ts.
 */
export interface ServedResource {
  plural: string;
  kind: string;
  namespaced: boolean;
  /** Group versions serving the resource, highest priority first. */
  versions: string[];
  verbs: string[];
}

export interface Availability {
  /** Whether the cilium.io API group is served at all. */
  groupInstalled: boolean;
  /** Preferred served group version per resource plural. Missing key = CRD not installed. */
  versions: Record<string, string>;
  /** Every resource served in the group, including kinds this plugin has no dedicated view for. */
  resources: Record<string, ServedResource>;
}

export interface APIResource {
  name: string;
  kind?: string;
  namespaced?: boolean;
  verbs?: string[];
}

export const EMPTY_AVAILABILITY: Availability = {
  groupInstalled: false,
  versions: {},
  resources: {},
};

/**
 * Combines the per-version resource lists into an availability map.
 *
 * @param orderedVersions - group versions, highest priority first.
 * @param resourcesByVersion - API resource list of each group version.
 */
export function buildAvailability(
  orderedVersions: string[],
  resourcesByVersion: Record<string, APIResource[]>
): Availability {
  const resources: Record<string, ServedResource> = {};
  for (const version of orderedVersions) {
    for (const resource of resourcesByVersion[version] || []) {
      if (resource.name.includes('/')) continue; // subresources such as "/status"
      const existing = resources[resource.name];
      if (existing) {
        existing.versions.push(version);
      } else {
        resources[resource.name] = {
          plural: resource.name,
          kind: resource.kind || resource.name,
          namespaced: !!resource.namespaced,
          versions: [version],
          verbs: resource.verbs || [],
        };
      }
    }
  }
  const versions: Record<string, string> = {};
  for (const [plural, resource] of Object.entries(resources)) {
    versions[plural] = resource.versions[0];
  }
  return { groupInstalled: true, versions, resources };
}

export interface CRDVersionMeta {
  name: string;
  served: boolean;
  storage: boolean;
  deprecated: boolean;
  deprecationWarning?: string;
}

export interface CRDMeta {
  plural: string;
  kind: string;
  scope: string;
  versions: CRDVersionMeta[];
  /** Cilium's own CRD schema version label, when present. */
  schemaVersion?: string;
}

export interface CRDObject {
  metadata: { name: string; labels?: Record<string, string> };
  spec: {
    group: string;
    scope: string;
    names: { kind: string; plural: string };
    versions?: Array<{
      name: string;
      served?: boolean;
      storage?: boolean;
      deprecated?: boolean;
      deprecationWarning?: string;
    }>;
  };
}

export function toCRDMeta(crd: CRDObject): CRDMeta {
  return {
    plural: crd.spec.names.plural,
    kind: crd.spec.names.kind,
    scope: crd.spec.scope,
    schemaVersion: crd.metadata.labels?.['io.cilium.k8s.crd.schema.version'],
    versions: (crd.spec.versions || []).map(v => ({
      name: v.name,
      served: v.served !== false,
      storage: !!v.storage,
      deprecated: !!v.deprecated,
      deprecationWarning: v.deprecationWarning,
    })),
  };
}

/** The deprecation warning of the given served version, if the CRD marks it deprecated. */
export function versionDeprecation(meta: CRDMeta | undefined, groupVersion: string): string | null {
  const name = groupVersion.split('/').pop();
  const version = meta?.versions.find(v => v.name === name);
  if (!version?.deprecated) return null;
  return version.deprecationWarning || `${groupVersion} ${meta?.kind || ''} is deprecated`.trim();
}
