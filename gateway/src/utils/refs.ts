/**
 * Resolution of the references Gateway API objects make to each other and to core resources.
 * Everything here works on plain JSON so it can be used from forms, views and tests alike.
 */
import {
  BackendObjectReference,
  GATEWAY_GROUP,
  ObjectReference,
  ParentReference,
} from '../resources/types';
import { asArray, asRecord, isPlainObject } from './objects';

/** A fully qualified reference: every default has been applied. */
export interface ResolvedRef {
  group: string;
  kind: string;
  /** Undefined for cluster-scoped targets. */
  namespace?: string;
  name: string;
}

export interface ResolvedParentRef extends ResolvedRef {
  sectionName?: string;
  port?: number;
}

export interface ResolvedBackendRef extends ResolvedRef {
  port?: number;
  weight?: number;
}

/** Minimal shape of an object that can be the source or target of a reference. */
export interface RefObject {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; namespace?: string };
}

export function groupOf(apiVersion?: string): string {
  if (!apiVersion || !apiVersion.includes('/')) return '';
  return apiVersion.split('/')[0];
}

/** Identity of an object as a reference target. */
export function identityOf(obj: RefObject): ResolvedRef {
  return {
    group: groupOf(obj.apiVersion),
    kind: obj.kind || '',
    namespace: obj.metadata?.namespace,
    name: obj.metadata?.name || '',
  };
}

export function refKey(ref: ResolvedRef): string {
  return `${ref.group}/${ref.kind}/${ref.namespace || ''}/${ref.name}`;
}

export function sameRef(a: ResolvedRef, b: ResolvedRef): boolean {
  return (
    a.group === b.group &&
    a.kind === b.kind &&
    a.name === b.name &&
    (a.namespace || '') === (b.namespace || '')
  );
}

/** Applies the parentRef defaults: Gateway in the route's own namespace. */
export function resolveParentRef(ref: ParentReference, namespace?: string): ResolvedParentRef {
  return {
    group: ref?.group ?? GATEWAY_GROUP,
    kind: ref?.kind ?? 'Gateway',
    namespace: ref?.namespace || namespace,
    name: ref?.name || '',
    sectionName: ref?.sectionName,
    port: ref?.port,
  };
}

/** Applies the backendRef defaults: core Service in the route's own namespace. */
export function resolveBackendRef(
  ref: BackendObjectReference & { weight?: number },
  namespace?: string
): ResolvedBackendRef {
  return {
    group: ref?.group ?? '',
    kind: ref?.kind ?? 'Service',
    namespace: ref?.namespace || namespace,
    name: ref?.name || '',
    port: ref?.port,
    weight: ref?.weight,
  };
}

/** Applies the defaults of a certificate reference: core Secret in the same namespace. */
export function resolveSecretRef(ref: ObjectReference, namespace?: string): ResolvedRef {
  return {
    group: ref?.group ?? '',
    kind: ref?.kind ?? 'Secret',
    namespace: ref?.namespace || namespace,
    name: ref?.name || '',
  };
}

/** Whether a resolved parentRef points at the given Gateway or ListenerSet. */
export function parentRefTargets(ref: ResolvedParentRef, parent: RefObject): boolean {
  const identity = identityOf(parent);
  return (
    ref.kind === identity.kind &&
    ref.group === identity.group &&
    ref.name === identity.name &&
    (ref.namespace || '') === (identity.namespace || '')
  );
}

export type BackendRefSource = 'backendRef' | 'requestMirror' | 'externalAuth';

export interface RouteBackend {
  ref: ResolvedBackendRef;
  /** Path of the reference inside the route, e.g. `spec.rules.0.backendRefs.1`. */
  path: string;
  ruleIndex: number;
  source: BackendRefSource;
}

interface RouteLike extends RefObject {
  spec?: unknown;
}

function filterBackends(
  filters: unknown,
  namespace: string | undefined,
  basePath: string,
  ruleIndex: number
): RouteBackend[] {
  const result: RouteBackend[] = [];
  asArray(filters).forEach((filter, filterIndex) => {
    if (!isPlainObject(filter)) return;
    const mirror = asRecord(filter.requestMirror).backendRef;
    if (isPlainObject(mirror)) {
      result.push({
        ref: resolveBackendRef(mirror as unknown as BackendObjectReference, namespace),
        path: `${basePath}.${filterIndex}.requestMirror.backendRef`,
        ruleIndex,
        source: 'requestMirror',
      });
    }
    const auth = asRecord(filter.externalAuth).backendRef;
    if (isPlainObject(auth)) {
      result.push({
        ref: resolveBackendRef(auth as unknown as BackendObjectReference, namespace),
        path: `${basePath}.${filterIndex}.externalAuth.backendRef`,
        ruleIndex,
        source: 'externalAuth',
      });
    }
  });
  return result;
}

/** Every backend a route forwards, mirrors or delegates authentication to. */
export function routeBackends(route: RouteLike): RouteBackend[] {
  const namespace = route.metadata?.namespace;
  const result: RouteBackend[] = [];
  asArray(asRecord(route.spec).rules).forEach((rule, ruleIndex) => {
    if (!isPlainObject(rule)) return;
    const rulePath = `spec.rules.${ruleIndex}`;
    result.push(...filterBackends(rule.filters, namespace, `${rulePath}.filters`, ruleIndex));
    asArray(rule.backendRefs).forEach((backendRef, backendIndex) => {
      if (!isPlainObject(backendRef)) return;
      const path = `${rulePath}.backendRefs.${backendIndex}`;
      result.push({
        ref: resolveBackendRef(backendRef as unknown as BackendObjectReference, namespace),
        path,
        ruleIndex,
        source: 'backendRef',
      });
      result.push(...filterBackends(backendRef.filters, namespace, `${path}.filters`, ruleIndex));
    });
  });
  return result;
}

/** The distinct backends of a route (same target and port counted once). */
export function uniqueRouteBackends(route: RouteLike): ResolvedBackendRef[] {
  const seen = new Set<string>();
  const result: ResolvedBackendRef[] = [];
  for (const backend of routeBackends(route)) {
    const key = `${refKey(backend.ref)}:${backend.ref.port ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(backend.ref);
  }
  return result;
}

/** The resolved parentRefs of a route. */
export function routeParentRefs(route: RouteLike): ResolvedParentRef[] {
  return asArray<ParentReference>(asRecord(route.spec).parentRefs)
    .filter(isPlainObject)
    .map(ref => resolveParentRef(ref as unknown as ParentReference, route.metadata?.namespace));
}

/** Whether any parentRef of the route points at the given Gateway or ListenerSet. */
export function routeTargetsParent(route: RouteLike, parent: RefObject): boolean {
  return routeParentRefs(route).some(ref => parentRefTargets(ref, parent));
}

/** Human readable form of a reference, e.g. `Service default/web:8080`. */
export function formatRef(ref: ResolvedRef & { port?: number }, options?: { omitKind?: string }) {
  const kind = ref.kind && ref.kind !== options?.omitKind ? `${ref.kind} ` : '';
  const namespace = ref.namespace ? `${ref.namespace}/` : '';
  const port = ref.port !== undefined ? `:${ref.port}` : '';
  return `${kind}${namespace}${ref.name}${port}`;
}

export function isGatewayApiGroup(group: string): boolean {
  return group === GATEWAY_GROUP;
}

interface ParentStatusLike {
  parentRef?: ParentReference;
  controllerName?: string;
  conditions?: unknown;
}

/**
 * Finds the status a controller reported for one parentRef of a route. Entries are matched on the
 * fully resolved reference, including sectionName and port.
 */
export function parentStatusFor<S extends ParentStatusLike>(
  route: RouteLike & { status?: unknown },
  ref: ResolvedParentRef
): S | undefined {
  const namespace = route.metadata?.namespace;
  return asArray<S>(asRecord(route.status).parents).find(entry => {
    if (!isPlainObject(entry) || !isPlainObject(entry.parentRef)) return false;
    const candidate = resolveParentRef(entry.parentRef as ParentReference, namespace);
    return (
      sameRef(candidate, ref) &&
      (candidate.sectionName || '') === (ref.sectionName || '') &&
      (candidate.port ?? null) === (ref.port ?? null)
    );
  });
}

/**
 * Parses what a user typed or picked in a parent selector: `name`, `namespace/name` or
 * `Kind:namespace/name`. Parts that are not present are left undefined.
 */
export function parseParentText(text: string): {
  kind?: string;
  namespace?: string;
  name: string;
} {
  const match = /^(?:([A-Za-z]+):)?(?:([^/]*)\/)?(.*)$/.exec(text.trim());
  if (!match) return { name: text.trim() };
  return {
    kind: match[1] || undefined,
    namespace: match[2] || undefined,
    name: match[3],
  };
}
