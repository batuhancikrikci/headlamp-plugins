/**
 * Route attachment analysis: given a route, one of its parentRefs and the parent Gateway (or
 * ListenerSet), work out which listeners the route can attach to and why not otherwise.
 *
 * This mirrors what a controller evaluates before it reports `Accepted` on the route, so the UI
 * can explain a rejection (or predict one in the wizards) without waiting for the status.
 *
 * @see https://gateway-api.sigs.k8s.io/concepts/api-overview/#attaching-routes-to-gateways
 */
import {
  AllowedRoutes,
  GATEWAY_GROUP,
  LabelSelector,
  Listener,
  ListenerStatus,
  RouteGroupKind,
} from '../resources/types';
import { effectiveHostnames } from './hostnames';
import { asArray, asRecord, isPlainObject } from './objects';
import { RefObject, ResolvedParentRef, routeParentRefs, routeTargetsParent } from './refs';

/** Route kinds each well-known listener protocol serves when `allowedRoutes.kinds` is unset. */
const PROTOCOL_ROUTE_KINDS: Record<string, string[]> = {
  HTTP: ['HTTPRoute', 'GRPCRoute'],
  HTTPS: ['HTTPRoute', 'GRPCRoute'],
  TLS: ['TLSRoute', 'TCPRoute'],
  TCP: ['TCPRoute'],
  UDP: ['UDPRoute'],
};

const HOSTNAME_ROUTE_KINDS = new Set(['HTTPRoute', 'GRPCRoute', 'TLSRoute']);

/** Route kinds a listener with the given protocol (and TLS mode) serves by default. */
export function defaultRouteKinds(protocol: string, tlsMode?: string): string[] {
  if (protocol === 'TLS') {
    // Passthrough keeps TLS end to end (TLSRoute only). Terminate, the default mode, hands the
    // decrypted stream to the backend, which TCPRoute and (since v1.5) TLSRoute can describe.
    return tlsMode === 'Passthrough' ? ['TLSRoute'] : ['TCPRoute', 'TLSRoute'];
  }
  return PROTOCOL_ROUTE_KINDS[protocol] || [];
}

/** Whether a label selector matches a label set. An empty selector matches everything. */
export function matchesSelector(
  selector: LabelSelector | undefined,
  labels: Record<string, string> | undefined
): boolean {
  const actual = labels || {};
  for (const [key, value] of Object.entries(
    asRecord<Record<string, string>>(selector?.matchLabels)
  )) {
    if (actual[key] !== value) return false;
  }
  for (const requirement of asArray<NonNullable<LabelSelector['matchExpressions']>[number]>(
    selector?.matchExpressions
  )) {
    if (!isPlainObject(requirement)) continue;
    const has = Object.prototype.hasOwnProperty.call(actual, requirement.key);
    const values = asArray<string>(requirement.values);
    switch (requirement.operator) {
      case 'In':
        if (!has || !values.includes(actual[requirement.key])) return false;
        break;
      case 'NotIn':
        if (has && values.includes(actual[requirement.key])) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

export type Tristate = 'yes' | 'no' | 'unknown';

/** Labels per namespace name; `undefined` when namespaces could not be listed. */
export type NamespaceLabels = Record<string, Record<string, string>> | undefined;

/** Whether the listener admits routes from `routeNamespace`. */
export function namespaceAllowed(
  allowedRoutes: AllowedRoutes | undefined,
  parentNamespace: string | undefined,
  routeNamespace: string | undefined,
  namespaceLabels?: NamespaceLabels
): Tristate {
  const from = allowedRoutes?.namespaces?.from ?? 'Same';
  switch (from) {
    case 'All':
      return 'yes';
    case 'Same':
      return parentNamespace === routeNamespace ? 'yes' : 'no';
    case 'None':
      return 'no';
    case 'Selector': {
      if (!namespaceLabels || !routeNamespace || !namespaceLabels[routeNamespace]) {
        return 'unknown';
      }
      return matchesSelector(allowedRoutes?.namespaces?.selector, namespaceLabels[routeNamespace])
        ? 'yes'
        : 'no';
    }
    default:
      return 'unknown';
  }
}

/** Whether the listener serves routes of the given kind. */
export function kindAllowed(
  listener: Listener,
  routeKind: string,
  routeGroup: string = GATEWAY_GROUP,
  supportedKinds?: RouteGroupKind[]
): boolean {
  const explicit = asArray<RouteGroupKind>(listener.allowedRoutes?.kinds).filter(isPlainObject);
  // The status lists what the controller actually supports; prefer it when present.
  const kinds =
    supportedKinds && supportedKinds.length > 0
      ? supportedKinds
      : explicit.length > 0
      ? explicit
      : undefined;
  if (kinds) {
    return kinds.some(k => k.kind === routeKind && (k.group ?? GATEWAY_GROUP) === routeGroup);
  }
  if (routeGroup !== GATEWAY_GROUP) return false;
  const defaults = defaultRouteKinds(listener.protocol, listener.tls?.mode);
  // Unknown (implementation specific) protocols: do not claim a mismatch.
  return defaults.length === 0 || defaults.includes(routeKind);
}

export interface ListenerVerdict {
  listener: Listener;
  /** Whether the route attaches to this listener; `unknown` when a namespace selector could not be evaluated. */
  attaches: Tristate;
  /** Reasons the route does not attach (empty when it does). */
  reasons: string[];
  /** Hostnames the route serves on this listener; `null` means all. */
  hostnames: string[] | null;
}

export interface AttachmentVerdict {
  /** Listeners selected by the parentRef (sectionName / port). */
  listeners: ListenerVerdict[];
  attaches: Tristate;
  /** Why nothing attaches, when that is the case. */
  summary?: string;
}

interface RouteLike extends RefObject {
  spec?: unknown;
}

interface ParentLike extends RefObject {
  spec?: unknown;
  status?: unknown;
}

function listenersOf(parent: ParentLike): Listener[] {
  return asArray<Listener>(asRecord(parent.spec).listeners).filter(isPlainObject) as Listener[];
}

function listenerStatus(parent: ParentLike, name: string): ListenerStatus | undefined {
  return asArray<ListenerStatus>(asRecord(parent.status).listeners).find(l => l?.name === name);
}

/**
 * Evaluates whether `route` attaches to `parent` (a Gateway or ListenerSet) through `parentRef`.
 */
export function evaluateAttachment(
  route: RouteLike,
  parentRef: Pick<ResolvedParentRef, 'sectionName' | 'port'>,
  parent: ParentLike,
  namespaceLabels?: NamespaceLabels
): AttachmentVerdict {
  const routeKind = route.kind || '';
  const routeGroup = (route.apiVersion || '').split('/')[0] || GATEWAY_GROUP;
  const routeNamespace = route.metadata?.namespace;
  const routeHostnames = HOSTNAME_ROUTE_KINDS.has(routeKind)
    ? asArray<string>(asRecord(route.spec).hostnames)
    : undefined;

  const selected = listenersOf(parent).filter(
    listener =>
      (!parentRef.sectionName || listener.name === parentRef.sectionName) &&
      (parentRef.port === undefined || listener.port === parentRef.port)
  );

  if (selected.length === 0) {
    const target = [
      parentRef.sectionName ? `named "${parentRef.sectionName}"` : '',
      parentRef.port !== undefined ? `on port ${parentRef.port}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      listeners: [],
      attaches: 'no',
      summary: target ? `The parent has no listener ${target}.` : 'The parent has no listeners.',
    };
  }

  const listeners: ListenerVerdict[] = selected.map(listener => {
    const reasons: string[] = [];
    let attaches: Tristate = 'yes';

    if (
      !kindAllowed(
        listener,
        routeKind,
        routeGroup,
        listenerStatus(parent, listener.name)?.supportedKinds
      )
    ) {
      reasons.push(`${routeKind} is not an allowed route kind for protocol ${listener.protocol}`);
      attaches = 'no';
    }

    const namespace = namespaceAllowed(
      listener.allowedRoutes,
      parent.metadata?.namespace,
      routeNamespace,
      namespaceLabels
    );
    if (namespace === 'no') {
      const from = listener.allowedRoutes?.namespaces?.from ?? 'Same';
      reasons.push(
        from === 'Same'
          ? `Only routes in namespace "${parent.metadata?.namespace}" are allowed`
          : from === 'None'
          ? 'No route namespaces are allowed'
          : `Namespace "${routeNamespace}" does not match the namespace selector`
      );
      attaches = 'no';
    } else if (namespace === 'unknown' && attaches === 'yes') {
      attaches = 'unknown';
    }

    const hostnames = routeHostnames ? effectiveHostnames(listener.hostname, routeHostnames) : null;
    if (hostnames !== null && hostnames.length === 0) {
      reasons.push(`No route hostname matches the listener hostname "${listener.hostname}"`);
      attaches = 'no';
    }

    return { listener, attaches, reasons, hostnames };
  });

  const attaches: Tristate = listeners.some(l => l.attaches === 'yes')
    ? 'yes'
    : listeners.some(l => l.attaches === 'unknown')
    ? 'unknown'
    : 'no';

  return {
    listeners,
    attaches,
    summary: attaches === 'no' ? 'No selected listener accepts this route.' : undefined,
  };
}

/** Routes whose parentRefs point at the given Gateway or ListenerSet. */
export function routesForParent<R extends RouteLike>(routes: R[], parent: RefObject): R[] {
  return routes.filter(route => routeTargetsParent(route, parent));
}

/** The parentRefs of a route that point at the given parent. */
export function parentRefsFor(route: RouteLike, parent: RefObject): ResolvedParentRef[] {
  return routeParentRefs(route).filter(
    ref =>
      ref.kind === (parent.kind || '') &&
      ref.name === (parent.metadata?.name || '') &&
      (ref.namespace || '') === (parent.metadata?.namespace || '')
  );
}

/** Whether a Gateway lets ListenerSets from `namespace` attach (`spec.allowedListeners`). */
export function listenerSetAllowed(
  gateway: ParentLike,
  namespace: string | undefined,
  namespaceLabels?: NamespaceLabels
): Tristate {
  const allowed = asRecord<{ namespaces?: { from?: string; selector?: LabelSelector } }>(
    asRecord(gateway.spec).allowedListeners
  );
  const from = allowed.namespaces?.from ?? 'None';
  switch (from) {
    case 'All':
      return 'yes';
    case 'Same':
      return gateway.metadata?.namespace === namespace ? 'yes' : 'no';
    case 'None':
      return 'no';
    case 'Selector':
      if (!namespaceLabels || !namespace || !namespaceLabels[namespace]) return 'unknown';
      return matchesSelector(allowed.namespaces?.selector, namespaceLabels[namespace])
        ? 'yes'
        : 'no';
    default:
      return 'unknown';
  }
}
