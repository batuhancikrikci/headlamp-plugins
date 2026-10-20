/**
 * ReferenceGrant evaluation: which cross-namespace references an object makes, and whether a
 * ReferenceGrant in the target namespace permits each of them.
 *
 * Only references that the Gateway API guards with ReferenceGrant are considered: route backends,
 * and the certificate / CA references of Gateways and ListenerSets. A route attaching to a Gateway
 * in another namespace is governed by the listener's `allowedRoutes` instead (see attachment.ts).
 *
 * @see https://gateway-api.sigs.k8s.io/api-types/referencegrant/
 */
import { ObjectReference, ReferenceGrantFrom, ReferenceGrantTo } from '../resources/types';
import { asArray, asRecord, isPlainObject } from './objects';
import { groupOf, RefObject, ResolvedRef, resolveSecretRef, routeBackends } from './refs';

const ROUTE_KINDS = new Set(['HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute', 'UDPRoute']);
const LISTENER_KINDS = new Set(['Gateway', 'ListenerSet']);

interface GrantLike {
  metadata?: { name?: string; namespace?: string };
  spec?: unknown;
}

interface SourceObject extends RefObject {
  spec?: unknown;
}

export interface OutgoingRef {
  /** The object making the reference. */
  from: ResolvedRef;
  to: ResolvedRef;
  /** Path of the reference inside the source object. */
  path: string;
  /** What the reference is used for, e.g. `Backend` or `TLS certificate`. */
  purpose: string;
}

export type GrantState = 'same-namespace' | 'granted' | 'denied' | 'unknown';

export interface CheckedRef extends OutgoingRef {
  state: GrantState;
  /** Name of the ReferenceGrant that permits the reference, when granted. */
  grantName?: string;
}

function certificateRefs(listeners: unknown, from: ResolvedRef, basePath: string): OutgoingRef[] {
  const result: OutgoingRef[] = [];
  asArray(listeners).forEach((listener, listenerIndex) => {
    const tls = asRecord(asRecord(listener).tls);
    asArray(tls.certificateRefs).forEach((ref, refIndex) => {
      if (!isPlainObject(ref)) return;
      result.push({
        from,
        to: resolveSecretRef(ref as unknown as ObjectReference, from.namespace),
        path: `${basePath}.${listenerIndex}.tls.certificateRefs.${refIndex}`,
        purpose: 'TLS certificate',
      });
    });
  });
  return result;
}

function caRefs(validation: unknown, from: ResolvedRef, basePath: string): OutgoingRef[] {
  return asArray(asRecord(validation).caCertificateRefs)
    .map((ref, index) => ({ ref, index }))
    .filter(({ ref }) => isPlainObject(ref))
    .map(({ ref, index }) => {
      const reference = ref as unknown as ObjectReference;
      return {
        from,
        to: {
          group: reference.group ?? '',
          kind: reference.kind ?? 'ConfigMap',
          namespace: reference.namespace || from.namespace,
          name: reference.name || '',
        },
        path: `${basePath}.caCertificateRefs.${index}`,
        purpose: 'Client CA certificate',
      };
    });
}

/** Every reference of the object that may cross a namespace boundary. */
export function outgoingRefs(obj: SourceObject): OutgoingRef[] {
  const kind = obj.kind || '';
  const from: ResolvedRef = {
    group: groupOf(obj.apiVersion),
    kind,
    namespace: obj.metadata?.namespace,
    name: obj.metadata?.name || '',
  };
  const spec = asRecord(obj.spec);

  if (ROUTE_KINDS.has(kind)) {
    return routeBackends(obj).map(backend => ({
      from,
      to: backend.ref,
      path: backend.path,
      purpose:
        backend.source === 'requestMirror'
          ? 'Mirror backend'
          : backend.source === 'externalAuth'
          ? 'External auth backend'
          : 'Backend',
    }));
  }

  if (LISTENER_KINDS.has(kind)) {
    const result = certificateRefs(spec.listeners, from, 'spec.listeners');
    if (kind === 'Gateway') {
      const tls = asRecord(spec.tls);
      const clientCert = asRecord(tls.backend).clientCertificateRef;
      if (isPlainObject(clientCert)) {
        result.push({
          from,
          to: resolveSecretRef(clientCert as unknown as ObjectReference, from.namespace),
          path: 'spec.tls.backend.clientCertificateRef',
          purpose: 'Backend client certificate',
        });
      }
      const frontend = asRecord(tls.frontend);
      result.push(
        ...caRefs(
          asRecord(frontend.default).validation,
          from,
          'spec.tls.frontend.default.validation'
        )
      );
      asArray(frontend.perPort).forEach((entry, index) => {
        result.push(
          ...caRefs(
            asRecord(asRecord(entry).tls).validation,
            from,
            `spec.tls.frontend.perPort.${index}.tls.validation`
          )
        );
      });
    }
    return result;
  }

  return [];
}

export function isCrossNamespace(ref: OutgoingRef): boolean {
  return !!ref.to.namespace && !!ref.from.namespace && ref.to.namespace !== ref.from.namespace;
}

/** Whether a single ReferenceGrant permits the reference. */
export function grantPermits(grant: GrantLike, ref: OutgoingRef): boolean {
  if (!grant.metadata?.namespace || grant.metadata.namespace !== ref.to.namespace) return false;
  const spec = asRecord(grant.spec);
  const fromMatches = asArray<ReferenceGrantFrom>(spec.from).some(
    from =>
      isPlainObject(from) &&
      (from.group ?? '') === ref.from.group &&
      from.kind === ref.from.kind &&
      from.namespace === ref.from.namespace
  );
  if (!fromMatches) return false;
  return asArray<ReferenceGrantTo>(spec.to).some(
    to =>
      isPlainObject(to) &&
      (to.group ?? '') === ref.to.group &&
      to.kind === ref.to.kind &&
      (!to.name || to.name === ref.to.name)
  );
}

/** Finds the ReferenceGrant permitting the reference, if any. */
export function findGrant<G extends GrantLike>(ref: OutgoingRef, grants: G[]): G | undefined {
  return grants.find(grant => grantPermits(grant, ref));
}

/**
 * Checks one reference against the known ReferenceGrants. Pass `null` when the grants could not
 * be listed (missing permission or CRD): cross-namespace references are then reported as unknown
 * instead of denied.
 */
export function checkRef(ref: OutgoingRef, grants: GrantLike[] | null): CheckedRef {
  if (!isCrossNamespace(ref)) return { ...ref, state: 'same-namespace' };
  if (grants === null) return { ...ref, state: 'unknown' };
  const grant = findGrant(ref, grants);
  return grant
    ? { ...ref, state: 'granted', grantName: grant.metadata?.name }
    : { ...ref, state: 'denied' };
}

/** Checks every reference of the object. */
export function checkReferences(obj: SourceObject, grants: GrantLike[] | null): CheckedRef[] {
  return outgoingRefs(obj).map(ref => checkRef(ref, grants));
}

/** The cross-namespace references of the object that no ReferenceGrant permits. */
export function deniedReferences(obj: SourceObject, grants: GrantLike[] | null): CheckedRef[] {
  return checkReferences(obj, grants).filter(ref => ref.state === 'denied');
}

/** The references (across the given objects) that rely on this ReferenceGrant. */
export function grantUsage(grant: GrantLike, objects: SourceObject[]): OutgoingRef[] {
  return objects
    .flatMap(obj => outgoingRefs(obj))
    .filter(ref => isCrossNamespace(ref) && grantPermits(grant, ref));
}

/** Builds the ReferenceGrant spec entries that would permit the reference. */
export function grantFor(ref: OutgoingRef): { from: ReferenceGrantFrom; to: ReferenceGrantTo } {
  return {
    from: { group: ref.from.group, kind: ref.from.kind, namespace: ref.from.namespace || '' },
    to: { group: ref.to.group, kind: ref.to.kind, name: ref.to.name },
  };
}
