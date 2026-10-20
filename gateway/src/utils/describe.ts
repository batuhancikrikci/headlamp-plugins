/**
 * Human readable one-line descriptions of the more intricate parts of the Gateway API (matches,
 * filters, allowed routes). Used by list columns, detail pages, wizard summaries and the topology.
 */
import {
  AllowedRoutes,
  BackendRef,
  GATEWAY_GROUP,
  GRPCRouteMatch,
  HTTPHeader,
  HTTPHeaderFilter,
  HTTPHeaderMatch,
  HTTPPathModifier,
  HTTPRouteFilter,
  HTTPRouteMatch,
  LabelSelector,
  Listener,
  RouteGroupKind,
} from '../resources/types';
import { defaultRouteKinds } from './attachment';
import { asArray, asRecord, isPlainObject } from './objects';

function stringMatch(match: HTTPHeaderMatch): string {
  const operator = match.type === 'RegularExpression' ? '~' : '=';
  return `${match.name}${operator}${match.value}`;
}

/** e.g. `GET PathPrefix /api, header x-env=prod, query v=2`. */
export function describeHTTPMatch(match: HTTPRouteMatch | undefined): string {
  const m = asRecord<HTTPRouteMatch>(match);
  const parts: string[] = [];
  const path = asRecord<NonNullable<HTTPRouteMatch['path']>>(m.path);
  const pathText = `${path.type ?? 'PathPrefix'} ${path.value ?? '/'}`;
  parts.push(m.method ? `${m.method} ${pathText}` : pathText);
  for (const header of asArray<HTTPHeaderMatch>(m.headers).filter(isPlainObject)) {
    parts.push(`header ${stringMatch(header as unknown as HTTPHeaderMatch)}`);
  }
  for (const param of asArray<HTTPHeaderMatch>(m.queryParams).filter(isPlainObject)) {
    parts.push(`query ${stringMatch(param as unknown as HTTPHeaderMatch)}`);
  }
  return parts.join(', ');
}

/** e.g. `pkg.v1.Greeter/SayHello, header x-env=prod`. */
export function describeGRPCMatch(match: GRPCRouteMatch | undefined): string {
  const m = asRecord<GRPCRouteMatch>(match);
  const parts: string[] = [];
  const method = asRecord<NonNullable<GRPCRouteMatch['method']>>(m.method);
  if (method.service || method.method) {
    const regex = method.type === 'RegularExpression' ? ' (regex)' : '';
    parts.push(`${method.service || '*'}/${method.method || '*'}${regex}`);
  } else {
    parts.push('Any method');
  }
  for (const header of asArray<HTTPHeaderMatch>(m.headers).filter(isPlainObject)) {
    parts.push(`header ${stringMatch(header as unknown as HTTPHeaderMatch)}`);
  }
  return parts.join(', ');
}

function describeHeaderModifier(modifier: HTTPHeaderFilter | undefined): string {
  const m = asRecord<HTTPHeaderFilter>(modifier);
  const parts: string[] = [];
  const names = (headers: unknown) =>
    asArray<HTTPHeader>(headers)
      .map(h => h?.name)
      .filter(Boolean)
      .join(', ');
  if (asArray(m.set).length) parts.push(`set ${names(m.set)}`);
  if (asArray(m.add).length) parts.push(`add ${names(m.add)}`);
  if (asArray(m.remove).length) parts.push(`remove ${asArray<string>(m.remove).join(', ')}`);
  return parts.join('; ') || 'no changes';
}

function describePathModifier(path: HTTPPathModifier | undefined): string | undefined {
  if (!isPlainObject(path)) return undefined;
  if (path.type === 'ReplaceFullPath') return `path → ${path.replaceFullPath ?? ''}`;
  if (path.type === 'ReplacePrefixMatch') return `prefix → ${path.replacePrefixMatch ?? ''}`;
  return undefined;
}

function describeBackendTarget(ref: unknown): string {
  const r = asRecord<BackendRef>(ref);
  const kind = r.kind && r.kind !== 'Service' ? `${r.kind} ` : '';
  return `${kind}${r.namespace ? `${r.namespace}/` : ''}${r.name || '?'}${
    r.port !== undefined ? `:${r.port}` : ''
  }`;
}

/** Short title of a filter type. */
export const FILTER_LABELS: Record<string, string> = {
  RequestHeaderModifier: 'Request headers',
  ResponseHeaderModifier: 'Response headers',
  RequestRedirect: 'Redirect',
  URLRewrite: 'URL rewrite',
  RequestMirror: 'Mirror',
  CORS: 'CORS',
  ExternalAuth: 'External auth',
  ExtensionRef: 'Extension',
};

/** e.g. `Redirect: https://example.com:443, path → /new (301)`. */
export function describeFilter(filter: HTTPRouteFilter | undefined): string {
  const f = asRecord<HTTPRouteFilter>(filter);
  const label = FILTER_LABELS[f.type] || f.type || 'Unknown filter';
  switch (f.type) {
    case 'RequestHeaderModifier':
      return `${label}: ${describeHeaderModifier(f.requestHeaderModifier)}`;
    case 'ResponseHeaderModifier':
      return `${label}: ${describeHeaderModifier(f.responseHeaderModifier)}`;
    case 'RequestRedirect': {
      const r = asRecord<NonNullable<HTTPRouteFilter['requestRedirect']>>(f.requestRedirect);
      const target = [
        r.scheme ? `${r.scheme}://` : '',
        r.hostname || (r.scheme ? '<same host>' : ''),
        r.port !== undefined ? `:${r.port}` : '',
      ].join('');
      const parts = [target, describePathModifier(r.path)].filter(Boolean);
      return `${label}: ${parts.join(', ') || 'same URL'} (${r.statusCode ?? 302})`;
    }
    case 'URLRewrite': {
      const r = asRecord<NonNullable<HTTPRouteFilter['urlRewrite']>>(f.urlRewrite);
      const parts = [
        r.hostname ? `host → ${r.hostname}` : undefined,
        describePathModifier(r.path),
      ].filter(Boolean);
      return `${label}: ${parts.join(', ') || 'no changes'}`;
    }
    case 'RequestMirror': {
      const r = asRecord<NonNullable<HTTPRouteFilter['requestMirror']>>(f.requestMirror);
      const fraction = asRecord<{ numerator?: number; denominator?: number }>(r.fraction);
      const share =
        r.percent !== undefined
          ? ` (${r.percent}%)`
          : fraction.numerator !== undefined
          ? ` (${fraction.numerator}/${fraction.denominator ?? 100})`
          : '';
      return `${label}: ${describeBackendTarget(r.backendRef)}${share}`;
    }
    case 'CORS': {
      const r = asRecord<NonNullable<HTTPRouteFilter['cors']>>(f.cors);
      const origins = asArray<string>(r.allowOrigins);
      const methods = asArray<string>(r.allowMethods);
      const parts = [
        `origins ${origins.length ? origins.join(', ') : 'none'}`,
        methods.length ? `methods ${methods.join(', ')}` : undefined,
        r.allowCredentials ? 'credentials' : undefined,
      ].filter(Boolean);
      return `${label}: ${parts.join('; ')}`;
    }
    case 'ExternalAuth': {
      const r = asRecord<NonNullable<HTTPRouteFilter['externalAuth']>>(f.externalAuth);
      return `${label}: ${describeBackendTarget(r.backendRef)} (${r.protocol || '?'})`;
    }
    case 'ExtensionRef': {
      const r = asRecord<NonNullable<HTTPRouteFilter['extensionRef']>>(f.extensionRef);
      return `${label}: ${r.kind || '?'}/${r.name || '?'}`;
    }
    default:
      return label;
  }
}

export function describeSelector(selector: LabelSelector | undefined): string {
  const s = asRecord<LabelSelector>(selector);
  const parts = Object.entries(asRecord<Record<string, string>>(s.matchLabels)).map(
    ([key, value]) => `${key}=${value}`
  );
  for (const requirement of asArray<NonNullable<LabelSelector['matchExpressions']>[number]>(
    s.matchExpressions
  )) {
    if (!isPlainObject(requirement)) continue;
    const values = asArray<string>(requirement.values).join(', ');
    switch (requirement.operator) {
      case 'In':
        parts.push(`${requirement.key} in (${values})`);
        break;
      case 'NotIn':
        parts.push(`${requirement.key} not in (${values})`);
        break;
      case 'Exists':
        parts.push(`${requirement.key}`);
        break;
      case 'DoesNotExist':
        parts.push(`!${requirement.key}`);
        break;
    }
  }
  return parts.join(', ') || 'all namespaces';
}

/** e.g. `Same namespace` or `Namespaces matching team=a`. */
export function describeAllowedNamespaces(allowedRoutes: AllowedRoutes | undefined): string {
  const namespaces = asRecord<NonNullable<AllowedRoutes['namespaces']>>(
    asRecord<AllowedRoutes>(allowedRoutes).namespaces
  );
  switch (namespaces.from ?? 'Same') {
    case 'All':
      return 'All namespaces';
    case 'Same':
      return 'Same namespace';
    case 'None':
      return 'No namespaces';
    case 'Selector':
      return `Namespaces matching ${describeSelector(namespaces.selector)}`;
    default:
      return String(namespaces.from);
  }
}

/** Route kinds a listener accepts: the explicit list, or the defaults of its protocol. */
export function allowedRouteKinds(listener: Listener): string[] {
  const explicit = asArray<RouteGroupKind>(asRecord<AllowedRoutes>(listener.allowedRoutes).kinds)
    .filter(isPlainObject)
    .map(kind =>
      (kind.group ?? GATEWAY_GROUP) === GATEWAY_GROUP ? kind.kind : `${kind.kind}.${kind.group}`
    );
  if (explicit.length > 0) return explicit;
  return defaultRouteKinds(listener.protocol, asRecord<{ mode?: string }>(listener.tls).mode);
}

/** e.g. `HTTPS:443 *.example.com`. */
export function describeListener(listener: Listener): string {
  const l = asRecord<Listener>(listener);
  return `${l.protocol ?? '?'}:${l.port ?? '?'}${l.hostname ? ` ${l.hostname}` : ''}`;
}

/** Share of traffic each backend of a rule receives, in percent (weights default to 1). */
export function backendShares(backendRefs: BackendRef[] | undefined): number[] {
  const refs = asArray<BackendRef>(backendRefs);
  const weights = refs.map(ref => {
    const weight = asRecord<BackendRef>(ref).weight;
    return typeof weight === 'number' && weight >= 0 ? weight : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return weights.map(() => 0);
  return weights.map(weight => Math.round((weight / total) * 1000) / 10);
}
