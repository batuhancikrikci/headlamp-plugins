/**
 * Form model, validation, spec generation and edit mapping for MCPRoute. Pure, unit tested.
 *
 * On edit the form only rewrites the fields it manages; everything else is kept:
 * route-level header matches, backendSelector, authorization, apiKeyAuth, extAuth, OAuth
 * extras (claimToHeaders, local JWKS, resource metadata extras), per-server extras
 * (excludeRegex, backendHeader mappings, unknown fields) and API keys configured inline or
 * as a query parameter (shown as "kept").
 */
import { splitList, validateName } from '../../utils/forms';
import {
  gatewayRefErrors,
  GatewayRefForm,
  gatewayRefsFromSpec,
  newGatewayRef,
  toParentRefs,
} from '../../utils/gatewayRefs';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const MCP_API_KEY_SECRET_KEY = 'apiKey';

/** 'kept': an existing inline / query-param key the form does not edit. */
export type AuthMode = 'none' | 'existing' | 'new' | 'kept';

export interface ServerForm {
  name: string;
  kind: 'Backend' | 'Service';
  port: string;
  path: string;
  includeTools: string;
  includeRegex: string;
  excludeTools: string;
  authMode: AuthMode;
  secretName: string;
  apiKey: string;
  header: string;
  forwardHeaders: string;
  /** The backendRef this server was loaded from (edit). */
  original?: Json;
}

export interface OAuthForm {
  enabled: boolean;
  issuer: string;
  audiences: string;
  jwksUri: string;
  resource: string;
  scopes: string;
}

export interface MCPForm {
  name: string;
  namespace: string;
  gateways: GatewayRefForm[];
  path: string;
  hostnames: string;
  servers: ServerForm[];
  oauth: OAuthForm;
}

export const newServer = (): ServerForm => ({
  name: '',
  kind: 'Backend',
  port: '',
  path: '',
  includeTools: '',
  includeRegex: '',
  excludeTools: '',
  authMode: 'none',
  secretName: '',
  apiKey: '',
  header: '',
  forwardHeaders: '',
});

export const newMCPForm = (): MCPForm => ({
  name: '',
  namespace: 'default',
  gateways: [newGatewayRef()],
  path: '/mcp',
  hostnames: '',
  servers: [newServer()],
  oauth: { enabled: false, issuer: '', audiences: '', jwksUri: '', resource: '', scopes: '' },
});

const PATH = /^\/[^\s]*$/;
const URL = /^https?:\/\//;

/** Existing mode requires an explicit Secret; new mode derives a default name. */
export function secretNameFor(form: MCPForm, s: ServerForm): string {
  if (s.authMode === 'existing') return s.secretName;
  return s.secretName || (form.name && s.name ? `${form.name}-${s.name}-apikey` : '');
}

export function basicsErrors(form: MCPForm): string[] {
  return [
    validateName(form.name),
    validateName(form.namespace, 'Namespace'),
    ...gatewayRefErrors(form.gateways),
    form.path && !PATH.test(form.path) ? 'Path must start with "/".' : null,
  ].filter((e): e is string => !!e);
}

export function serverErrors(form: MCPForm): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  form.servers.forEach((s, i) => {
    const label = `MCP server ${i + 1}`;
    const e = validateName(s.name, `${label} name`);
    if (e) errors.push(e);
    if (seen.has(s.name)) errors.push(`${label}: backend names must be unique.`);
    seen.add(s.name);
    if (s.kind === 'Service') {
      const port = Number(s.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`${label}: a port is required for Service backends.`);
      }
    }
    if (s.path && !PATH.test(s.path)) errors.push(`${label}: path must start with "/".`);
    if (s.authMode === 'existing' || s.authMode === 'new') {
      const se = validateName(secretNameFor(form, s), `${label} secret name`);
      if (se) errors.push(se);
    }
    if (s.authMode === 'new' && !s.apiKey) errors.push(`${label}: API key is required.`);
  });
  if (form.servers.length === 0) errors.push('Add at least one MCP server.');
  return errors;
}

export function securityErrors(form: MCPForm): string[] {
  const o = form.oauth;
  if (!o.enabled) return [];
  const errors: string[] = [];
  if (!URL.test(o.issuer)) errors.push('Issuer must be an http(s) URL.');
  if (!URL.test(o.resource)) {
    errors.push('Protected resource must be the public http(s) URL of this MCP endpoint.');
  }
  if (o.jwksUri && !URL.test(o.jwksUri)) errors.push('JWKS URI must be an http(s) URL.');
  return errors;
}

function setOrDelete(obj: Json, key: string, value: unknown) {
  const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty) delete obj[key];
  else obj[key] = value;
}

function dropIfEmpty(obj: Json, key: string) {
  const v = obj[key];
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
    delete obj[key];
}

/** backendRef for one server, layered over the ref it was loaded from. */
function serverRef(form: MCPForm, s: ServerForm): Json {
  const ref: Json = JSON.parse(JSON.stringify(s.original || {}));
  ref.name = s.name;
  if (s.kind === 'Backend') {
    ref.group = 'gateway.envoyproxy.io';
    ref.kind = 'Backend';
    if (!s.original) delete ref.port;
  } else {
    delete ref.group;
    delete ref.kind;
    ref.port = Number(s.port);
  }
  setOrDelete(ref, 'path', s.path);

  const tools: Json = { ...(ref.toolSelector || {}) };
  setOrDelete(tools, 'include', splitList(s.includeTools));
  setOrDelete(tools, 'includeRegex', splitList(s.includeRegex));
  setOrDelete(tools, 'exclude', splitList(s.excludeTools));
  ref.toolSelector = tools;
  dropIfEmpty(ref, 'toolSelector');

  if (s.authMode !== 'kept') {
    const policy: Json = { ...(ref.securityPolicy || {}) };
    if (s.authMode === 'none') {
      delete policy.apiKey;
    } else {
      const key: Json = { ...(policy.apiKey || {}) };
      delete key.inline;
      delete key.queryParam;
      key.secretRef = { ...(key.secretRef || {}), name: secretNameFor(form, s) };
      setOrDelete(key, 'header', s.header);
      policy.apiKey = key;
    }
    ref.securityPolicy = policy;
    dropIfEmpty(ref, 'securityPolicy');
  }

  // Keep backendHeader mappings of headers that are still forwarded.
  const previous: Json[] = ref.forwardHeaders || [];
  setOrDelete(
    ref,
    'forwardHeaders',
    splitList(s.forwardHeaders).map(name => previous.find(h => h.name === name) || { name })
  );
  return ref;
}

/** Spec for the form, layered over `original` (empty when creating). */
export function toMCPSpec(form: MCPForm, original?: Json): Json {
  const spec: Json = JSON.parse(JSON.stringify(original || {}));
  spec.parentRefs = toParentRefs(form.gateways, form.namespace);
  setOrDelete(spec, 'path', form.path && (form.path !== '/mcp' || original?.path) ? form.path : '');
  setOrDelete(spec, 'hostnames', splitList(form.hostnames));
  spec.backendRefs = form.servers.map(s => serverRef(form, s));

  const policy: Json = { ...(spec.securityPolicy || {}) };
  if (form.oauth.enabled) {
    const o = form.oauth;
    const oauth: Json = { ...(policy.oauth || {}), issuer: o.issuer };
    setOrDelete(oauth, 'audiences', splitList(o.audiences));
    const jwks: Json = { ...(oauth.jwks || {}) };
    if (o.jwksUri) jwks.remoteJWKS = { ...(jwks.remoteJWKS || {}), uri: o.jwksUri };
    else delete jwks.remoteJWKS;
    oauth.jwks = jwks;
    dropIfEmpty(oauth, 'jwks');
    const prm: Json = { ...(oauth.protectedResourceMetadata || {}), resource: o.resource };
    setOrDelete(prm, 'scopesSupported', splitList(o.scopes));
    oauth.protectedResourceMetadata = prm;
    policy.oauth = oauth;
  } else {
    delete policy.oauth;
  }
  spec.securityPolicy = policy;
  dropIfEmpty(spec, 'securityPolicy');
  return spec;
}

/** Secrets to create for servers using a new API key. */
export function newSecrets(form: MCPForm): Json[] {
  return form.servers
    .filter(s => s.authMode === 'new')
    .map(s => ({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: secretNameFor(form, s), namespace: form.namespace },
      type: 'Opaque',
      stringData: { [MCP_API_KEY_SECRET_KEY]: s.apiKey },
    }));
}

function serverFromRef(ref: Json): ServerForm {
  const key: Json | undefined = ref.securityPolicy?.apiKey;
  let authMode: AuthMode = 'none';
  if (key) authMode = key.secretRef && !key.inline && !key.queryParam ? 'existing' : 'kept';
  return {
    ...newServer(),
    name: ref.name || '',
    kind: ref.kind === 'Backend' ? 'Backend' : 'Service',
    port: ref.port !== undefined ? String(ref.port) : '',
    path: ref.path || '',
    includeTools: (ref.toolSelector?.include || []).join(', '),
    includeRegex: (ref.toolSelector?.includeRegex || []).join(', '),
    excludeTools: (ref.toolSelector?.exclude || []).join(', '),
    authMode,
    secretName: key?.secretRef?.name || '',
    header: authMode === 'existing' ? key?.header || '' : '',
    forwardHeaders: (ref.forwardHeaders || []).map((h: Json) => h.name).join(', '),
    original: ref,
  };
}

/** Pre-fills the form from an existing MCPRoute. */
export function formFromMCPRoute(json: Json): MCPForm {
  const spec: Json = json.spec || {};
  const oauth: Json | undefined = spec.securityPolicy?.oauth;
  return {
    name: json.metadata?.name || '',
    namespace: json.metadata?.namespace || '',
    gateways: gatewayRefsFromSpec(spec.parentRefs),
    path: spec.path || '/mcp',
    hostnames: (spec.hostnames || []).join(', '),
    servers: (spec.backendRefs || []).map(serverFromRef),
    oauth: {
      enabled: !!oauth,
      issuer: oauth?.issuer || '',
      audiences: (oauth?.audiences || []).join(', '),
      jwksUri: oauth?.jwks?.remoteJWKS?.uri || '',
      resource: oauth?.protectedResourceMetadata?.resource || '',
      scopes: (oauth?.protectedResourceMetadata?.scopesSupported || []).join(', '),
    },
  };
}
