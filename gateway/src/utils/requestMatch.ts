/**
 * "Where does this request go?": which listener of a Gateway accepts an HTTP request, which
 * HTTPRoute rule matches it and which backends it reaches, following the matching and
 * precedence rules of the Gateway API specification.
 *
 * - Listeners: the protocol must be HTTP or HTTPS, the port must match when one is given, and
 *   among listeners on the same port the most specific hostname wins.
 * - Routes: HTTPRoutes attached to such a listener whose effective hostnames accept the host.
 * - Rules: every match of a rule is tried; a rule without matches matches every request.
 * - Precedence: the most specific hostname, then an Exact path, the longest PathPrefix, a method
 *   match, the most header matches, the most query parameter matches, then the oldest route,
 *   then "{namespace}/{name}", then rule and match order.
 *
 * @see https://gateway-api.sigs.k8s.io/reference/api-spec/main/spec/#httproutespec
 */
import { evaluateAttachment, NamespaceLabels, parentRefsFor } from './attachment';
import { asArray, asRecord, asString, isPlainObject } from './objects';
import { resolveBackendRef, ResolvedBackendRef } from './refs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface KeyValue {
  name: string;
  value: string;
}

export interface TestRequest {
  host: string;
  /** Listener port; any port when undefined. */
  port?: number;
  method: string;
  path: string;
  headers: KeyValue[];
  query: KeyValue[];
}

export interface ListenerTrace {
  name: string;
  port?: number;
  protocol?: string;
  hostname?: string;
  accepts: boolean;
  reason?: string;
}

export interface MatchCandidate {
  route: Json;
  ruleIndex: number;
  /** Index of the matching entry of `rule.matches`; null for a rule without matches. */
  matchIndex: number | null;
  listener: string;
  /** The hostname of the route (or listener) that accepted the host; null when any host is accepted. */
  hostname: string | null;
  /** How the path matched, e.g. "PathPrefix /api". */
  pathMatch: string;
  method?: string;
  headerMatches: number;
  queryMatches: number;
  backends: Array<ResolvedBackendRef & { share?: number }>;
  /** Filter types of the rule, e.g. "RequestRedirect". */
  filters: string[];
}

export interface RequestTrace {
  listeners: ListenerTrace[];
  /** Matching rules, the one that handles the request first. */
  candidates: MatchCandidate[];
  /** Why nothing matched, when that is the case. */
  reason?: string;
  /** A RegularExpression path took part: its precedence is implementation-specific. */
  regexUsed: boolean;
}

/** Whether `host` falls under `pattern` (exact, or a "*." wildcard covering one or more labels). */
export function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

/** Specificity of a matching hostname: non-wildcard characters, then characters. */
function hostRank(hostname: string | null | undefined): [number, number] {
  if (!hostname) return [0, 0];
  return [hostname.startsWith('*.') ? 0 : hostname.length, hostname.length];
}

function fullMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

interface PathResult {
  ok: boolean;
  /** 0 Exact, 1 PathPrefix, 2 RegularExpression. */
  type: number;
  length: number;
  text: string;
}

function matchPath(match: Json, path: string): PathResult {
  const type = asString(match.path?.type) || 'PathPrefix';
  const value = asString(match.path?.value) || '/';
  if (type === 'Exact') {
    return { ok: path === value, type: 0, length: value.length, text: `Exact ${value}` };
  }
  if (type === 'RegularExpression') {
    return {
      ok: fullMatch(value, path),
      type: 2,
      length: value.length,
      text: `RegularExpression ${value}`,
    };
  }
  // A prefix matches whole path elements: "/foo" matches /foo, /foo/ and /foo/bar, not /foobar.
  const prefix = value.length > 1 ? value.replace(/\/+$/, '') : value;
  const ok = prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
  return { ok, type: 1, length: prefix.length, text: `PathPrefix ${value}` };
}

function matchValues(rules: Json[], values: KeyValue[], caseInsensitiveNames: boolean): boolean {
  return rules.every(rule => {
    const name = asString(rule.name);
    const expected = asString(rule.value);
    const found = values.filter(v =>
      caseInsensitiveNames ? v.name.toLowerCase() === name.toLowerCase() : v.name === name
    );
    if (found.length === 0) return false;
    // With repeated headers or parameters, the first value is used, as most implementations do.
    const actual = found[0].value;
    return rule.type === 'RegularExpression' ? fullMatch(expected, actual) : actual === expected;
  });
}

function listenerTraces(gateway: Json, request: TestRequest, host: string): ListenerTrace[] {
  const listeners = asArray<Json>(asRecord(gateway.spec).listeners).filter(isPlainObject) as Json[];
  const traces: ListenerTrace[] = listeners.map(l => {
    const base = {
      name: asString(l.name),
      port: l.port,
      protocol: l.protocol,
      hostname: l.hostname,
    };
    if (l.protocol !== 'HTTP' && l.protocol !== 'HTTPS') {
      return { ...base, accepts: false, reason: `${l.protocol} listener` };
    }
    if (request.port !== undefined && l.port !== request.port) {
      return { ...base, accepts: false, reason: `port ${l.port}` };
    }
    if (l.hostname && !hostMatches(host, l.hostname)) {
      return { ...base, accepts: false, reason: `hostname ${l.hostname}` };
    }
    return { ...base, accepts: true };
  });
  // On one port, the listener with the most specific hostname takes the request.
  const best = new Map<number, ListenerTrace>();
  for (const trace of traces.filter(t => t.accepts)) {
    const current = best.get(trace.port ?? -1);
    const rank = hostRank(trace.hostname);
    const currentRank = hostRank(current?.hostname);
    if (
      !current ||
      rank[0] > currentRank[0] ||
      (rank[0] === currentRank[0] && rank[1] > currentRank[1])
    ) {
      best.set(trace.port ?? -1, trace);
    }
  }
  return traces.map(t =>
    t.accepts && best.get(t.port ?? -1) !== t
      ? {
          ...t,
          accepts: false,
          reason: `a more specific listener (${best.get(t.port ?? -1)?.name}) takes the host`,
        }
      : t
  );
}

function compareCandidates(a: Ranked, b: Ranked): number {
  const keys: Array<[number, number]> = [
    [b.host[0], a.host[0]],
    [b.host[1], a.host[1]],
    [a.path.type, b.path.type],
    [a.path.type === 1 ? b.path.length : 0, a.path.type === 1 ? a.path.length : 0],
    [b.method ? 1 : 0, a.method ? 1 : 0],
    [b.headerMatches, a.headerMatches],
    [b.queryMatches, a.queryMatches],
  ];
  for (const [x, y] of keys) if (x !== y) return x - y;
  const created = (c: Ranked) => asString(c.route.metadata?.creationTimestamp) || '9999';
  if (created(a) !== created(b)) return created(a) < created(b) ? -1 : 1;
  const id = (c: Ranked) => `${c.route.metadata?.namespace}/${c.route.metadata?.name}`;
  if (id(a) !== id(b)) return id(a) < id(b) ? -1 : 1;
  return a.ruleIndex - b.ruleIndex || (a.matchIndex ?? 0) - (b.matchIndex ?? 0);
}

interface Ranked extends MatchCandidate {
  host: [number, number];
  path: PathResult;
}

/** Traces an HTTP request through a Gateway and its HTTPRoutes. */
export function traceRequest(
  gateway: Json,
  routes: Json[],
  request: TestRequest,
  namespaceLabels?: NamespaceLabels
): RequestTrace {
  const host = normalizeHost(request.host);
  const path = request.path.split('?')[0] || '/';
  const method = request.method.toUpperCase();
  const listeners = listenerTraces(gateway, request, host);
  const open = new Set(listeners.filter(l => l.accepts).map(l => l.name));
  if (open.size === 0) {
    return {
      listeners,
      candidates: [],
      regexUsed: false,
      reason: 'No HTTP or HTTPS listener of the Gateway accepts this host and port.',
    };
  }

  const ranked: Ranked[] = [];
  let attached = 0;
  for (const route of routes.filter(r => r.kind === 'HTTPRoute')) {
    for (const ref of parentRefsFor(route, gateway)) {
      const verdict = evaluateAttachment(route, ref, gateway, namespaceLabels);
      for (const lv of verdict.listeners) {
        const listener = asString(lv.listener.name);
        if (!open.has(listener) || lv.attaches === 'no') continue;
        attached++;
        // null: neither the listener nor the route limits the hostname.
        const hostname =
          lv.hostnames === null
            ? null
            : lv.hostnames
                .filter(h => hostMatches(host, h))
                .sort(
                  (x, y) => hostRank(y)[0] - hostRank(x)[0] || hostRank(y)[1] - hostRank(x)[1]
                )[0];
        if (hostname === undefined) continue;

        asArray<Json>(asRecord(route.spec).rules).forEach((rule, ruleIndex) => {
          const matches = asArray<Json>(rule.matches).filter(isPlainObject);
          const tries: Array<[Json, number | null]> = matches.length
            ? matches.map((m, i) => [m, i])
            : [[{}, null]];
          for (const [match, matchIndex] of tries) {
            const p = matchPath(match, path);
            if (!p.ok) continue;
            if (match.method && asString(match.method).toUpperCase() !== method) continue;
            const headers = asArray<Json>(match.headers).filter(isPlainObject);
            const query = asArray<Json>(match.queryParams).filter(isPlainObject);
            if (!matchValues(headers, request.headers, true)) continue;
            if (!matchValues(query, request.query, false)) continue;
            const refs = asArray<Json>(rule.backendRefs).filter(isPlainObject);
            const weights = refs.map(r => (typeof r.weight === 'number' ? r.weight : 1));
            const total = weights.reduce((sum, w) => sum + w, 0);
            ranked.push({
              route,
              ruleIndex,
              matchIndex,
              listener,
              hostname,
              pathMatch: p.text,
              method: match.method,
              headerMatches: headers.length,
              queryMatches: query.length,
              backends: refs.map((r, i) => ({
                ...resolveBackendRef(r as never, route.metadata?.namespace),
                share: total > 0 ? weights[i] / total : undefined,
              })),
              filters: asArray<Json>(rule.filters)
                .filter(isPlainObject)
                .map(f => asString(f.type)),
              host: hostRank(hostname),
              path: p,
            });
          }
        });
      }
    }
  }

  ranked.sort(compareCandidates);
  // The same rule can be reached through several listeners or parentRefs: keep its best entry.
  const seen = new Set<string>();
  const candidates = ranked
    .filter(c => {
      const key = `${c.route.metadata?.namespace}/${c.route.metadata?.name}#${c.ruleIndex}#${c.matchIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(c => {
      const candidate: Partial<Ranked> = { ...c };
      delete candidate.host;
      delete candidate.path;
      return candidate as MatchCandidate;
    });

  return {
    listeners,
    candidates,
    regexUsed: ranked.some(c => c.path.type === 2),
    reason:
      candidates.length > 0
        ? undefined
        : attached === 0
        ? 'No HTTPRoute is attached to the listeners that accept the request.'
        : 'No HTTPRoute accepts this host, or no rule matches the path, method, headers and query.',
  };
}
