/**
 * Navigation helpers for CRD OpenAPI v3 schemas, used by the documentation viewer.
 * Pure, unit tested.
 */

export interface SchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  additionalProperties?: SchemaNode | boolean;
  required?: string[];
  format?: string;
  pattern?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  'x-kubernetes-int-or-string'?: boolean;
  'x-kubernetes-validations'?: Array<{ rule: string; message?: string }>;
}

/** One entry of `spec.versions` in a CustomResourceDefinition. */
export interface SchemaVersion {
  name: string;
  served?: boolean;
  storage?: boolean;
  schema?: { openAPIV3Schema?: SchemaNode };
}

/** Splits "group/version" (or a bare core version) into its parts. */
export function splitApiVersion(apiVersion: string): { group: string; version: string } {
  const slash = apiVersion.lastIndexOf('/');
  return slash === -1
    ? { group: '', version: apiVersion }
    : { group: apiVersion.slice(0, slash), version: apiVersion.slice(slash + 1) };
}

/**
 * The CRD version whose schema should be documented: the requested one when the CRD has it,
 * otherwise the storage version, otherwise the first one listed.
 */
export function pickSchemaVersion(
  versions: SchemaVersion[] | undefined,
  wanted: string
): SchemaVersion | undefined {
  const list = versions || [];
  return list.find(v => v.name === wanted) || list.find(v => v.storage) || list[0];
}

/** The node whose children are listed when a property is opened (arrays open their items). */
export function childContainer(node: SchemaNode | undefined): SchemaNode | undefined {
  if (!node) return undefined;
  if (node.properties) return node;
  if (node.items?.properties) return node.items;
  if (typeof node.additionalProperties === 'object' && node.additionalProperties.properties) {
    return node.additionalProperties;
  }
  return undefined;
}

export function hasChildren(node: SchemaNode | undefined): boolean {
  return !!childContainer(node);
}

export interface SchemaLocation {
  /** The property the path points to (undefined at the root). */
  node?: SchemaNode;
  /** The object whose properties are listed (node itself, its items, or the root). */
  container?: SchemaNode;
}

/** Resolves a property path ("spec" › "rateLimit" › "global") in a schema. */
export function resolveSchemaPath(root: SchemaNode, path: string[]): SchemaLocation {
  let container: SchemaNode | undefined = root;
  let node: SchemaNode | undefined;
  for (const segment of path) {
    node = container?.properties?.[segment];
    container = childContainer(node);
    if (!node) return {};
  }
  return { node, container: path.length === 0 ? root : container };
}

/** Human readable type, e.g. "string", "int-or-string", "[]object", "map[string]string". */
export function typeLabel(node: SchemaNode): string {
  if (node['x-kubernetes-int-or-string']) return 'int-or-string';
  if (node.type === 'array') return `[]${node.items ? typeLabel(node.items) : 'any'}`;
  if (node.type === 'object' && !node.properties && typeof node.additionalProperties === 'object') {
    return `map[string]${typeLabel(node.additionalProperties)}`;
  }
  return node.type || 'any';
}

/**
 * Returns the value of the edited object at a schema path. Arrays are followed through their
 * first element, so "is this field set?" works for list items too.
 */
export function valueAtSchemaPath(value: unknown, path: string[]): unknown {
  let cur: unknown = value;
  for (const segment of path) {
    if (Array.isArray(cur)) cur = cur[0];
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return Array.isArray(cur) && cur.length === 0 ? undefined : cur;
}

/** Whether a field matches the filter text, by name or description, ignoring case. */
export function fieldMatches(name: string, node: SchemaNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    name.toLowerCase().includes(needle) || (node.description || '').toLowerCase().includes(needle)
  );
}

export interface FieldMatch {
  path: string[];
  node: SchemaNode;
}

/**
 * Finds fields anywhere below `root` whose name (or description, for longer queries) matches.
 * Breadth first, so shallow matches come first; `maxDepth` keeps huge embedded pod templates
 * from dominating the results.
 */
export function findFields(
  root: SchemaNode,
  query: string,
  limit = 40,
  maxDepth = 8
): FieldMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches: FieldMatch[] = [];
  const queue: Array<{ path: string[]; container: SchemaNode }> = [{ path: [], container: root }];
  while (queue.length && matches.length < limit) {
    const { path, container } = queue.shift() as { path: string[]; container: SchemaNode };
    for (const [name, prop] of Object.entries(container.properties || {})) {
      const next = [...path, name];
      const inName = name.toLowerCase().includes(q);
      const inDescription = q.length >= 4 && (prop.description || '').toLowerCase().includes(q);
      if (inName || inDescription) {
        matches.push({ path: next, node: prop });
        if (matches.length >= limit) break;
      }
      const child = childContainer(prop);
      if (child && next.length < maxDepth) queue.push({ path: next, container: child });
    }
  }
  return matches;
}

function bounds(min?: number, max?: number): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  if (min === undefined) return `≤ ${max}`;
  if (max === undefined) return `≥ ${min}`;
  return `${min} – ${max}`;
}

/** Numeric limits of a field as short labels, e.g. "value 1 – 10", "items ≤ 16". */
export function schemaLimits(node: SchemaNode): string[] {
  return [
    ['value', bounds(node.minimum, node.maximum)],
    ['items', bounds(node.minItems, node.maxItems)],
    ['length', bounds(node.minLength, node.maxLength)],
  ]
    .filter(([, text]) => text)
    .map(([label, text]) => `${label} ${text}`);
}
