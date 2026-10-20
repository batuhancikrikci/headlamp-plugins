/**
 * Client-side validation for the create/edit forms. The API server remains the source of truth
 * (CRD OpenAPI + CEL rules); these checks only catch the common mistakes early and explain them.
 *
 * Messages are i18n keys (English) with interpolation params, translated at render time.
 */
import { ValidationError } from '../common/form/types';
import { isValidDuration, isValidResourceName } from '../common/objects';
import { ObjectJson, TargetRef } from '../resources/types';
import { resolveTargetRefs } from './targets';

/** Errors about metadata and targets (the first step of the wizards). */
const GENERAL_KEYS = new Set([
  'Name is required',
  'Name "{{name}}" is not a valid resource name',
  'Namespace is required',
  'At least one target is required',
  'Target #{{index}} needs a name',
]);

export function isGeneralError(e: ValidationError): boolean {
  return GENERAL_KEYS.has(e.key);
}

const DURATION_KEYS =
  /(Timeout|Interval|Window|Time|Duration|Delay|maxAge|ttl|timeout|interval|window)$/;

/** Walks the spec and reports every string field that looks like a duration but is invalid. */
export function findInvalidDurations(value: unknown, path: string[] = []): string[] {
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (typeof child === 'string' && DURATION_KEYS.test(key) && !isValidDuration(child)) {
      found.push(childPath.join('.'));
    } else if (typeof child === 'object') {
      found.push(...findInvalidDurations(child, childPath));
    }
  }
  return found;
}

function validateMetadata(obj: ObjectJson): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = obj.metadata?.name;
  if (!name) errors.push({ key: 'Name is required' });
  else if (!isValidResourceName(name))
    errors.push({ key: 'Name "{{name}}" is not a valid resource name', params: { name } });
  if (!obj.metadata?.namespace) errors.push({ key: 'Namespace is required' });
  return errors;
}

function validateTargets(refs: TargetRef[], selectorsCount: number): ValidationError[] {
  if (refs.length === 0 && selectorsCount === 0) {
    return [{ key: 'At least one target is required' }];
  }
  const errors: ValidationError[] = [];
  refs.forEach((r, i) => {
    if (!r.name) errors.push({ key: 'Target #{{index}} needs a name', params: { index: i + 1 } });
  });
  return errors;
}

function validateDurations(obj: ObjectJson): ValidationError[] {
  return findInvalidDurations(obj.spec).map(path => ({
    key: 'Invalid duration at {{path}}',
    params: { path: `spec.${path}` },
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const kindValidators: Record<string, (spec: Spec, obj: ObjectJson) => ValidationError[]> = {
  Backend(spec) {
    const errors: ValidationError[] = [];
    const endpoints: Spec[] = spec.endpoints || [];
    if (endpoints.length === 0) errors.push({ key: 'At least one endpoint is required' });
    endpoints.forEach((ep, i) => {
      const index = i + 1;
      if (ep.fqdn && (!ep.fqdn.hostname || !ep.fqdn.port)) {
        errors.push({ key: 'Endpoint #{{index}} needs a hostname and port', params: { index } });
      } else if (ep.ip && (!ep.ip.address || !ep.ip.port)) {
        errors.push({ key: 'Endpoint #{{index}} needs an address and port', params: { index } });
      } else if (ep.unix && !ep.unix.path) {
        errors.push({ key: 'Endpoint #{{index}} needs a socket path', params: { index } });
      } else if (!ep.fqdn && !ep.ip && !ep.unix) {
        errors.push({ key: 'Endpoint #{{index}} has no address', params: { index } });
      }
    });
    return errors;
  },

  HTTPRouteFilter(spec) {
    const errors: ValidationError[] = [];
    if (!spec.urlRewrite && !spec.directResponse && !spec.credentialInjection) {
      errors.push({ key: 'Configure a URL rewrite or a direct response' });
    }
    const hostname = spec.urlRewrite?.hostname;
    if (hostname?.type === 'Header' && !hostname.header) {
      errors.push({ key: 'Hostname rewrite from a header needs the header name' });
    }
    const path = spec.urlRewrite?.path;
    if (path && !path.replaceRegexMatch?.pattern) {
      errors.push({ key: 'Path rewrite needs a regex pattern' });
    }
    const body = spec.directResponse?.body;
    if (body?.type === 'ValueRef' && !body.valueRef?.name) {
      errors.push({ key: 'Direct response body needs a ConfigMap' });
    }
    return errors;
  },

  SecurityPolicy(spec) {
    const errors: ValidationError[] = [];
    (spec.jwt?.providers || []).forEach((p: Spec, i: number) => {
      const index = i + 1;
      if (!p.name) errors.push({ key: 'JWT provider #{{index}} needs a name', params: { index } });
      if (!p.remoteJWKS?.uri && !p.localJWKS) {
        errors.push({ key: 'JWT provider #{{index}} needs a JWKS URI', params: { index } });
      }
    });
    if (spec.jwt && (spec.jwt.providers || []).length === 0) {
      errors.push({ key: 'JWT needs at least one provider' });
    }
    if (spec.oidc) {
      if (!spec.oidc.provider?.issuer) errors.push({ key: 'OIDC needs an issuer' });
      if (!spec.oidc.clientID) errors.push({ key: 'OIDC needs a client ID' });
      if (!spec.oidc.clientSecret?.name) errors.push({ key: 'OIDC needs a client secret' });
    }
    if (spec.basicAuth && !spec.basicAuth.users?.name) {
      errors.push({ key: 'Basic auth needs a users Secret' });
    }
    if (spec.apiKeyAuth && !(spec.apiKeyAuth.credentialRefs || []).length) {
      errors.push({ key: 'API key auth needs at least one credential Secret' });
    }
    if (spec.extAuth) {
      const svc = spec.extAuth.grpc || spec.extAuth.http;
      const refs = [...(svc?.backendRef ? [svc.backendRef] : []), ...(svc?.backendRefs || [])];
      if (!svc) errors.push({ key: 'External auth needs a gRPC or HTTP service' });
      else if (refs.length === 0 || refs.some((r: Spec) => !r.name)) {
        errors.push({ key: 'External auth needs a backend' });
      }
    }
    (spec.authorization?.rules || []).forEach((r: Spec, i: number) => {
      if (!r.action)
        errors.push({
          key: 'Authorization rule #{{index}} needs an action',
          params: { index: i + 1 },
        });
    });
    return errors;
  },

  BackendTrafficPolicy(spec) {
    const errors: ValidationError[] = [];
    const rl = spec.rateLimit;
    if (rl) {
      const rules: Spec[] = [...(rl.local?.rules || []), ...(rl.global?.rules || [])];
      if (rules.length === 0) errors.push({ key: 'Rate limit needs at least one rule' });
      rules.forEach((r, i) => {
        if (!r.limit?.requests || r.limit.requests < 1 || !r.limit?.unit) {
          errors.push({
            key: 'Rate limit rule #{{index}} needs requests and a unit',
            params: { index: i + 1 },
          });
        }
      });
    }
    const lb = spec.loadBalancer;
    if (lb?.type === 'ConsistentHash') {
      const ch = lb.consistentHash;
      if (!ch?.type) errors.push({ key: 'Consistent hash needs a hash type' });
      if (ch?.type === 'Header' && !ch.header?.name)
        errors.push({ key: 'Consistent hash by header needs a header name' });
      if (ch?.type === 'Cookie' && !ch.cookie?.name)
        errors.push({ key: 'Consistent hash by cookie needs a cookie name' });
    }
    if (lb?.slowStart && lb.type && !['RoundRobin', 'LeastRequest'].includes(lb.type)) {
      errors.push({ key: 'Slow start is only supported with RoundRobin and LeastRequest' });
    }
    const pct = [spec.faultInjection?.delay?.percentage, spec.faultInjection?.abort?.percentage];
    if (pct.some(p => p !== undefined && (p < 0 || p > 100))) {
      errors.push({ key: 'Fault injection percentage must be between 0 and 100' });
    }
    return errors;
  },

  EnvoyPatchPolicy(spec) {
    const errors: ValidationError[] = [];
    (spec.jsonPatches || []).forEach((p: Spec, i: number) => {
      const index = i + 1;
      if (!p.type || !p.name)
        errors.push({
          key: 'Patch #{{index}} needs a type and a resource name',
          params: { index },
        });
      if (!p.operation?.op)
        errors.push({ key: 'Patch #{{index}} needs an operation', params: { index } });
      if (!p.operation?.path && !p.operation?.jsonPath) {
        errors.push({ key: 'Patch #{{index}} needs a path or JSONPath', params: { index } });
      }
    });
    return errors;
  },

  EnvoyExtensionPolicy(spec) {
    const errors: ValidationError[] = [];
    if (!spec.wasm?.length && !spec.extProc?.length && !spec.lua?.length) {
      errors.push({ key: 'Add at least one Wasm, Lua or external processing extension' });
    }
    (spec.wasm || []).forEach((w: Spec, i: number) => {
      const url = w.code?.type === 'Image' ? w.code?.image?.url : w.code?.http?.url;
      if (!url)
        errors.push({
          key: 'Wasm extension #{{index}} needs a code URL',
          params: { index: i + 1 },
        });
    });
    (spec.extProc || []).forEach((p: Spec, i: number) => {
      const refs = [...(p.backendRef ? [p.backendRef] : []), ...(p.backendRefs || [])];
      if (refs.length === 0 || refs.some((r: Spec) => !r.name)) {
        errors.push({
          key: 'External processor #{{index}} needs a backend',
          params: { index: i + 1 },
        });
      }
    });
    return errors;
  },
};

const POLICY_KINDS = new Set([
  'SecurityPolicy',
  'BackendTrafficPolicy',
  'ClientTrafficPolicy',
  'EnvoyExtensionPolicy',
  'EnvoyPatchPolicy',
]);

/** Validates an object built by one of the forms. */
export function validateResource(obj: ObjectJson): ValidationError[] {
  const errors = validateMetadata(obj);
  const spec: Spec = obj.spec || {};
  if (obj.kind && POLICY_KINDS.has(obj.kind)) {
    errors.push(...validateTargets(resolveTargetRefs(spec), (spec.targetSelectors || []).length));
  }
  const kindValidator = obj.kind ? kindValidators[obj.kind] : undefined;
  if (kindValidator) errors.push(...kindValidator(spec, obj));
  errors.push(...validateDurations(obj));
  return errors;
}
