/**
 * Pure helpers the forms use to create and reshape parts of a resource draft: new list items with
 * sensible defaults, and the adjustments that keep a draft consistent when one field changes
 * (for example, a listener switching from HTTP to HTTPS needs TLS settings).
 */
import { GATEWAY_GROUP } from '../resources/types';
import { asArray, asRecord, asString } from './objects';
import { FILTER_CONFIG_FIELD } from './validation';

type Rec = Record<string, unknown>;

const DEFAULT_PORTS: Record<string, number> = {
  HTTP: 80,
  HTTPS: 443,
  TLS: 443,
  TCP: 9000,
  UDP: 53,
};

const PROTOCOL_NAMES = new Set(['http', 'https', 'tls', 'tcp', 'udp', '']);

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Returns the listener adjusted to a new protocol: TLS settings are added or removed, fields the
 * protocol does not allow are dropped, and the port and name follow when they were still the
 * defaults of the previous protocol.
 */
export function withProtocol(
  listener: unknown,
  protocol: string,
  options: { siblingNames?: string[]; previousProtocol?: string } = {}
): Rec {
  const current = asRecord(listener);
  const next: Rec = { ...current, protocol };
  const siblingNames = options.siblingNames || [];
  const previousProtocol = options.previousProtocol ?? asString(current.protocol);

  // Follow the default port only when the user has not picked a custom one.
  const port = current.port;
  if (
    DEFAULT_PORTS[protocol] !== undefined &&
    (port === undefined || port === null || port === DEFAULT_PORTS[previousProtocol])
  ) {
    next.port = DEFAULT_PORTS[protocol];
  }

  // Same for the name: `http` becomes `https`, a custom name stays.
  const name = asString(current.name);
  if (PROTOCOL_NAMES.has(name) && PROTOCOL_NAMES.has(protocol.toLowerCase())) {
    next.name = uniqueName(
      protocol.toLowerCase(),
      siblingNames.filter(n => n !== name)
    );
  }

  const tls = asRecord(current.tls);
  switch (protocol) {
    case 'HTTPS': {
      const refs = asArray(tls.certificateRefs);
      next.tls = {
        ...tls,
        mode: 'Terminate',
        certificateRefs: refs.length > 0 ? refs : [{ name: '' }],
      };
      break;
    }
    case 'TLS':
      next.tls = { ...tls, mode: tls.mode ?? 'Passthrough' };
      if (asRecord(next.tls).mode === 'Passthrough') delete asRecord(next.tls).certificateRefs;
      break;
    case 'HTTP':
      delete next.tls;
      break;
    case 'TCP':
    case 'UDP':
      delete next.tls;
      delete next.hostname;
      break;
    default:
      // Implementation specific protocol: leave everything as it is.
      break;
  }
  return next;
}

/** Returns the listener TLS settings adjusted to a new TLS mode. */
export function withTLSMode(tls: unknown, mode: string): Rec {
  const current = asRecord(tls);
  if (mode === 'Passthrough') {
    // The backend terminates TLS, so the Gateway needs no certificate.
    const rest: Rec = { ...current, mode };
    delete rest.certificateRefs;
    return rest;
  }
  const refs = asArray(current.certificateRefs);
  return { ...current, mode, certificateRefs: refs.length > 0 ? refs : [{ name: '' }] };
}

/** A new listener that does not clash with the existing ones. */
export function newListener(existing: unknown): Rec {
  const listeners = asArray<Rec>(existing).map(asRecord);
  const names = listeners.map(l => asString(l.name));
  const ports = listeners.map(l => l.port);
  const hasHttp = listeners.some(l => l.protocol === 'HTTP');
  const hasHttps = listeners.some(l => l.protocol === 'HTTPS');

  if (hasHttp && !hasHttps && !ports.includes(443)) {
    return {
      name: uniqueName('https', names),
      protocol: 'HTTPS',
      port: 443,
      tls: { mode: 'Terminate', certificateRefs: [{ name: '' }] },
    };
  }
  let port = 80;
  if (ports.includes(port)) port = 8080;
  while (ports.includes(port)) port++;
  return { name: uniqueName('http', names), protocol: 'HTTP', port };
}

export function newParentRef(): Rec {
  return { name: '' };
}

export function newBackendRef(port = 80): Rec {
  return { name: '', port };
}

export function newHTTPMatch(): Rec {
  return { path: { type: 'PathPrefix', value: '/' } };
}

export function newHTTPRule(): Rec {
  return { matches: [newHTTPMatch()], backendRefs: [newBackendRef()] };
}

export function newGRPCRule(): Rec {
  return { backendRefs: [newBackendRef(50051)] };
}

/** Default configuration of each filter type: the smallest object the user can complete. */
function filterConfig(type: string): unknown {
  switch (type) {
    case 'RequestHeaderModifier':
    case 'ResponseHeaderModifier':
      return { set: [{ name: '', value: '' }] };
    case 'RequestRedirect':
      return { scheme: 'https', statusCode: 301 };
    case 'URLRewrite':
      return { path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/' } };
    case 'RequestMirror':
      return { backendRef: { name: '', port: 80 } };
    case 'CORS':
      return { allowOrigins: ['*'], allowMethods: ['GET', 'POST', 'OPTIONS'] };
    case 'ExternalAuth':
      return { protocol: 'HTTP', backendRef: { name: '', port: 80 }, http: {} };
    case 'ExtensionRef':
      return { group: '', kind: '', name: '' };
    default:
      return {};
  }
}

export function newFilter(type: string): Rec {
  const field = FILTER_CONFIG_FIELD[type];
  return field ? { type, [field]: filterConfig(type) } : { type };
}

/**
 * Changes the type of a filter. The configuration of the previous type is dropped, since a filter
 * may only carry the configuration that matches its type.
 */
export function withFilterType(filter: unknown, type: string): Rec {
  const current = asRecord(filter);
  const field = FILTER_CONFIG_FIELD[type];
  // Already of this type and carrying its configuration: nothing to do.
  if (current.type === type && field && current[field] !== undefined) return current;
  return newFilter(type);
}

/** Changes a path modifier's type, keeping the replacement text. */
export function withPathModifierType(modifier: unknown, type: string): Rec | undefined {
  if (type === '') return undefined;
  const current = asRecord(modifier);
  const text = asString(current.replaceFullPath ?? current.replacePrefixMatch) || '/';
  return type === 'ReplaceFullPath'
    ? { type, replaceFullPath: text }
    : { type, replacePrefixMatch: text };
}

/** Well-known kinds for the `from` side of a ReferenceGrant, with their API group. */
export const GRANT_FROM_KINDS: Array<{ kind: string; group: string }> = [
  { kind: 'HTTPRoute', group: GATEWAY_GROUP },
  { kind: 'GRPCRoute', group: GATEWAY_GROUP },
  { kind: 'TLSRoute', group: GATEWAY_GROUP },
  { kind: 'TCPRoute', group: GATEWAY_GROUP },
  { kind: 'UDPRoute', group: GATEWAY_GROUP },
  { kind: 'Gateway', group: GATEWAY_GROUP },
  { kind: 'ListenerSet', group: GATEWAY_GROUP },
];

/** Well-known kinds for the `to` side of a ReferenceGrant, with their API group. */
export const GRANT_TO_KINDS: Array<{ kind: string; group: string }> = [
  { kind: 'Service', group: '' },
  { kind: 'Secret', group: '' },
  { kind: 'ConfigMap', group: '' },
];

/** API group of a well-known kind in a ReferenceGrant; undefined for unknown kinds. */
export function grantGroupFor(kind: string, side: 'from' | 'to'): string | undefined {
  const list = side === 'from' ? GRANT_FROM_KINDS : GRANT_TO_KINDS;
  return list.find(entry => entry.kind === kind)?.group;
}
