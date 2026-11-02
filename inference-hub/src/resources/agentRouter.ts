/**
 * Publishing a model endpoint through Agent Router (Envoy AI Gateway).
 *
 * Clients pick a model with the x-ai-eg-model header; an AIGatewayRoute rule matches the model
 * names and sends the requests to a backend:
 *
 * - an endpoint with the llm-d scheduler is reached through its InferencePool, so the endpoint
 *   picker keeps doing the load balancing (a rule with a pool has exactly that one backendRef);
 * - any other endpoint is reached through an Envoy Gateway Backend that points at its in-cluster
 *   service, wrapped in an AIServiceBackend with the OpenAI schema. Both are owned by the
 *   endpoint (ownerReferences), so they are deleted with it.
 *
 * Everything here is pure; the rules mirror what the Agent Router plugin writes.
 */
import { KubeJson, ObjectMeta } from './types';

export const AI_GATEWAY_GROUP = 'aigateway.envoyproxy.io';
export const ENVOY_GATEWAY_GROUP = 'gateway.envoyproxy.io';
export const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';
export const AI_MODEL_HEADER = 'x-ai-eg-model';

type Json = Record<string, any>;

export interface PoolRef {
  group: string;
  name: string;
  namespace: string;
}

/** The in-cluster address of the model server, from the Playground's target resolution. */
export interface ServiceAddress {
  scheme: 'http' | 'https';
  host: string;
  port: number;
  /** OpenAI API prefix: "/v1" (vLLM) or "/openai/v1" (KServe Hugging Face runtime). */
  apiPrefix: string;
}

/** How the route reaches the endpoint. */
export type PublishBackend =
  | { type: 'pool'; pool: PoolRef }
  | { type: 'service'; address: ServiceAddress };

/** The InferencePool KServe created for an LLMInferenceService with the llm-d scheduler. */
export function endpointPool(endpoint: KubeJson): PoolRef | undefined {
  const status = (endpoint as Json).status?.router?.scheduler?.inferencePool;
  if (!status?.name) return undefined;
  return {
    group: status.group || 'inference.networking.k8s.io',
    name: status.name,
    namespace: status.namespace || endpoint.metadata.namespace || '',
  };
}

/** Parses an in-cluster base URL such as https://x.ns.svc.cluster.local:8000. */
export function serviceAddress(url: string, apiPrefix: string): ServiceAddress | undefined {
  const match = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(url);
  if (!match) return undefined;
  const scheme = match[1] as 'http' | 'https';
  return {
    scheme,
    host: match[2],
    port: match[3] ? Number(match[3]) : scheme === 'https' ? 443 : 80,
    apiPrefix,
  };
}

export interface PublishForm {
  /** Add a rule to an existing route, or create a new route. */
  mode: 'existing' | 'new';
  routeName: string;
  routeNamespace: string;
  /** Gateway of a new route. */
  gatewayName: string;
  gatewayNamespace: string;
  /** Model names clients send in x-ai-eg-model. */
  models: string[];
  /** Create a ReferenceGrant when the route is in another namespace than the endpoint. */
  createGrant: boolean;
}

export interface ApiVersions {
  route: string;
  serviceBackend: string;
  envoyBackend: string;
  referenceGrant?: string;
}

const DNS_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** Model names of a rule when it only matches x-ai-eg-model exactly; null otherwise. */
export function ruleModels(rule: Json): string[] | null {
  const models: string[] = [];
  for (const match of (rule.matches || []) as Json[]) {
    const headers: Json[] = match.headers || [];
    const header = headers[0];
    if (
      Object.keys(match).length !== 1 ||
      headers.length !== 1 ||
      header?.name?.toLowerCase() !== AI_MODEL_HEADER ||
      (header.type && header.type !== 'Exact') ||
      !header.value
    ) {
      return null;
    }
    models.push(header.value);
  }
  return models;
}

/** Every model name a route already matches. */
export function routeModels(route: KubeJson | undefined): string[] {
  return ((route?.spec as Json)?.rules || []).flatMap((rule: Json) => ruleModels(rule) || []);
}

/** Name of the Envoy Backend and AIServiceBackend created for an endpoint. */
export function backendName(endpointName: string): string {
  return endpointName;
}

export function validatePublish(form: PublishForm, existingRoute?: KubeJson): string[] {
  const errors: string[] = [];
  if (!form.routeName || !DNS_LABEL.test(form.routeName) || form.routeName.length > 63) {
    errors.push(form.mode === 'new' ? 'Enter a valid route name.' : 'Pick a route.');
  }
  if (!form.routeNamespace) errors.push('Pick the namespace of the route.');
  if (form.mode === 'new' && !form.gatewayName) errors.push('Pick the Gateway of the new route.');
  if (form.models.length === 0) errors.push('Enter at least one model name.');
  const taken = new Set(routeModels(existingRoute));
  const duplicate = form.models.filter(m => taken.has(m));
  if (form.mode === 'existing' && duplicate.length > 0) {
    errors.push(`The route already has a rule for ${duplicate.join(', ')}.`);
  }
  if (new Set(form.models).size !== form.models.length) errors.push('Model names repeat.');
  return errors;
}

function ownerReference(endpoint: KubeJson) {
  return {
    apiVersion: endpoint.apiVersion || '',
    kind: endpoint.kind || '',
    name: endpoint.metadata.name,
    uid: endpoint.metadata.uid || '',
  };
}

function metadata(name: string, namespace: string, extra: Partial<ObjectMeta> = {}): ObjectMeta {
  return {
    name,
    namespace,
    labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
    ...extra,
  };
}

/**
 * The Envoy Gateway Backend and AIServiceBackend of an endpoint reached through its service.
 * Self-signed certificates of KServe model servers are not verified (TLS still encrypts).
 */
export function serviceBackendObjects(
  endpoint: KubeJson,
  address: ServiceAddress,
  versions: ApiVersions
): KubeJson[] {
  const name = backendName(endpoint.metadata.name);
  const namespace = endpoint.metadata.namespace || '';
  const owned = { ownerReferences: [ownerReference(endpoint)] };
  const envoyBackend: KubeJson = {
    apiVersion: versions.envoyBackend,
    kind: 'Backend',
    metadata: metadata(name, namespace, owned),
    spec: {
      endpoints: [{ fqdn: { hostname: address.host, port: address.port } }],
      ...(address.scheme === 'https' ? { tls: { insecureSkipVerify: true } } : {}),
    },
  };
  const serviceBackend: KubeJson = {
    apiVersion: versions.serviceBackend,
    kind: 'AIServiceBackend',
    metadata: metadata(name, namespace, owned),
    spec: {
      schema: {
        name: 'OpenAI',
        ...(address.apiPrefix && address.apiPrefix !== '/v1' ? { prefix: address.apiPrefix } : {}),
      },
      backendRef: { group: ENVOY_GATEWAY_GROUP, kind: 'Backend', name },
    },
  };
  return [envoyBackend, serviceBackend];
}

/** The backendRef of the new rule; the namespace is set when it differs from the route's. */
export function ruleBackendRef(
  backend: PublishBackend,
  endpoint: KubeJson,
  routeNamespace: string
): Json {
  const namespace =
    backend.type === 'pool' ? backend.pool.namespace : endpoint.metadata.namespace || '';
  const ns = namespace && namespace !== routeNamespace ? { namespace } : {};
  return backend.type === 'pool'
    ? { group: backend.pool.group, kind: 'InferencePool', name: backend.pool.name, ...ns }
    : { name: backendName(endpoint.metadata.name), ...ns };
}

/** A rule that sends the given model names to one backend. */
export function modelRule(models: string[], backendRef: Json): Json {
  return {
    matches: models.map(model => ({
      headers: [{ type: 'Exact', name: AI_MODEL_HEADER, value: model }],
    })),
    backendRefs: [backendRef],
  };
}

/** A copy of a live route (without status) with the rule appended. */
export function withRule(route: KubeJson, rule: Json): KubeJson {
  const copy = JSON.parse(JSON.stringify(route)) as KubeJson & { status?: unknown };
  delete copy.status;
  delete (copy.metadata as Json).managedFields;
  const spec = (copy.spec || {}) as Json;
  spec.rules = [...(spec.rules || []), rule];
  copy.spec = spec;
  return copy;
}

export function newRoute(form: PublishForm, rule: Json, apiVersion: string): KubeJson {
  return {
    apiVersion,
    kind: 'AIGatewayRoute',
    metadata: metadata(form.routeName, form.routeNamespace),
    spec: {
      parentRefs: [
        {
          group: GATEWAY_API_GROUP,
          kind: 'Gateway',
          name: form.gatewayName,
          ...(form.gatewayNamespace && form.gatewayNamespace !== form.routeNamespace
            ? { namespace: form.gatewayNamespace }
            : {}),
        },
      ],
      rules: [rule],
    },
  };
}

/** Lets AIGatewayRoutes of `routeNamespace` reference the backend in the endpoint namespace. */
export function referenceGrant(
  backend: PublishBackend,
  endpointNamespace: string,
  routeNamespace: string,
  apiVersion: string
): KubeJson {
  const to =
    backend.type === 'pool'
      ? { group: backend.pool.group, kind: 'InferencePool' }
      : { group: AI_GATEWAY_GROUP, kind: 'AIServiceBackend' };
  return {
    apiVersion,
    kind: 'ReferenceGrant',
    metadata: metadata(`ai-routes-from-${routeNamespace}`.slice(0, 63), endpointNamespace),
    spec: {
      from: [{ group: AI_GATEWAY_GROUP, kind: 'AIGatewayRoute', namespace: routeNamespace }],
      to: [to],
    },
  };
}

export interface PublishPlan {
  /** Objects to create (never overwritten), in order. */
  create: KubeJson[];
  /** The route: created when new, updated (with its resourceVersion) when existing. */
  route: KubeJson;
  routeIsNew: boolean;
  /** Whether a ReferenceGrant is part of `create`. */
  grant: boolean;
}

export function publishPlan(
  endpoint: KubeJson,
  backend: PublishBackend,
  form: PublishForm,
  versions: ApiVersions,
  existingRoute?: KubeJson
): PublishPlan {
  const endpointNamespace = endpoint.metadata.namespace || '';
  const create: KubeJson[] =
    backend.type === 'service' ? serviceBackendObjects(endpoint, backend.address, versions) : [];
  const crossNamespace = form.routeNamespace !== endpointNamespace;
  const grant = crossNamespace && form.createGrant && !!versions.referenceGrant;
  if (grant) {
    create.push(
      referenceGrant(backend, endpointNamespace, form.routeNamespace, versions.referenceGrant!)
    );
  }
  const rule = modelRule(form.models, ruleBackendRef(backend, endpoint, form.routeNamespace));
  const route =
    form.mode === 'existing' && existingRoute
      ? withRule(existingRoute, rule)
      : newRoute(form, rule, versions.route);
  return { create, route, routeIsNew: form.mode !== 'existing', grant };
}

export interface RouteUse {
  route: KubeJson;
  models: string[];
}

/**
 * Routes that send traffic to the endpoint: through its InferencePool, or through an
 * AIServiceBackend the endpoint owns.
 */
export function routesUsingEndpoint(
  routes: KubeJson[],
  endpoint: KubeJson,
  serviceBackends: KubeJson[]
): RouteUse[] {
  const namespace = endpoint.metadata.namespace || '';
  const pool = endpointPool(endpoint);
  const owned = new Set(
    serviceBackends
      .filter(
        b =>
          (b.metadata.namespace || '') === namespace &&
          (b.metadata.ownerReferences || []).some(o => o.uid && o.uid === endpoint.metadata.uid)
      )
      .map(b => b.metadata.name)
  );
  return routes.flatMap(route => {
    const routeNs = route.metadata.namespace || '';
    const rules = ((route.spec as Json)?.rules || []) as Json[];
    const matching = rules.filter(rule =>
      ((rule.backendRefs || []) as Json[]).some(ref => {
        const ns = ref.namespace || routeNs;
        if (ref.kind === 'InferencePool') {
          return !!pool && ref.name === pool.name && ns === pool.namespace;
        }
        return (
          (!ref.kind || ref.kind === 'AIServiceBackend') && ns === namespace && owned.has(ref.name)
        );
      })
    );
    if (matching.length === 0) return [];
    return [{ route, models: matching.flatMap(rule => ruleModels(rule) || ['(custom match)']) }];
  });
}
