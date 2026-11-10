/**
 * Reaching a model endpoint through a Gateway instead of its own service: which gateway paths an
 * endpoint has, which service and port of the gateway to use, what the gateway's security
 * policies expect from a client, and which request headers a user may add.
 *
 * Requests still go through the Kubernetes API server's service proxy, so they reach the
 * gateway's own Service (for Envoy Gateway, the Envoy proxy service). That path runs the
 * gateway's routing, scheduling (llm-d endpoint picker) and policies, unlike the direct path.
 */
import type { RouteUse } from './agentRouter';
import type { ModelEndpoint } from './endpoint';
import type { KubeJson } from './types';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GatewayVia {
  /** The Gateway the requests go through. */
  name: string;
  namespace: string;
  /** Path the route publishes the model API under ('' for the root of the gateway). */
  pathPrefix: string;
  /** What publishes the endpoint on the gateway. */
  source: 'kserve' | 'agentRouter';
  /** The AIGatewayRoute, for Agent Router. */
  routeName?: string;
  /** HTTPRoutes carrying the traffic (namespace/name), for the security policy lookup. */
  routes: Array<{ namespace: string; name: string }>;
  /** Hostnames the routes accept; empty when they accept any. */
  hostnames: string[];
  /** The endpoint behind the gateway, as "slug/namespace/name". */
  endpointId: string;
}

export interface GatewayPath {
  via: GatewayVia;
  /** Model name to send; Agent Router routes on it. */
  model: string;
}

const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';

function hostnamesOf(routes: KubeJson[], refs: Array<{ namespace: string; name: string }>) {
  const names = routes
    .filter(r =>
      refs.some(ref => ref.name === r.metadata.name && ref.namespace === r.metadata.namespace)
    )
    .flatMap(r => ((r.spec as Json)?.hostnames || []) as string[]);
  return Array.from(new Set(names));
}

/**
 * Gateway paths of an endpoint: the route KServe manages for an LLMInferenceService (published
 * under /<namespace>/<name>), and every Agent Router route that sends traffic to it (published at
 * the gateway root, selected by the model name).
 */
export function gatewayPathsOf(
  endpoint: ModelEndpoint,
  httpRoutes: KubeJson[],
  agentRouterUses: RouteUse[]
): GatewayPath[] {
  const endpointId = `${endpoint.slug}/${endpoint.namespace}/${endpoint.name}`;
  const paths: GatewayPath[] = [];

  if (endpoint.kind === 'LLMInferenceService') {
    const gateways = ((endpoint.raw.status as Json)?.router?.gateways || []) as Json[];
    for (const gw of gateways) {
      if (!gw?.name) continue;
      const routes = ((gw.httpRoutes || []) as Json[])
        .filter(r => r?.name)
        .map(r => ({
          name: r.name as string,
          namespace: (r.namespace as string) || endpoint.namespace,
        }));
      paths.push({
        model: endpoint.servedModelName,
        via: {
          name: gw.name,
          namespace: gw.namespace || endpoint.namespace,
          pathPrefix: `/${endpoint.namespace}/${endpoint.name}`,
          source: 'kserve',
          routes,
          hostnames: hostnamesOf(httpRoutes, routes),
          endpointId,
        },
      });
    }
  }

  for (const use of agentRouterUses) {
    const route = use.route;
    const routeNs = route.metadata.namespace || '';
    const model = use.models.find(m => m !== '(custom match)') || endpoint.servedModelName;
    const parents = (((route.spec as Json)?.parentRefs || []) as Json[]).filter(
      p => (!p.kind || p.kind === 'Gateway') && (!p.group || p.group === GATEWAY_API_GROUP)
    );
    for (const parent of parents) {
      // Agent Router creates an HTTPRoute with the name of the AIGatewayRoute.
      const routes = [{ namespace: routeNs, name: route.metadata.name }];
      paths.push({
        model,
        via: {
          name: parent.name,
          namespace: parent.namespace || routeNs,
          pathPrefix: '',
          source: 'agentRouter',
          routeName: route.metadata.name,
          routes,
          hostnames: hostnamesOf(httpRoutes, routes),
          endpointId,
        },
      });
    }
  }
  return paths;
}

interface ServicePort {
  port: number;
  name?: string;
  appProtocol?: string;
}

/**
 * Port and scheme of the gateway Service to send requests to: the port of an HTTP listener when
 * there is one (TLS listeners expect the route hostnames, which the proxy cannot send), else the
 * first HTTPS listener, else the first port of the Service.
 */
export function pickGatewayPort(
  gateway: KubeJson | undefined,
  servicePorts: ServicePort[]
): { port: number; scheme: 'http' | 'https' } | undefined {
  const listeners = ((gateway?.spec as Json)?.listeners || []) as Json[];
  const byProtocol = (protocol: string) =>
    listeners
      .filter(l => l.protocol === protocol)
      .map(l => servicePorts.find(p => p.port === l.port))
      .find(Boolean);
  const http = byProtocol('HTTP');
  if (http) return { port: http.port, scheme: 'http' };
  const https = byProtocol('HTTPS');
  if (https) return { port: https.port, scheme: 'https' };
  const first = servicePorts[0];
  if (!first) return undefined;
  const tls = first.name === 'https' || first.appProtocol === 'https' || first.port === 443;
  return { port: first.port, scheme: tls ? 'https' : 'http' };
}

/** Label selectors that find the Service of a Gateway, in the order they are tried. */
export function gatewayServiceSelectors(via: Pick<GatewayVia, 'name' | 'namespace'>) {
  return [
    // Envoy Gateway runs the proxy in its own namespace and labels it with the owning Gateway.
    {
      allNamespaces: true,
      selector: `gateway.envoyproxy.io/owning-gateway-name=${via.name},gateway.envoyproxy.io/owning-gateway-namespace=${via.namespace}`,
    },
    // The Gateway API convention (Istio, kgateway and others): same namespace as the Gateway.
    { allNamespaces: false, selector: `gateway.networking.k8s.io/gateway-name=${via.name}` },
  ];
}

export interface AuthHint {
  policy: string;
  /** What the policy asks of a client, in words. */
  text: string;
  /** Header names to fill in, when the policy reads one. */
  headers: string[];
  /** The proxy path cannot satisfy the policy (credentials in Authorization, cookies, …). */
  unusable: boolean;
}

function targets(policy: Json): Json[] {
  const spec = policy.spec || {};
  return [...(spec.targetRefs || []), ...(spec.targetRef ? [spec.targetRef] : [])];
}

/**
 * Envoy Gateway SecurityPolicies that apply to the gateway path (through targetRefs to the
 * Gateway or one of the HTTPRoutes), and what each asks of a client. Policies that select their
 * targets by label are not found.
 */
export function authHints(policies: KubeJson[], via: GatewayVia): AuthHint[] {
  const applies = (policy: KubeJson) =>
    targets(policy as Json).some(ref => {
      const ns = policy.metadata.namespace || '';
      if (ref.kind === 'Gateway') return ref.name === via.name && ns === via.namespace;
      if (ref.kind === 'HTTPRoute') {
        return via.routes.some(r => r.name === ref.name && r.namespace === ns);
      }
      return false;
    });

  return policies.filter(applies).flatMap(policy => {
    const spec = ((policy as Json).spec || {}) as Json;
    const name = `${policy.metadata.namespace}/${policy.metadata.name}`;
    const hints: AuthHint[] = [];
    if (spec.apiKeyAuth) {
      const headers = ((spec.apiKeyAuth.extractFrom || []) as Json[]).flatMap(
        e => (e.headers || []) as string[]
      );
      hints.push({
        policy: name,
        text: headers.length
          ? `API key in header ${headers.join(' or ')}`
          : 'API key (read from query parameters or cookies)',
        headers,
        unusable: headers.length === 0,
      });
    }
    if (spec.jwt) {
      const headers = ((spec.jwt.providers || []) as Json[]).flatMap(p =>
        ((p.extractFrom?.headers || []) as Json[]).map(h => h.name as string)
      );
      const custom = headers.filter(h => h.toLowerCase() !== 'authorization');
      hints.push({
        policy: name,
        text: custom.length
          ? `JWT in header ${custom.join(' or ')}`
          : 'JWT in the Authorization header',
        headers: custom,
        unusable: custom.length === 0,
      });
    }
    if (spec.basicAuth) {
      hints.push({ policy: name, text: 'Basic authentication', headers: [], unusable: true });
    }
    if (spec.oidc) {
      hints.push({ policy: name, text: 'OIDC login', headers: [], unusable: true });
    }
    if (spec.extAuth) {
      const headers = ((spec.extAuth.headersToExtAuth || []) as string[]).filter(
        h => h.toLowerCase() !== 'authorization'
      );
      hints.push({
        policy: name,
        text: headers.length
          ? `External authorization, which reads ${headers.join(', ')}`
          : 'External authorization',
        headers,
        unusable: false,
      });
    }
    return hints;
  });
}

/**
 * Header names a user may not set: the Kubernetes API server reads Authorization and the
 * Impersonate-* headers itself, and the browser or the proxy own the others.
 */
const RESERVED = new Set([
  'authorization',
  'host',
  'content-type',
  'content-length',
  'accept',
  'connection',
  'cookie',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'keep-alive',
  'proxy-authorization',
]);

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Why a request header cannot be used, or undefined when it can. */
export function headerProblem(name: string): string | undefined {
  const lower = name.trim().toLowerCase();
  if (!lower) return 'Enter a header name.';
  if (!TOKEN.test(lower)) return 'Header names may only contain letters, digits and - _ . etc.';
  if (lower === 'authorization' || lower === 'proxy-authorization') {
    return 'Authorization is used to sign in to the Kubernetes API and cannot be sent to the gateway.';
  }
  if (lower.startsWith('impersonate-')) {
    return 'Impersonate-* headers are read by the Kubernetes API server and cannot be set.';
  }
  if (RESERVED.has(lower)) return `${name.trim()} is set by the browser or the proxy.`;
  return undefined;
}
