/**
 * Hostname rules of the Gateway API: RFC 1123 subdomains without IP addresses, optionally with a
 * single leading wildcard label (`*.example.com`).
 *
 * @see https://gateway-api.sigs.k8s.io/reference/api-spec/main/spec/#hostname
 */

const LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export const MAX_HOSTNAME_LENGTH = 253;

/** Returns why the hostname is invalid, or undefined when it is valid. */
export function hostnameError(
  hostname: string,
  options: { allowWildcard?: boolean } = {}
): string | undefined {
  const { allowWildcard = true } = options;
  if (hostname === '') return 'Hostname must not be empty';
  if (hostname.length > MAX_HOSTNAME_LENGTH) {
    return `Hostname must be at most ${MAX_HOSTNAME_LENGTH} characters`;
  }
  if (hostname !== hostname.toLowerCase()) return 'Hostname must be lowercase';
  if (IPV4.test(hostname) || hostname.includes(':')) return 'IP addresses are not allowed';

  let rest = hostname;
  if (rest.startsWith('*.')) {
    if (!allowWildcard) return 'Wildcards are not allowed here';
    rest = rest.slice(2);
  }
  if (rest.includes('*')) {
    return 'A wildcard is only allowed as the first label ("*.example.com")';
  }
  if (rest === '') return 'Hostname must have at least one label after the wildcard';

  for (const label of rest.split('.')) {
    if (label === '') return 'Hostname must not contain empty labels';
    if (label.length > 63) return 'Each label must be at most 63 characters';
    if (!LABEL.test(label)) {
      return 'Labels may only contain lowercase letters, digits and "-", and must start and end with a letter or digit';
    }
  }
  return undefined;
}

export function isValidHostname(hostname: string, options?: { allowWildcard?: boolean }): boolean {
  return hostnameError(hostname, options) === undefined;
}

function isWildcard(hostname: string): boolean {
  return hostname.startsWith('*.');
}

/** Whether `hostname` falls under the wildcard `*.suffix` (one or more extra labels). */
function underWildcard(hostname: string, wildcard: string): boolean {
  const suffix = wildcard.slice(1); // ".example.com"
  return hostname.endsWith(suffix) && hostname.length > suffix.length;
}

/**
 * Intersects two hostnames following the listener / route matching rules. Returns the more
 * specific hostname when they overlap, undefined when they do not.
 */
export function intersectHostnames(a: string, b: string): string | undefined {
  if (a === b) return a;
  const wildA = isWildcard(a);
  const wildB = isWildcard(b);
  if (wildA && wildB) {
    // "*.example.com" vs "*.foo.example.com": the longer suffix is the narrower one.
    if (underWildcard(b.slice(2), a) || b.slice(1) === a.slice(1)) return b;
    if (underWildcard(a.slice(2), b)) return a;
    return undefined;
  }
  if (wildA) return underWildcard(b, a) ? b : undefined;
  if (wildB) return underWildcard(a, b) ? a : undefined;
  return undefined;
}

/**
 * Hostnames a route would serve on a listener.
 *
 * - No listener hostname: the listener accepts every route hostname.
 * - No route hostnames: the route inherits the listener hostname.
 * - Otherwise the pairwise intersection; an empty result means the route cannot attach.
 *
 * Returns `null` when neither side restricts the hostname (matches everything).
 */
export function effectiveHostnames(
  listenerHostname: string | undefined,
  routeHostnames: string[] | undefined
): string[] | null {
  const routes = (routeHostnames || []).filter(h => typeof h === 'string' && h !== '');
  if (!listenerHostname) return routes.length > 0 ? routes : null;
  if (routes.length === 0) return [listenerHostname];
  const result: string[] = [];
  for (const hostname of routes) {
    const match = intersectHostnames(listenerHostname, hostname);
    if (match && !result.includes(match)) result.push(match);
  }
  return result;
}

/** Whether the route can serve at least one hostname on the listener. */
export function hostnamesOverlap(
  listenerHostname: string | undefined,
  routeHostnames: string[] | undefined
): boolean {
  const effective = effectiveHostnames(listenerHostname, routeHostnames);
  return effective === null || effective.length > 0;
}
