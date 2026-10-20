/**
 * Client-side validation for the forms and wizards.
 *
 * The API server stays the source of truth (CRD schema and CEL rules, checked by the dry-run
 * before every apply). These checks mirror the rules of Gateway API v1.6 that users trip over
 * most, so mistakes are explained next to the field that caused them instead of in a server
 * error.
 */
import { GATEWAY_GROUP } from '../resources/types';
import { hostnameError } from './hostnames';
import { asArray, asRecord, isPlainObject, joinPath } from './objects';

export interface ValidationIssue {
  /** Path of the offending field, e.g. `spec.listeners.0.port`. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

type Rec = Record<string, unknown>;

class Collector {
  issues: ValidationIssue[] = [];
  error(path: string, message: string) {
    this.issues.push({ path, message, severity: 'error' });
  }
  warn(path: string, message: string) {
    this.issues.push({ path, message, severity: 'warning' });
  }
}

const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const CONTROLLER_NAME =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/[A-Za-z0-9/\-._~%!$&'()*+,;=:]+$/;
const PROTOCOL =
  /^[a-zA-Z0-9]([-a-zA-Z0-9]*[a-zA-Z0-9])?$|[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/[A-Za-z0-9]+$/;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
const HEADER_VALUE = /^[!-~]+([\t ]?[!-~]+)*$/;
const PATH_CHARS = /^(?:[-A-Za-z0-9/._~!$&'()*+,;=:@]|[%][0-9a-fA-F]{2})+$/;
const DURATION = /^([0-9]{1,5}(h|m|s|ms)){1,4}$/;
const GRPC_SERVICE = /^\.?[a-z_][a-z_0-9]*(\.[a-z_][a-z_0-9]*)*$/i;
const GRPC_METHOD = /^[A-Za-z_][A-Za-z_0-9]*$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

export const HTTP_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
  'PATCH',
];
export const WELL_KNOWN_PROTOCOLS = ['HTTP', 'HTTPS', 'TLS', 'TCP', 'UDP'];
export const HTTP_FILTER_TYPES = [
  'RequestHeaderModifier',
  'ResponseHeaderModifier',
  'RequestRedirect',
  'URLRewrite',
  'RequestMirror',
  'CORS',
  'ExternalAuth',
  'ExtensionRef',
];
export const GRPC_FILTER_TYPES = [
  'RequestHeaderModifier',
  'ResponseHeaderModifier',
  'RequestMirror',
  'ExtensionRef',
];
export const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

/** Field of a filter that carries the configuration of each filter type. */
export const FILTER_CONFIG_FIELD: Record<string, string> = {
  RequestHeaderModifier: 'requestHeaderModifier',
  ResponseHeaderModifier: 'responseHeaderModifier',
  RequestRedirect: 'requestRedirect',
  URLRewrite: 'urlRewrite',
  RequestMirror: 'requestMirror',
  CORS: 'cors',
  ExternalAuth: 'externalAuth',
  ExtensionRef: 'extensionRef',
};

const NON_REPEATABLE_FILTERS = [
  'RequestHeaderModifier',
  'ResponseHeaderModifier',
  'RequestRedirect',
  'URLRewrite',
  'CORS',
];

// ---------------------------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------------------------

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function isValidPort(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Parses a Gateway API duration (`1h30m`, `500ms`) to milliseconds; undefined when invalid. */
export function parseDuration(value: unknown): number | undefined {
  if (typeof value !== 'string' || !DURATION.test(value)) return undefined;
  const units: Record<string, number> = { h: 3600000, m: 60000, s: 1000, ms: 1 };
  let total = 0;
  const pattern = /([0-9]{1,5})(ms|h|m|s)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    total += Number(match[1]) * units[match[2]];
  }
  return total;
}

function requireString(c: Collector, obj: Rec, key: string, path: string, label: string): boolean {
  if (isBlank(obj[key])) {
    c.error(joinPath(path, key), `${label} is required`);
    return false;
  }
  if (typeof obj[key] !== 'string') {
    c.error(joinPath(path, key), `${label} must be text`);
    return false;
  }
  return true;
}

function checkPort(c: Collector, value: unknown, path: string, required: boolean, label = 'Port') {
  if (isBlank(value)) {
    if (required) c.error(path, `${label} is required`);
    return;
  }
  if (!isValidPort(value)) c.error(path, `${label} must be a whole number between 1 and 65535`);
}

function checkDuration(c: Collector, value: unknown, path: string, label: string) {
  if (isBlank(value)) return;
  if (parseDuration(value) === undefined) {
    c.error(path, `${label} must be a duration such as "10s", "500ms" or "1h30m"`);
  }
}

function checkHostname(
  c: Collector,
  value: unknown,
  path: string,
  options: { allowWildcard: boolean; required?: boolean; label?: string }
) {
  const label = options.label || 'Hostname';
  if (isBlank(value)) {
    if (options.required) c.error(path, `${label} is required`);
    return;
  }
  if (typeof value !== 'string') {
    c.error(path, `${label} must be text`);
    return;
  }
  const error = hostnameError(value, { allowWildcard: options.allowWildcard });
  if (error) c.error(path, error);
}

function checkArray(c: Collector, value: unknown, path: string, label: string): unknown[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    c.error(path, `${label} must be a list`);
    return null;
  }
  return value;
}

function checkObject(c: Collector, value: unknown, path: string, label: string): Rec | null {
  if (!isPlainObject(value)) {
    c.error(path, `${label} must be an object`);
    return null;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------------------------

function validateMetadata(c: Collector, obj: Rec, namespaced: boolean) {
  const metadata = asRecord(obj.metadata);
  const name = metadata.name;
  if (isBlank(name)) {
    c.error('metadata.name', 'Name is required');
  } else if (typeof name !== 'string' || !DNS_SUBDOMAIN.test(name) || name.length > 253) {
    c.error(
      'metadata.name',
      'Name must consist of lowercase letters, digits, "-" or ".", and start and end with a letter or digit'
    );
  }
  if (namespaced) {
    const namespace = metadata.namespace;
    if (isBlank(namespace)) {
      c.error('metadata.namespace', 'Namespace is required');
    } else if (
      typeof namespace !== 'string' ||
      !DNS_LABEL.test(namespace) ||
      namespace.length > 63
    ) {
      c.error('metadata.namespace', 'Namespace must be a valid DNS label');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shared reference checks
// ---------------------------------------------------------------------------------------------

function validateParentRefs(c: Collector, spec: Rec, routeNamespace: unknown) {
  const refs = checkArray(c, spec.parentRefs, 'spec.parentRefs', 'Parent references');
  if (!refs) return;
  if (refs.length === 0) {
    c.warn('spec.parentRefs', 'Without a parent the route is not attached to any Gateway');
    return;
  }
  if (refs.length > 32) c.error('spec.parentRefs', 'At most 32 parent references are allowed');

  const byParent = new Map<string, Array<{ section: string; port: string; index: number }>>();
  refs.forEach((entry, index) => {
    const path = `spec.parentRefs.${index}`;
    const ref = checkObject(c, entry, path, 'Parent reference');
    if (!ref) return;
    requireString(c, ref, 'name', path, 'Parent name');
    checkPort(c, ref.port, `${path}.port`, false);
    if (!isBlank(ref.sectionName) && !DNS_SUBDOMAIN.test(String(ref.sectionName))) {
      c.error(`${path}.sectionName`, 'Section name must be a valid listener name');
    }
    if (!isBlank(ref.namespace) && !DNS_LABEL.test(String(ref.namespace))) {
      c.error(`${path}.namespace`, 'Namespace must be a valid DNS label');
    }
    const key = [
      ref.group ?? GATEWAY_GROUP,
      ref.kind ?? 'Gateway',
      ref.namespace || routeNamespace || '',
      ref.name || '',
    ].join('/');
    const list = byParent.get(key) || [];
    list.push({ section: String(ref.sectionName ?? ''), port: String(ref.port ?? ''), index });
    byParent.set(key, list);
  });

  for (const list of byParent.values()) {
    if (list.length < 2) continue;
    const seen = new Set<string>();
    for (const entry of list) {
      const path = `spec.parentRefs.${entry.index}`;
      if (entry.section === '' && entry.port === '') {
        c.error(
          `${path}.sectionName`,
          'Set a section name or port: the same parent is referenced more than once'
        );
        continue;
      }
      const key = `${entry.section}|${entry.port}`;
      if (seen.has(key)) {
        c.error(`${path}.sectionName`, 'This parent, section and port combination is duplicated');
      }
      seen.add(key);
    }
  }
}

function validateBackendRef(c: Collector, entry: unknown, path: string) {
  const ref = checkObject(c, entry, path, 'Backend reference');
  if (!ref) return;
  requireString(c, ref, 'name', path, 'Backend name');
  const isService = (ref.kind ?? 'Service') === 'Service' && (ref.group ?? '') === '';
  if (isService && isBlank(ref.port)) {
    c.error(`${path}.port`, 'Port is required for Service backends');
  } else {
    checkPort(c, ref.port, `${path}.port`, false);
  }
  if (!isBlank(ref.weight)) {
    const weight = ref.weight;
    if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 0 || weight > 1000000) {
      c.error(`${path}.weight`, 'Weight must be a whole number between 0 and 1000000');
    }
  }
  if (!isBlank(ref.namespace) && !DNS_LABEL.test(String(ref.namespace))) {
    c.error(`${path}.namespace`, 'Namespace must be a valid DNS label');
  }
}

function validateBackendRefs(
  c: Collector,
  value: unknown,
  path: string,
  options: { min?: number; warnWhenEmpty?: string }
) {
  const refs = checkArray(c, value, path, 'Backends');
  if (!refs) return;
  if (refs.length > 16) c.error(path, 'At most 16 backends are allowed per rule');
  if (refs.length < (options.min ?? 0)) {
    c.error(path, 'At least one backend is required');
  } else if (refs.length === 0 && options.warnWhenEmpty) {
    c.warn(path, options.warnWhenEmpty);
  }
  refs.forEach((entry, index) => validateBackendRef(c, entry, `${path}.${index}`));
  if (refs.length > 1 && refs.every(ref => isPlainObject(ref) && ref.weight === 0)) {
    c.warn(path, 'Every backend has weight 0, so no traffic is forwarded');
  }
}

function validateHostnames(
  c: Collector,
  value: unknown,
  path: string,
  options: { max: number; min?: number }
) {
  const hostnames = checkArray(c, value, path, 'Hostnames');
  if (!hostnames) return;
  if (hostnames.length < (options.min ?? 0)) c.error(path, 'At least one hostname is required');
  if (hostnames.length > options.max) c.error(path, `At most ${options.max} hostnames are allowed`);
  const seen = new Set<string>();
  hostnames.forEach((hostname, index) => {
    const itemPath = `${path}.${index}`;
    checkHostname(c, hostname, itemPath, { allowWildcard: true, required: true });
    if (typeof hostname === 'string' && hostname !== '') {
      if (seen.has(hostname)) c.error(itemPath, 'Duplicate hostname');
      seen.add(hostname);
    }
  });
}

function validateRuleNames(c: Collector, rules: unknown[]) {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const name = asRecord(rule).name;
    if (isBlank(name)) return;
    const path = `spec.rules.${index}.name`;
    if (typeof name !== 'string' || !DNS_SUBDOMAIN.test(name)) {
      c.error(path, 'Rule name must consist of lowercase letters, digits, "-" or "."');
    } else if (seen.has(name)) {
      c.error(path, 'Rule name must be unique within the route');
    }
    seen.add(String(name));
  });
}

// ---------------------------------------------------------------------------------------------
// Listeners (Gateway, ListenerSet)
// ---------------------------------------------------------------------------------------------

function validateCertificateRef(c: Collector, entry: unknown, path: string) {
  const ref = checkObject(c, entry, path, 'Certificate reference');
  if (!ref) return;
  requireString(c, ref, 'name', path, 'Secret name');
  if (!isBlank(ref.namespace) && !DNS_LABEL.test(String(ref.namespace))) {
    c.error(`${path}.namespace`, 'Namespace must be a valid DNS label');
  }
}

function validateListeners(c: Collector, value: unknown, path: string) {
  const listeners = checkArray(c, value, path, 'Listeners');
  if (!listeners) return;
  if (listeners.length === 0) c.error(path, 'At least one listener is required');
  if (listeners.length > 64) c.error(path, 'At most 64 listeners are allowed');

  const names = new Set<string>();
  const combinations = new Set<string>();

  listeners.forEach((entry, index) => {
    const lp = `${path}.${index}`;
    const listener = checkObject(c, entry, lp, 'Listener');
    if (!listener) return;

    if (requireString(c, listener, 'name', lp, 'Listener name')) {
      const name = listener.name as string;
      if (!DNS_SUBDOMAIN.test(name) || name.length > 253) {
        c.error(
          `${lp}.name`,
          'Listener name must consist of lowercase letters, digits, "-" or ".", and start and end with a letter or digit'
        );
      } else if (names.has(name)) {
        c.error(`${lp}.name`, 'Listener name must be unique');
      }
      names.add(name);
    }

    checkPort(c, listener.port, `${lp}.port`, true);

    const protocol = listener.protocol;
    if (requireString(c, listener, 'protocol', lp, 'Protocol')) {
      if (!PROTOCOL.test(protocol as string)) {
        c.error(
          `${lp}.protocol`,
          'Protocol must be HTTP, HTTPS, TLS, TCP, UDP or an implementation specific "domain/PROTOCOL"'
        );
      }
    }

    const hasHostname = !isBlank(listener.hostname);
    if (hasHostname && (protocol === 'TCP' || protocol === 'UDP')) {
      c.error(`${lp}.hostname`, `Hostname must not be set for ${protocol} listeners`);
    } else {
      checkHostname(c, listener.hostname, `${lp}.hostname`, { allowWildcard: true });
    }

    const combination = `${listener.port}|${protocol}|${listener.hostname ?? ''}`;
    if (combinations.has(combination)) {
      c.error(`${lp}.port`, 'The combination of port, protocol and hostname must be unique');
    }
    combinations.add(combination);

    const hasTls = listener.tls !== undefined && listener.tls !== null;
    if (hasTls && (protocol === 'HTTP' || protocol === 'TCP' || protocol === 'UDP')) {
      c.error(`${lp}.tls`, `TLS must not be configured for ${protocol} listeners`);
    } else if (hasTls) {
      const tls = checkObject(c, listener.tls, `${lp}.tls`, 'TLS');
      if (tls) {
        const mode = tls.mode;
        if (!isBlank(mode) && mode !== 'Terminate' && mode !== 'Passthrough') {
          c.error(`${lp}.tls.mode`, 'TLS mode must be Terminate or Passthrough');
        }
        if (protocol === 'HTTPS' && mode === 'Passthrough') {
          c.error(`${lp}.tls.mode`, 'HTTPS listeners must terminate TLS');
        }
        if (protocol === 'TLS' && isBlank(mode)) {
          c.error(`${lp}.tls.mode`, 'TLS mode must be set for TLS listeners');
        }
        const refs = checkArray(
          c,
          tls.certificateRefs,
          `${lp}.tls.certificateRefs`,
          'Certificate references'
        );
        if (refs) {
          if (refs.length > 64) {
            c.error(`${lp}.tls.certificateRefs`, 'At most 64 certificates are allowed');
          }
          refs.forEach((ref, refIndex) =>
            validateCertificateRef(c, ref, `${lp}.tls.certificateRefs.${refIndex}`)
          );
          const terminate = (mode ?? 'Terminate') === 'Terminate';
          const hasOptions = Object.keys(asRecord(tls.options)).length > 0;
          if (terminate && refs.length === 0 && !hasOptions) {
            c.error(
              `${lp}.tls.certificateRefs`,
              'A certificate is required when TLS is terminated at the Gateway'
            );
          }
          if (mode === 'Passthrough' && refs.length > 0) {
            c.warn(
              `${lp}.tls.certificateRefs`,
              'Certificates are ignored in Passthrough mode: the backend terminates TLS'
            );
          }
        }
      }
    } else if (protocol === 'HTTPS' || protocol === 'TLS') {
      c.error(`${lp}.tls`, `TLS configuration is required for ${protocol} listeners`);
    }

    if (listener.allowedRoutes !== undefined && listener.allowedRoutes !== null) {
      const allowed = checkObject(
        c,
        listener.allowedRoutes,
        `${lp}.allowedRoutes`,
        'Allowed routes'
      );
      if (allowed) {
        const namespaces = asRecord(allowed.namespaces);
        const from = namespaces.from;
        if (!isBlank(from) && !['All', 'Same', 'Selector', 'None'].includes(String(from))) {
          c.error(`${lp}.allowedRoutes.namespaces.from`, 'Must be Same, All or Selector');
        }
        if (from === 'Selector') {
          const selector = asRecord(namespaces.selector);
          const empty =
            Object.keys(asRecord(selector.matchLabels)).length === 0 &&
            asArray(selector.matchExpressions).length === 0;
          if (empty) {
            c.error(
              `${lp}.allowedRoutes.namespaces.selector`,
              'Add at least one label: an empty selector matches every namespace'
            );
          }
        }
        const kinds = checkArray(c, allowed.kinds, `${lp}.allowedRoutes.kinds`, 'Route kinds');
        if (kinds) {
          if (kinds.length > 8) {
            c.error(`${lp}.allowedRoutes.kinds`, 'At most 8 route kinds are allowed');
          }
          kinds.forEach((kind, kindIndex) => {
            const kp = `${lp}.allowedRoutes.kinds.${kindIndex}`;
            const entryKind = checkObject(c, kind, kp, 'Route kind');
            if (entryKind) requireString(c, entryKind, 'kind', kp, 'Kind');
          });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------------------------

function validateParametersRef(c: Collector, value: unknown, path: string) {
  if (value === undefined || value === null) return;
  const ref = checkObject(c, value, path, 'Parameters reference');
  if (!ref) return;
  if (ref.group === undefined || ref.group === null) c.error(`${path}.group`, 'Group is required');
  requireString(c, ref, 'kind', path, 'Kind');
  requireString(c, ref, 'name', path, 'Name');
}

function validateControllerSpec(c: Collector, spec: Rec) {
  if (requireString(c, spec, 'controllerName', 'spec', 'Controller name')) {
    const name = spec.controllerName as string;
    if (!CONTROLLER_NAME.test(name) || name.length > 253) {
      c.error(
        'spec.controllerName',
        'Controller name must be a domain-prefixed path such as "example.com/gateway-controller"'
      );
    }
  }
  if (typeof spec.description === 'string' && spec.description.length > 64) {
    c.error('spec.description', 'Description must be at most 64 characters');
  }
  validateParametersRef(c, spec.parametersRef, 'spec.parametersRef');
}

function validateGateway(c: Collector, spec: Rec) {
  requireString(c, spec, 'gatewayClassName', 'spec', 'Gateway class');
  validateListeners(c, spec.listeners, 'spec.listeners');

  const addresses = checkArray(c, spec.addresses, 'spec.addresses', 'Addresses');
  if (addresses) {
    if (addresses.length > 16) c.error('spec.addresses', 'At most 16 addresses are allowed');
    const seen = new Set<string>();
    addresses.forEach((entry, index) => {
      const path = `spec.addresses.${index}`;
      const address = checkObject(c, entry, path, 'Address');
      if (!address) return;
      const type = address.type ?? 'IPAddress';
      const value = address.value;
      if (isBlank(value)) return;
      if (type === 'IPAddress' && !IPV4.test(String(value)) && !IPV6.test(String(value))) {
        c.error(`${path}.value`, 'Value must be an IPv4 or IPv6 address');
      }
      if (type === 'Hostname') {
        checkHostname(c, value, `${path}.value`, { allowWildcard: true });
      }
      const key = `${type}|${value}`;
      if (seen.has(key)) c.error(`${path}.value`, 'Address values must be unique');
      seen.add(key);
    });
  }

  const allowedListeners = asRecord(asRecord(spec.allowedListeners).namespaces);
  if (
    !isBlank(allowedListeners.from) &&
    !['All', 'Same', 'Selector', 'None'].includes(String(allowedListeners.from))
  ) {
    c.error('spec.allowedListeners.namespaces.from', 'Must be None, Same, All or Selector');
  }
}

function validateListenerSet(c: Collector, spec: Rec) {
  const parentRef = checkObject(c, spec.parentRef, 'spec.parentRef', 'Parent Gateway');
  if (parentRef) {
    requireString(c, parentRef, 'name', 'spec.parentRef', 'Parent Gateway');
    if (!isBlank(parentRef.namespace) && !DNS_LABEL.test(String(parentRef.namespace))) {
      c.error('spec.parentRef.namespace', 'Namespace must be a valid DNS label');
    }
  }
  validateListeners(c, spec.listeners, 'spec.listeners');
}

function validateHeaderMatches(c: Collector, value: unknown, path: string, label: string) {
  const items = checkArray(c, value, path, label);
  if (!items) return;
  if (items.length > 16) c.error(path, `At most 16 ${label.toLowerCase()} are allowed`);
  const seen = new Set<string>();
  items.forEach((entry, index) => {
    const ip = `${path}.${index}`;
    const item = checkObject(c, entry, ip, label);
    if (!item) return;
    if (requireString(c, item, 'name', ip, 'Name')) {
      const name = item.name as string;
      if (!HEADER_NAME.test(name)) c.error(`${ip}.name`, 'Name contains invalid characters');
      const key = name.toLowerCase();
      if (seen.has(key)) c.error(`${ip}.name`, 'Each name can only be matched once');
      seen.add(key);
    }
    requireString(c, item, 'value', ip, 'Value');
    if (!isBlank(item.type) && item.type !== 'Exact' && item.type !== 'RegularExpression') {
      c.error(`${ip}.type`, 'Type must be Exact or RegularExpression');
    }
  });
}

function validateHeaderList(c: Collector, value: unknown, path: string) {
  const items = checkArray(c, value, path, 'Headers');
  if (!items) return;
  if (items.length > 16) c.error(path, 'At most 16 headers are allowed');
  items.forEach((entry, index) => {
    const ip = `${path}.${index}`;
    const item = checkObject(c, entry, ip, 'Header');
    if (!item) return;
    if (requireString(c, item, 'name', ip, 'Header name')) {
      if (!HEADER_NAME.test(item.name as string)) {
        c.error(`${ip}.name`, 'Header name contains invalid characters');
      }
    }
    if (requireString(c, item, 'value', ip, 'Header value')) {
      if (!HEADER_VALUE.test(item.value as string)) {
        c.error(`${ip}.value`, 'Header value contains invalid characters');
      }
    }
  });
}

function validateHeaderModifier(c: Collector, value: unknown, path: string) {
  const modifier = checkObject(c, value, path, 'Header modifier');
  if (!modifier) return;
  validateHeaderList(c, modifier.set, `${path}.set`);
  validateHeaderList(c, modifier.add, `${path}.add`);
  const remove = checkArray(c, modifier.remove, `${path}.remove`, 'Headers to remove');
  const empty =
    asArray(modifier.set).length === 0 &&
    asArray(modifier.add).length === 0 &&
    asArray(modifier.remove).length === 0;
  if (empty) c.error(path, 'Set, add or remove at least one header');
  remove?.forEach((name, index) => {
    if (typeof name !== 'string' || !HEADER_NAME.test(name)) {
      c.error(`${path}.remove.${index}`, 'Header name contains invalid characters');
    }
  });
}

function validatePathModifier(c: Collector, value: unknown, path: string) {
  if (value === undefined || value === null) return;
  const modifier = checkObject(c, value, path, 'Path modifier');
  if (!modifier) return;
  const type = modifier.type;
  if (type !== 'ReplaceFullPath' && type !== 'ReplacePrefixMatch') {
    c.error(`${path}.type`, 'Type must be ReplaceFullPath or ReplacePrefixMatch');
    return;
  }
  if (type === 'ReplaceFullPath') {
    if (isBlank(modifier.replaceFullPath)) {
      c.error(`${path}.replaceFullPath`, 'The replacement path is required');
    }
    if (!isBlank(modifier.replacePrefixMatch)) {
      c.error(`${path}.replacePrefixMatch`, 'Not allowed with type ReplaceFullPath');
    }
  } else {
    if (modifier.replacePrefixMatch === undefined || modifier.replacePrefixMatch === null) {
      c.error(`${path}.replacePrefixMatch`, 'The replacement prefix is required');
    }
    if (!isBlank(modifier.replaceFullPath)) {
      c.error(`${path}.replaceFullPath`, 'Not allowed with type ReplacePrefixMatch');
    }
  }
}

function usesPrefixReplacement(filter: Rec): boolean {
  return (
    asRecord(asRecord(filter.requestRedirect).path).type === 'ReplacePrefixMatch' ||
    asRecord(asRecord(filter.urlRewrite).path).type === 'ReplacePrefixMatch'
  );
}

function validateFilters(
  c: Collector,
  value: unknown,
  path: string,
  allowedTypes: string[]
): Rec[] {
  const filters = checkArray(c, value, path, 'Filters');
  if (!filters) return [];
  if (filters.length > 16) c.error(path, 'At most 16 filters are allowed');

  const typeCount = new Map<string, number>();
  const valid: Rec[] = [];

  filters.forEach((entry, index) => {
    const fp = `${path}.${index}`;
    const filter = checkObject(c, entry, fp, 'Filter');
    if (!filter) return;
    valid.push(filter);
    const type = filter.type;
    if (isBlank(type)) {
      c.error(`${fp}.type`, 'Filter type is required');
      return;
    }
    if (!allowedTypes.includes(String(type))) {
      c.error(`${fp}.type`, `Filter type must be one of: ${allowedTypes.join(', ')}`);
      return;
    }
    typeCount.set(String(type), (typeCount.get(String(type)) || 0) + 1);

    const field = FILTER_CONFIG_FIELD[String(type)];
    for (const [otherType, otherField] of Object.entries(FILTER_CONFIG_FIELD)) {
      if (otherType !== type && filter[otherField] !== undefined) {
        c.error(`${fp}.${otherField}`, `Must not be set when the filter type is ${type}`);
      }
    }
    const config = filter[field];
    if (config === undefined || config === null) {
      c.error(`${fp}.${field}`, `The ${type} configuration is required`);
      return;
    }
    const cp = `${fp}.${field}`;
    const configObject = checkObject(c, config, cp, `${type} configuration`);
    if (!configObject) return;

    switch (type) {
      case 'RequestHeaderModifier':
      case 'ResponseHeaderModifier':
        validateHeaderModifier(c, configObject, cp);
        break;
      case 'RequestRedirect': {
        if (
          !isBlank(configObject.scheme) &&
          configObject.scheme !== 'http' &&
          configObject.scheme !== 'https'
        ) {
          c.error(`${cp}.scheme`, 'Scheme must be http or https');
        }
        checkHostname(c, configObject.hostname, `${cp}.hostname`, { allowWildcard: false });
        checkPort(c, configObject.port, `${cp}.port`, false);
        if (
          !isBlank(configObject.statusCode) &&
          !REDIRECT_STATUS_CODES.includes(Number(configObject.statusCode))
        ) {
          c.error(`${cp}.statusCode`, 'Status code must be 301, 302, 303, 307 or 308');
        }
        validatePathModifier(c, configObject.path, `${cp}.path`);
        break;
      }
      case 'URLRewrite': {
        checkHostname(c, configObject.hostname, `${cp}.hostname`, { allowWildcard: false });
        validatePathModifier(c, configObject.path, `${cp}.path`);
        if (isBlank(configObject.hostname) && configObject.path === undefined) {
          c.error(cp, 'Rewrite the hostname, the path or both');
        }
        break;
      }
      case 'RequestMirror': {
        validateBackendRef(c, configObject.backendRef, `${cp}.backendRef`);
        const hasPercent = !isBlank(configObject.percent);
        const hasFraction = configObject.fraction !== undefined && configObject.fraction !== null;
        if (hasPercent && hasFraction) {
          c.error(`${cp}.percent`, 'Only one of percent or fraction may be set');
        }
        if (hasPercent) {
          const percent = configObject.percent;
          if (typeof percent !== 'number' || percent < 0 || percent > 100) {
            c.error(`${cp}.percent`, 'Percent must be between 0 and 100');
          }
        }
        if (hasFraction) {
          const fraction = asRecord(configObject.fraction);
          const numerator = fraction.numerator;
          const denominator = fraction.denominator ?? 100;
          if (typeof numerator !== 'number' || numerator < 0) {
            c.error(`${cp}.fraction.numerator`, 'Numerator must be zero or greater');
          } else if (typeof denominator === 'number' && numerator > denominator) {
            c.error(`${cp}.fraction.numerator`, 'Numerator must not exceed the denominator');
          }
        }
        break;
      }
      case 'CORS': {
        for (const key of ['allowOrigins', 'allowMethods', 'allowHeaders', 'exposeHeaders']) {
          const list = checkArray(c, configObject[key], `${cp}.${key}`, key);
          if (list && list.length > 1 && list.includes('*') && key !== 'exposeHeaders') {
            c.error(`${cp}.${key}`, '"*" cannot be combined with other values');
          }
        }
        if (!isBlank(configObject.maxAge)) {
          const maxAge = configObject.maxAge;
          if (typeof maxAge !== 'number' || !Number.isInteger(maxAge) || maxAge < 1) {
            c.error(`${cp}.maxAge`, 'Max age must be a whole number of seconds, at least 1');
          }
        }
        break;
      }
      case 'ExternalAuth': {
        const protocol = configObject.protocol;
        if (protocol !== 'HTTP' && protocol !== 'GRPC') {
          c.error(`${cp}.protocol`, 'Protocol must be HTTP or GRPC');
        }
        validateBackendRef(c, configObject.backendRef, `${cp}.backendRef`);
        if (protocol === 'GRPC' && configObject.grpc === undefined) {
          c.error(`${cp}.grpc`, 'gRPC settings are required when the protocol is GRPC');
        }
        if (protocol === 'HTTP' && configObject.http === undefined) {
          c.error(`${cp}.http`, 'HTTP settings are required when the protocol is HTTP');
        }
        break;
      }
      case 'ExtensionRef': {
        if (configObject.group === undefined || configObject.group === null) {
          c.error(`${cp}.group`, 'Group is required');
        }
        requireString(c, configObject, 'kind', cp, 'Kind');
        requireString(c, configObject, 'name', cp, 'Name');
        break;
      }
    }
  });

  for (const type of NON_REPEATABLE_FILTERS) {
    if ((typeCount.get(type) || 0) > 1) c.error(path, `The ${type} filter cannot be repeated`);
  }
  if (typeCount.has('RequestRedirect') && typeCount.has('URLRewrite')) {
    c.error(path, 'RequestRedirect and URLRewrite cannot be combined in one rule');
  }
  return valid;
}

function validateSessionPersistence(c: Collector, value: unknown, path: string) {
  if (value === undefined || value === null) return;
  const session = checkObject(c, value, path, 'Session persistence');
  if (!session) return;
  if (!isBlank(session.type) && session.type !== 'Cookie' && session.type !== 'Header') {
    c.error(`${path}.type`, 'Type must be Cookie or Header');
  }
  if (typeof session.sessionName === 'string' && session.sessionName.length > 128) {
    c.error(`${path}.sessionName`, 'Session name must be at most 128 characters');
  }
  checkDuration(c, session.absoluteTimeout, `${path}.absoluteTimeout`, 'Absolute timeout');
  checkDuration(c, session.idleTimeout, `${path}.idleTimeout`, 'Idle timeout');
  const cookie = asRecord(session.cookieConfig);
  if (session.cookieConfig !== undefined && (session.type ?? 'Cookie') !== 'Cookie') {
    c.error(`${path}.cookieConfig`, 'Cookie settings can only be used with type Cookie');
  }
  if (cookie.lifetimeType === 'Permanent' && isBlank(session.absoluteTimeout)) {
    c.error(
      `${path}.absoluteTimeout`,
      'An absolute timeout is required when the cookie lifetime is Permanent'
    );
  }
}

function validateHTTPRoute(c: Collector, spec: Rec, namespace: unknown) {
  validateParentRefs(c, spec, namespace);
  validateHostnames(c, spec.hostnames, 'spec.hostnames', { max: 16 });

  const rules = checkArray(c, spec.rules, 'spec.rules', 'Rules');
  if (!rules) return;
  if (rules.length === 0) c.error('spec.rules', 'At least one rule is required');
  if (rules.length > 16) c.error('spec.rules', 'At most 16 rules are allowed');
  validateRuleNames(c, rules);

  let totalMatches = 0;
  rules.forEach((entry, ruleIndex) => {
    const rp = `spec.rules.${ruleIndex}`;
    const rule = checkObject(c, entry, rp, 'Rule');
    if (!rule) return;

    const matches = checkArray(c, rule.matches, `${rp}.matches`, 'Matches') || [];
    totalMatches += matches.length;
    if (matches.length > 64) c.error(`${rp}.matches`, 'At most 64 matches are allowed per rule');
    matches.forEach((matchEntry, matchIndex) => {
      const mp = `${rp}.matches.${matchIndex}`;
      const match = checkObject(c, matchEntry, mp, 'Match');
      if (!match) return;

      if (match.path !== undefined && match.path !== null) {
        const pathMatch = checkObject(c, match.path, `${mp}.path`, 'Path match');
        if (pathMatch) {
          const type = pathMatch.type ?? 'PathPrefix';
          const value = pathMatch.value ?? '/';
          if (!['Exact', 'PathPrefix', 'RegularExpression'].includes(String(type))) {
            c.error(`${mp}.path.type`, 'Type must be Exact, PathPrefix or RegularExpression');
          }
          if (typeof value !== 'string') {
            c.error(`${mp}.path.value`, 'Path must be text');
          } else if (value.length > 1024) {
            c.error(`${mp}.path.value`, 'Path must be at most 1024 characters');
          } else if (type === 'RegularExpression') {
            if (value === '') c.error(`${mp}.path.value`, 'A regular expression is required');
          } else if (type === 'Exact' || type === 'PathPrefix') {
            const vp = `${mp}.path.value`;
            if (!value.startsWith('/')) c.error(vp, 'Path must start with "/"');
            else if (value.includes('//')) c.error(vp, 'Path must not contain "//"');
            else if (value.includes('/./') || value.endsWith('/.')) {
              c.error(vp, 'Path must not contain "." segments');
            } else if (value.includes('/../') || value.endsWith('/..')) {
              c.error(vp, 'Path must not contain ".." segments');
            } else if (/%2f/i.test(value)) c.error(vp, 'Path must not contain an encoded "/"');
            else if (value.includes('#')) c.error(vp, 'Path must not contain "#"');
            else if (!PATH_CHARS.test(value)) c.error(vp, 'Path contains invalid characters');
          }
        }
      }
      validateHeaderMatches(c, match.headers, `${mp}.headers`, 'Header matches');
      validateHeaderMatches(c, match.queryParams, `${mp}.queryParams`, 'Query parameter matches');
      if (!isBlank(match.method) && !HTTP_METHODS.includes(String(match.method))) {
        c.error(`${mp}.method`, `Method must be one of: ${HTTP_METHODS.join(', ')}`);
      }
    });

    const filters = validateFilters(c, rule.filters, `${rp}.filters`, HTTP_FILTER_TYPES);
    const backendRefs = asArray(rule.backendRefs);
    const hasRedirect = filters.some(f => f.type === 'RequestRedirect');

    if (hasRedirect && backendRefs.length > 0) {
      c.error(`${rp}.backendRefs`, 'A rule that redirects must not have backends');
    }
    if (filters.some(usesPrefixReplacement)) {
      const singlePrefix =
        matches.length === 1 &&
        (asRecord(asRecord(matches[0]).path).type ?? 'PathPrefix') === 'PathPrefix';
      if (!(matches.length === 0 || singlePrefix)) {
        c.error(
          `${rp}.matches`,
          'ReplacePrefixMatch needs exactly one match of type PathPrefix in the rule'
        );
      }
    }

    validateBackendRefs(c, rule.backendRefs, `${rp}.backendRefs`, {
      warnWhenEmpty: hasRedirect
        ? undefined
        : 'A rule without backends answers every matching request with an error',
    });
    backendRefs.forEach((backendRef, backendIndex) => {
      if (isPlainObject(backendRef) && backendRef.filters !== undefined) {
        validateFilters(
          c,
          backendRef.filters,
          `${rp}.backendRefs.${backendIndex}.filters`,
          HTTP_FILTER_TYPES
        );
      }
    });

    if (rule.timeouts !== undefined && rule.timeouts !== null) {
      const timeouts = checkObject(c, rule.timeouts, `${rp}.timeouts`, 'Timeouts');
      if (timeouts) {
        checkDuration(c, timeouts.request, `${rp}.timeouts.request`, 'Request timeout');
        checkDuration(
          c,
          timeouts.backendRequest,
          `${rp}.timeouts.backendRequest`,
          'Backend request timeout'
        );
        const request = parseDuration(timeouts.request);
        const backend = parseDuration(timeouts.backendRequest);
        if (request !== undefined && backend !== undefined && request > 0 && backend > request) {
          c.error(
            `${rp}.timeouts.backendRequest`,
            'The backend request timeout cannot be longer than the request timeout'
          );
        }
      }
    }

    if (rule.retry !== undefined && rule.retry !== null) {
      const retry = checkObject(c, rule.retry, `${rp}.retry`, 'Retry');
      if (retry) {
        if (!isBlank(retry.attempts)) {
          const attempts = retry.attempts;
          if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 1) {
            c.error(`${rp}.retry.attempts`, 'Attempts must be a whole number, at least 1');
          }
        }
        checkDuration(c, retry.backoff, `${rp}.retry.backoff`, 'Backoff');
        asArray(retry.codes).forEach((code, codeIndex) => {
          if (typeof code !== 'number' || code < 400 || code > 599) {
            c.error(`${rp}.retry.codes.${codeIndex}`, 'Status codes must be between 400 and 599');
          }
        });
      }
    }

    validateSessionPersistence(c, rule.sessionPersistence, `${rp}.sessionPersistence`);
  });

  if (totalMatches >= 128) {
    c.error('spec.rules', 'The total number of matches across all rules must be less than 128');
  }
}

function validateGRPCRoute(c: Collector, spec: Rec, namespace: unknown) {
  validateParentRefs(c, spec, namespace);
  validateHostnames(c, spec.hostnames, 'spec.hostnames', { max: 16 });

  const rules = checkArray(c, spec.rules, 'spec.rules', 'Rules');
  if (!rules) return;
  if (rules.length === 0) c.error('spec.rules', 'At least one rule is required');
  if (rules.length > 16) c.error('spec.rules', 'At most 16 rules are allowed');
  validateRuleNames(c, rules);

  rules.forEach((entry, ruleIndex) => {
    const rp = `spec.rules.${ruleIndex}`;
    const rule = checkObject(c, entry, rp, 'Rule');
    if (!rule) return;

    const matches = checkArray(c, rule.matches, `${rp}.matches`, 'Matches') || [];
    if (matches.length > 64) c.error(`${rp}.matches`, 'At most 64 matches are allowed per rule');
    matches.forEach((matchEntry, matchIndex) => {
      const mp = `${rp}.matches.${matchIndex}`;
      const match = checkObject(c, matchEntry, mp, 'Match');
      if (!match) return;
      if (match.method !== undefined && match.method !== null) {
        const method = checkObject(c, match.method, `${mp}.method`, 'Method match');
        if (method) {
          const type = method.type ?? 'Exact';
          if (type !== 'Exact' && type !== 'RegularExpression') {
            c.error(`${mp}.method.type`, 'Type must be Exact or RegularExpression');
          }
          if (isBlank(method.service) && isBlank(method.method)) {
            c.error(`${mp}.method.service`, 'Set a service, a method or both');
          }
          if (type === 'Exact') {
            if (!isBlank(method.service) && !GRPC_SERVICE.test(String(method.service))) {
              c.error(
                `${mp}.method.service`,
                'Service must be a fully qualified gRPC service name such as "pkg.v1.Service"'
              );
            }
            if (!isBlank(method.method) && !GRPC_METHOD.test(String(method.method))) {
              c.error(`${mp}.method.method`, 'Method must be a valid gRPC method name');
            }
          }
        }
      }
      validateHeaderMatches(c, match.headers, `${mp}.headers`, 'Header matches');
    });

    validateFilters(c, rule.filters, `${rp}.filters`, GRPC_FILTER_TYPES);
    validateBackendRefs(c, rule.backendRefs, `${rp}.backendRefs`, {
      warnWhenEmpty: 'A rule without backends answers every matching call with UNAVAILABLE',
    });
    asArray(rule.backendRefs).forEach((backendRef, backendIndex) => {
      if (isPlainObject(backendRef) && backendRef.filters !== undefined) {
        validateFilters(
          c,
          backendRef.filters,
          `${rp}.backendRefs.${backendIndex}.filters`,
          GRPC_FILTER_TYPES
        );
      }
    });
    validateSessionPersistence(c, rule.sessionPersistence, `${rp}.sessionPersistence`);
  });
}

function validateL4Route(c: Collector, kind: string, spec: Rec, namespace: unknown) {
  validateParentRefs(c, spec, namespace);
  if (kind === 'TLSRoute') {
    validateHostnames(c, spec.hostnames, 'spec.hostnames', { max: 1024, min: 1 });
  }
  const rules = checkArray(c, spec.rules, 'spec.rules', 'Rules');
  if (!rules) return;
  if (rules.length === 0) c.error('spec.rules', 'A rule is required');
  if (rules.length > 1) c.error('spec.rules', `${kind} supports exactly one rule`);
  validateRuleNames(c, rules);
  rules.forEach((entry, ruleIndex) => {
    const rp = `spec.rules.${ruleIndex}`;
    const rule = checkObject(c, entry, rp, 'Rule');
    if (!rule) return;
    validateBackendRefs(c, rule.backendRefs, `${rp}.backendRefs`, { min: 1 });
  });
}

function validateReferenceGrant(c: Collector, spec: Rec) {
  const from = checkArray(c, spec.from, 'spec.from', 'From');
  if (from) {
    if (from.length === 0) c.error('spec.from', 'At least one source is required');
    if (from.length > 16) c.error('spec.from', 'At most 16 sources are allowed');
    from.forEach((entry, index) => {
      const path = `spec.from.${index}`;
      const item = checkObject(c, entry, path, 'Source');
      if (!item) return;
      if (item.group === undefined || item.group === null) {
        c.error(`${path}.group`, 'Group is required (use an empty value for the core group)');
      }
      requireString(c, item, 'kind', path, 'Kind');
      if (requireString(c, item, 'namespace', path, 'Namespace')) {
        if (!DNS_LABEL.test(item.namespace as string)) {
          c.error(`${path}.namespace`, 'Namespace must be a valid DNS label');
        }
      }
    });
  }
  const to = checkArray(c, spec.to, 'spec.to', 'To');
  if (to) {
    if (to.length === 0) c.error('spec.to', 'At least one target is required');
    if (to.length > 16) c.error('spec.to', 'At most 16 targets are allowed');
    to.forEach((entry, index) => {
      const path = `spec.to.${index}`;
      const item = checkObject(c, entry, path, 'Target');
      if (!item) return;
      if (item.group === undefined || item.group === null) {
        c.error(`${path}.group`, 'Group is required (use an empty value for the core group)');
      }
      requireString(c, item, 'kind', path, 'Kind');
    });
  }
}

function validateTargetRefs(c: Collector, value: unknown, withSections: boolean) {
  const refs = checkArray(c, value, 'spec.targetRefs', 'Targets');
  if (!refs) return;
  if (refs.length === 0) c.error('spec.targetRefs', 'At least one target is required');
  if (refs.length > 16) c.error('spec.targetRefs', 'At most 16 targets are allowed');

  const byTarget = new Map<string, Array<{ section: string; index: number }>>();
  refs.forEach((entry, index) => {
    const path = `spec.targetRefs.${index}`;
    const ref = checkObject(c, entry, path, 'Target');
    if (!ref) return;
    if (ref.group === undefined || ref.group === null) {
      c.error(`${path}.group`, 'Group is required (use an empty value for the core group)');
    }
    requireString(c, ref, 'kind', path, 'Kind');
    requireString(c, ref, 'name', path, 'Name');
    if (withSections && !isBlank(ref.sectionName) && !DNS_SUBDOMAIN.test(String(ref.sectionName))) {
      c.error(`${path}.sectionName`, 'Section name must be a valid port name');
    }
    const key = `${ref.group ?? ''}/${ref.kind ?? ''}/${ref.name ?? ''}`;
    const list = byTarget.get(key) || [];
    list.push({ section: String(ref.sectionName ?? ''), index });
    byTarget.set(key, list);
  });

  for (const list of byTarget.values()) {
    if (list.length < 2) continue;
    const seen = new Set<string>();
    for (const entry of list) {
      const path = `spec.targetRefs.${entry.index}`;
      if (!withSections || entry.section === '') {
        c.error(
          withSections ? `${path}.sectionName` : `${path}.name`,
          withSections
            ? 'Set a section name: the same target is referenced more than once'
            : 'The same target is referenced more than once'
        );
      } else if (seen.has(entry.section)) {
        c.error(`${path}.sectionName`, 'This target and section combination is duplicated');
      }
      seen.add(entry.section);
    }
  }
}

function validateBackendValidation(c: Collector, value: unknown, path: string) {
  const validation = checkObject(c, value, path, 'Validation');
  if (!validation) return;
  checkHostname(c, validation.hostname, `${path}.hostname`, {
    allowWildcard: false,
    required: true,
  });

  const caRefs = checkArray(
    c,
    validation.caCertificateRefs,
    `${path}.caCertificateRefs`,
    'CA refs'
  );
  const hasCaRefs = !!caRefs && caRefs.length > 0;
  const hasWellKnown = !isBlank(validation.wellKnownCACertificates);
  if (hasCaRefs && hasWellKnown) {
    c.error(
      `${path}.wellKnownCACertificates`,
      'Use either CA certificate references or well-known CA certificates, not both'
    );
  } else if (!hasCaRefs && !hasWellKnown) {
    c.error(
      `${path}.caCertificateRefs`,
      'Reference a CA certificate or use the well-known (system) CA certificates'
    );
  }
  if (caRefs) {
    if (caRefs.length > 8)
      c.error(`${path}.caCertificateRefs`, 'At most 8 CA references are allowed');
    caRefs.forEach((entry, index) => {
      const rp = `${path}.caCertificateRefs.${index}`;
      const ref = checkObject(c, entry, rp, 'CA reference');
      if (!ref) return;
      if (ref.group === undefined || ref.group === null)
        c.error(`${rp}.group`, 'Group is required');
      requireString(c, ref, 'kind', rp, 'Kind');
      requireString(c, ref, 'name', rp, 'Name');
    });
  }

  const sans = checkArray(c, validation.subjectAltNames, `${path}.subjectAltNames`, 'SANs');
  if (sans) {
    if (sans.length > 5)
      c.error(`${path}.subjectAltNames`, 'At most 5 subject alt names are allowed');
    sans.forEach((entry, index) => {
      const sp = `${path}.subjectAltNames.${index}`;
      const san = checkObject(c, entry, sp, 'Subject alt name');
      if (!san) return;
      if (san.type === 'Hostname') {
        checkHostname(c, san.hostname, `${sp}.hostname`, { allowWildcard: true, required: true });
        if (!isBlank(san.uri))
          c.error(`${sp}.uri`, 'URI must not be set when the type is Hostname');
      } else if (san.type === 'URI') {
        if (isBlank(san.uri)) c.error(`${sp}.uri`, 'URI is required');
        if (!isBlank(san.hostname)) {
          c.error(`${sp}.hostname`, 'Hostname must not be set when the type is URI');
        }
      } else {
        c.error(`${sp}.type`, 'Type must be Hostname or URI');
      }
    });
  }
}

function validateBackendTLSPolicy(c: Collector, spec: Rec) {
  validateTargetRefs(c, spec.targetRefs, true);
  validateBackendValidation(c, spec.validation, 'spec.validation');
}

const NAMESPACED: Record<string, boolean> = {
  GatewayClass: false,
};

/** Validates a resource of any supported kind. Unknown kinds only get their metadata checked. */
export function validateResource(obj: unknown): ValidationIssue[] {
  const c = new Collector();
  if (!isPlainObject(obj)) {
    c.error('', 'The resource must be an object');
    return c.issues;
  }
  const kind = typeof obj.kind === 'string' ? obj.kind : '';
  if (isBlank(obj.apiVersion)) c.error('apiVersion', 'apiVersion is required');
  if (kind === '') c.error('kind', 'kind is required');

  validateMetadata(c, obj, NAMESPACED[kind] ?? true);

  if (obj.spec !== undefined && !isPlainObject(obj.spec)) {
    c.error('spec', 'spec must be an object');
    return c.issues;
  }
  const spec = asRecord(obj.spec);
  const namespace = asRecord(obj.metadata).namespace;

  switch (kind) {
    case 'GatewayClass':
      validateControllerSpec(c, spec);
      break;
    case 'Gateway':
      validateGateway(c, spec);
      break;
    case 'ListenerSet':
      validateListenerSet(c, spec);
      break;
    case 'HTTPRoute':
      validateHTTPRoute(c, spec, namespace);
      break;
    case 'GRPCRoute':
      validateGRPCRoute(c, spec, namespace);
      break;
    case 'TLSRoute':
    case 'TCPRoute':
    case 'UDPRoute':
      validateL4Route(c, kind, spec, namespace);
      break;
    case 'ReferenceGrant':
      validateReferenceGrant(c, spec);
      break;
    case 'BackendTLSPolicy':
      validateBackendTLSPolicy(c, spec);
      break;
  }
  return c.issues;
}

export function errorsOnly(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter(issue => issue.severity === 'error');
}

/** Issues reported for exactly this path. */
export function issuesAt(issues: ValidationIssue[], path: string): ValidationIssue[] {
  return issues.filter(issue => issue.path === path);
}

/** Issues reported for this path or anything below it. */
export function issuesUnder(issues: ValidationIssue[], path: string): ValidationIssue[] {
  const prefix = `${path}.`;
  return issues.filter(issue => issue.path === path || issue.path.startsWith(prefix));
}
