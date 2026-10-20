/**
 * Version-dependent fields. A capability is "on" when the CRD schema of the version in use has
 * the field. The schema is only readable with `get` on customresourcedefinitions; without it
 * the state is "unknown" and forms show the field with a hint naming the minimum OCM version.
 */

export interface SchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: SchemaNode | boolean;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  'x-kubernetes-int-or-string'?: boolean;
  'x-kubernetes-validations'?: Array<{ rule: string; message?: string }>;
}

export interface CRDVersionJson {
  name: string;
  served?: boolean;
  storage?: boolean;
  deprecated?: boolean;
  deprecationWarning?: string;
  schema?: { openAPIV3Schema?: SchemaNode };
}

export interface CRDJson {
  metadata: { name: string };
  spec: {
    group: string;
    scope?: string;
    names: { kind: string; plural: string };
    versions?: CRDVersionJson[];
  };
}

export interface CapabilityInfo {
  kind: string;
  /** Path below the object root; array items are traversed transparently. */
  path: string[];
  /** First OCM release with the field (for the hint when the schema cannot be read). */
  since: string;
  label: string;
}

export const CAPABILITIES = {
  placementCelSelector: {
    kind: 'Placement',
    path: ['spec', 'predicates', 'requiredClusterSelector', 'celSelector'],
    since: 'v1.0.0',
    label: 'CEL cluster selector',
  },
  placementSortBy: {
    kind: 'Placement',
    path: ['spec', 'sortBy'],
    since: 'v1.3.0',
    label: 'Decision sort order',
  },
  placementScoreRateLimit: {
    kind: 'Placement',
    path: ['spec', 'scoreRateLimit'],
    since: 'v1.3.0',
    label: 'Score rate limit',
  },
  mwrsCascadeDeletion: {
    kind: 'ManifestWorkReplicaSet',
    path: ['spec', 'cascadeDeletionPolicy'],
    since: 'v1.0.0',
    label: 'Cascade deletion policy',
  },
  workDeleteTTL: {
    kind: 'ManifestWork',
    path: ['spec', 'deleteOption', 'ttlSecondsAfterFinished'],
    since: 'v1.0.0',
    label: 'Delete after completion (TTL)',
  },
  clusterSetManagedNamespaces: {
    kind: 'ManagedClusterSet',
    path: ['spec', 'managedNamespaces'],
    since: 'v1.1.0',
    label: 'Managed namespaces',
  },
} satisfies Record<string, CapabilityInfo>;

export type CapabilityId = keyof typeof CAPABILITIES;

export type CapabilityState = 'yes' | 'no' | 'unknown';

/** Schema of one served version of a CRD. */
export function versionSchema(crd: CRDJson | undefined, version: string): SchemaNode | undefined {
  const bare = version.includes('/') ? version.split('/').pop() : version;
  return crd?.spec.versions?.find(v => v.name === bare)?.schema?.openAPIV3Schema;
}

/** Whether `path` exists in the schema; arrays and maps are traversed through their items. */
export function schemaHasPath(schema: SchemaNode | undefined, path: string[]): boolean {
  let node: SchemaNode | undefined = schema;
  for (const segment of path) {
    while (node && !node.properties) {
      if (node.items) node = node.items;
      else if (typeof node.additionalProperties === 'object') node = node.additionalProperties;
      else break;
    }
    node = node?.properties?.[segment];
    if (!node) return false;
  }
  return true;
}

/**
 * State of a capability for the version in use.
 *
 * @param crd - the CRD object, or undefined when it could not be read.
 * @param apiVersion - the group version the plugin uses for the kind.
 */
export function capabilityState(
  id: CapabilityId,
  crd: CRDJson | undefined,
  apiVersion: string | undefined
): CapabilityState {
  if (!crd || !apiVersion) return 'unknown';
  const schema = versionSchema(crd, apiVersion);
  if (!schema) return 'unknown';
  return schemaHasPath(schema, CAPABILITIES[id].path) ? 'yes' : 'no';
}

/** Deprecation warning of the version in use, if the CRD marks it deprecated. */
export function versionDeprecation(
  crd: CRDJson | undefined,
  apiVersion: string | undefined
): string | null {
  if (!crd || !apiVersion) return null;
  const bare = apiVersion.split('/').pop();
  const version = crd.spec.versions?.find(v => v.name === bare);
  if (!version?.deprecated) return null;
  return version.deprecationWarning || `${apiVersion} ${crd.spec.names.kind} is deprecated`;
}
