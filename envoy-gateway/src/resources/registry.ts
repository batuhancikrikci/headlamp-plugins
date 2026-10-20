import { Backend } from './backend';
import { BackendTrafficPolicy } from './backendTrafficPolicy';
import { EnvoyGatewayObject } from './base';
import { ClientTrafficPolicy } from './clientTrafficPolicy';
import { EnvoyExtensionPolicy } from './envoyExtensionPolicy';
import { EnvoyPatchPolicy } from './envoyPatchPolicy';
import { EnvoyProxy } from './envoyProxy';
import { HTTPRouteFilter } from './httpRouteFilter';
import { SecurityPolicy } from './securityPolicy';

export const URL_PREFIX = '/envoy-gateway';
export const SIDEBAR_ROOT = 'envoy-gateway';

export type EnvoyGatewayClass = typeof EnvoyGatewayObject & {
  kind: string;
  apiName: string;
  detailsRoute: string;
};

export interface CRDInfo {
  kind: string;
  /** Resource plural as served by the API server. */
  plural: string;
  /** Human readable plural label (English, translated at render time). */
  labelPlural: string;
  cls: EnvoyGatewayClass;
  /** Whether the CRD is a policy that attaches to Gateway API resources. */
  isPolicy: boolean;
  /** Short description shown on the overview page. */
  description: string;
  /**
   * Where the health of an object comes from: controller conditions, the resources that
   * reference it (Envoy Gateway leaves EnvoyProxy.status empty), or nowhere (HTTPRouteFilter
   * has no status).
   */
  statusSource: 'conditions' | 'usage' | 'none';
}

/** All supported Envoy Gateway CRDs, in sidebar order. */
export const CRDS: CRDInfo[] = [
  {
    kind: 'EnvoyProxy',
    plural: 'envoyproxies',
    labelPlural: 'Envoy Proxies',
    cls: EnvoyProxy as EnvoyGatewayClass,
    isPolicy: false,
    description:
      'Data plane (Envoy fleet) configuration referenced by GatewayClasses and Gateways.',
    statusSource: 'usage',
  },
  {
    kind: 'ClientTrafficPolicy',
    plural: 'clienttrafficpolicies',
    labelPlural: 'Client Traffic Policies',
    cls: ClientTrafficPolicy as EnvoyGatewayClass,
    isPolicy: true,
    description: 'Downstream settings between clients and Envoy: TLS, HTTP, timeouts, client IP.',
    statusSource: 'conditions',
  },
  {
    kind: 'BackendTrafficPolicy',
    plural: 'backendtrafficpolicies',
    labelPlural: 'Backend Traffic Policies',
    cls: BackendTrafficPolicy as EnvoyGatewayClass,
    isPolicy: true,
    description: 'Upstream behaviour: load balancing, rate limiting, retries, circuit breaking.',
    statusSource: 'conditions',
  },
  {
    kind: 'SecurityPolicy',
    plural: 'securitypolicies',
    labelPlural: 'Security Policies',
    cls: SecurityPolicy as EnvoyGatewayClass,
    isPolicy: true,
    description: 'Authentication (JWT, OIDC, Basic, API key, ExtAuth), CORS and authorization.',
    statusSource: 'conditions',
  },
  {
    kind: 'EnvoyExtensionPolicy',
    plural: 'envoyextensionpolicies',
    labelPlural: 'Envoy Extension Policies',
    cls: EnvoyExtensionPolicy as EnvoyGatewayClass,
    isPolicy: true,
    description: 'Extends Envoy with Wasm, Lua and external processing filters.',
    statusSource: 'conditions',
  },
  {
    kind: 'EnvoyPatchPolicy',
    plural: 'envoypatchpolicies',
    labelPlural: 'Envoy Patch Policies',
    cls: EnvoyPatchPolicy as EnvoyGatewayClass,
    isPolicy: true,
    description: 'Low level JSON patches applied to the generated xDS configuration.',
    statusSource: 'conditions',
  },
  {
    kind: 'Backend',
    plural: 'backends',
    labelPlural: 'Backends',
    cls: Backend as EnvoyGatewayClass,
    isPolicy: false,
    description: 'Non-Service backends (FQDN, IP, Unix socket) referenced from routes.',
    statusSource: 'conditions',
  },
  {
    kind: 'HTTPRouteFilter',
    plural: 'httproutefilters',
    labelPlural: 'HTTP Route Filters',
    cls: HTTPRouteFilter as EnvoyGatewayClass,
    isPolicy: false,
    description: 'Envoy Gateway specific HTTPRoute filters (URL rewrite, direct response).',
    statusSource: 'none',
  },
];

export function crdByKind(kind: string): CRDInfo | undefined {
  return CRDS.find(c => c.kind === kind);
}

export function crdByPlural(plural: string): CRDInfo | undefined {
  return CRDS.find(c => c.plural === plural);
}

export function listRouteName(plural: string): string {
  return `eg-${plural}`;
}

export function listPath(plural: string): string {
  return `${URL_PREFIX}/${plural}`;
}
