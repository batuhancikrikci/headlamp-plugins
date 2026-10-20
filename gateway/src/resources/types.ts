/**
 * TypeScript types for the Kubernetes Gateway API.
 *
 * The shapes follow Gateway API v1.6 (the release shipped with Envoy Gateway v1.9), including the
 * fields that only exist in the experimental channel. Every experimental or recently added field
 * is optional, so the same types describe objects from older releases as well.
 *
 * @see https://gateway-api.sigs.k8s.io/reference/spec/
 */
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export const GATEWAY_GROUP = 'gateway.networking.k8s.io';

/** Annotations the Gateway API CRDs carry to describe the installed bundle. */
export const BUNDLE_VERSION_ANNOTATION = 'gateway.networking.k8s.io/bundle-version';
export const CHANNEL_ANNOTATION = 'gateway.networking.k8s.io/channel';

export type ConditionStatus = 'True' | 'False' | 'Unknown';

export interface Condition {
  type: string;
  status: ConditionStatus;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export interface LabelSelectorRequirement {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';
  values?: string[];
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: LabelSelectorRequirement[];
}

// ---------------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------------

/** Reference to an object in the same namespace. */
export interface LocalObjectReference {
  group: string;
  kind: string;
  name: string;
}

/** Reference to an object, optionally in another namespace. */
export interface ObjectReference {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
}

/** Reference to a Secret (default kind), optionally in another namespace. */
export type SecretObjectReference = ObjectReference;

export interface ParametersReference {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
}

/** Reference from a route (or policy status) to a parent, usually a Gateway listener. */
export interface ParentReference {
  group?: string;
  kind?: string;
  namespace?: string;
  name: string;
  sectionName?: string;
  port?: number;
}

/** Reference to a backend, a Service unless group/kind say otherwise. */
export interface BackendObjectReference {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
  port?: number;
}

export interface BackendRef extends BackendObjectReference {
  weight?: number;
}

export interface RouteGroupKind {
  group?: string;
  kind: string;
}

// ---------------------------------------------------------------------------------------------
// GatewayClass
// ---------------------------------------------------------------------------------------------

export interface GatewayClassSpec {
  controllerName: string;
  description?: string;
  parametersRef?: ParametersReference;
}

export interface SupportedFeature {
  name: string;
}

export interface GatewayClassStatus {
  conditions?: Condition[];
  /** Either a list of objects (v1.2+) or, on very old releases, plain strings. */
  supportedFeatures?: Array<SupportedFeature | string>;
}

export interface KubeGatewayClass extends KubeObjectInterface {
  spec: GatewayClassSpec;
  status?: GatewayClassStatus;
}

// ---------------------------------------------------------------------------------------------
// Gateway and listeners
// ---------------------------------------------------------------------------------------------

export type FromNamespaces = 'All' | 'Selector' | 'Same' | 'None';

export interface RouteNamespaces {
  from?: FromNamespaces;
  selector?: LabelSelector;
}

export interface AllowedRoutes {
  namespaces?: RouteNamespaces;
  kinds?: RouteGroupKind[];
}

export type TLSMode = 'Terminate' | 'Passthrough';

export interface ListenerTLSConfig {
  mode?: TLSMode;
  certificateRefs?: SecretObjectReference[];
  options?: Record<string, string>;
}

/** Well-known listener protocols; implementations may define more (`example.com/protocol`). */
export type ProtocolType = 'HTTP' | 'HTTPS' | 'TLS' | 'TCP' | 'UDP' | string;

export interface Listener {
  name: string;
  hostname?: string;
  port: number;
  protocol: ProtocolType;
  tls?: ListenerTLSConfig;
  allowedRoutes?: AllowedRoutes;
}

export interface GatewaySpecAddress {
  type?: string;
  value?: string;
}

export interface GatewayInfrastructure {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  parametersRef?: LocalObjectReference;
}

export interface FrontendTLSValidation {
  caCertificateRefs?: ObjectReference[];
  mode?: 'AllowValidOnly' | 'AllowInsecureFallback';
}

export interface TLSConfig {
  validation?: FrontendTLSValidation;
}

export interface GatewayTLSConfig {
  backend?: {
    clientCertificateRef?: SecretObjectReference;
  };
  frontend?: {
    default?: TLSConfig;
    perPort?: Array<{ port: number; tls: TLSConfig }>;
  };
}

export interface AllowedListeners {
  namespaces?: RouteNamespaces;
}

export interface GatewaySpec {
  gatewayClassName: string;
  listeners: Listener[];
  addresses?: GatewaySpecAddress[];
  infrastructure?: GatewayInfrastructure;
  allowedListeners?: AllowedListeners;
  tls?: GatewayTLSConfig;
  defaultScope?: 'All' | 'None';
}

export interface GatewayStatusAddress {
  type?: string;
  value: string;
}

export interface ListenerStatus {
  name: string;
  attachedRoutes: number;
  supportedKinds?: RouteGroupKind[];
  conditions?: Condition[];
}

export interface GatewayStatus {
  addresses?: GatewayStatusAddress[];
  conditions?: Condition[];
  listeners?: ListenerStatus[];
  attachedListenerSets?: number;
}

export interface KubeGateway extends KubeObjectInterface {
  spec: GatewaySpec;
  status?: GatewayStatus;
}

// ---------------------------------------------------------------------------------------------
// ListenerSet
// ---------------------------------------------------------------------------------------------

export interface ListenerSetSpec {
  parentRef: ObjectReference;
  listeners: Listener[];
}

export interface ListenerSetStatus {
  conditions?: Condition[];
  listeners?: ListenerStatus[];
}

export interface KubeListenerSet extends KubeObjectInterface {
  spec: ListenerSetSpec;
  status?: ListenerSetStatus;
}

// ---------------------------------------------------------------------------------------------
// Routes: shared
// ---------------------------------------------------------------------------------------------

export interface RouteParentStatus {
  parentRef: ParentReference;
  controllerName: string;
  conditions?: Condition[];
}

export interface RouteStatus {
  parents?: RouteParentStatus[];
}

export interface CommonRouteSpec {
  parentRefs?: ParentReference[];
  useDefaultGateways?: 'All' | 'None';
}

export interface SessionPersistence {
  sessionName?: string;
  absoluteTimeout?: string;
  idleTimeout?: string;
  type?: 'Cookie' | 'Header';
  cookieConfig?: {
    lifetimeType?: 'Permanent' | 'Session';
  };
}

// ---------------------------------------------------------------------------------------------
// HTTPRoute
// ---------------------------------------------------------------------------------------------

export type PathMatchType = 'Exact' | 'PathPrefix' | 'RegularExpression';
export type StringMatchType = 'Exact' | 'RegularExpression';
export type HTTPMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'CONNECT'
  | 'OPTIONS'
  | 'TRACE'
  | 'PATCH';

export interface HTTPPathMatch {
  type?: PathMatchType;
  value?: string;
}

export interface HTTPHeaderMatch {
  type?: StringMatchType;
  name: string;
  value: string;
}

export type HTTPQueryParamMatch = HTTPHeaderMatch;

export interface HTTPRouteMatch {
  path?: HTTPPathMatch;
  headers?: HTTPHeaderMatch[];
  queryParams?: HTTPQueryParamMatch[];
  method?: HTTPMethod;
}

export interface HTTPHeader {
  name: string;
  value: string;
}

export interface HTTPHeaderFilter {
  set?: HTTPHeader[];
  add?: HTTPHeader[];
  remove?: string[];
}

export interface HTTPPathModifier {
  type: 'ReplaceFullPath' | 'ReplacePrefixMatch';
  replaceFullPath?: string;
  replacePrefixMatch?: string;
}

export interface HTTPRequestRedirectFilter {
  scheme?: 'http' | 'https';
  hostname?: string;
  path?: HTTPPathModifier;
  port?: number;
  statusCode?: 301 | 302 | 303 | 307 | 308;
}

export interface HTTPURLRewriteFilter {
  hostname?: string;
  path?: HTTPPathModifier;
}

export interface HTTPRequestMirrorFilter {
  backendRef: BackendObjectReference;
  percent?: number;
  fraction?: { numerator: number; denominator?: number };
}

export interface HTTPCORSFilter {
  allowOrigins?: string[];
  allowCredentials?: boolean;
  allowMethods?: string[];
  allowHeaders?: string[];
  exposeHeaders?: string[];
  maxAge?: number;
}

export interface HTTPExternalAuthFilter {
  protocol: 'HTTP' | 'GRPC';
  backendRef: BackendObjectReference;
  grpc?: { allowedHeaders?: string[] };
  http?: { path?: string; allowedHeaders?: string[]; allowedResponseHeaders?: string[] };
  forwardBody?: { maxSize?: number };
}

export type HTTPRouteFilterType =
  | 'RequestHeaderModifier'
  | 'ResponseHeaderModifier'
  | 'RequestMirror'
  | 'RequestRedirect'
  | 'URLRewrite'
  | 'CORS'
  | 'ExternalAuth'
  | 'ExtensionRef';

export interface HTTPRouteFilter {
  type: HTTPRouteFilterType;
  requestHeaderModifier?: HTTPHeaderFilter;
  responseHeaderModifier?: HTTPHeaderFilter;
  requestMirror?: HTTPRequestMirrorFilter;
  requestRedirect?: HTTPRequestRedirectFilter;
  urlRewrite?: HTTPURLRewriteFilter;
  cors?: HTTPCORSFilter;
  externalAuth?: HTTPExternalAuthFilter;
  extensionRef?: LocalObjectReference;
}

export interface HTTPBackendRef extends BackendRef {
  filters?: HTTPRouteFilter[];
}

export interface HTTPRouteTimeouts {
  request?: string;
  backendRequest?: string;
}

export interface HTTPRouteRetry {
  codes?: number[];
  attempts?: number;
  backoff?: string;
}

export interface HTTPRouteRule {
  name?: string;
  matches?: HTTPRouteMatch[];
  filters?: HTTPRouteFilter[];
  backendRefs?: HTTPBackendRef[];
  timeouts?: HTTPRouteTimeouts;
  retry?: HTTPRouteRetry;
  sessionPersistence?: SessionPersistence;
}

export interface HTTPRouteSpec extends CommonRouteSpec {
  hostnames?: string[];
  rules?: HTTPRouteRule[];
}

export interface KubeHTTPRoute extends KubeObjectInterface {
  spec: HTTPRouteSpec;
  status?: RouteStatus;
}

// ---------------------------------------------------------------------------------------------
// GRPCRoute
// ---------------------------------------------------------------------------------------------

export interface GRPCMethodMatch {
  type?: StringMatchType;
  service?: string;
  method?: string;
}

export interface GRPCRouteMatch {
  method?: GRPCMethodMatch;
  headers?: HTTPHeaderMatch[];
}

export type GRPCRouteFilterType =
  | 'RequestHeaderModifier'
  | 'ResponseHeaderModifier'
  | 'RequestMirror'
  | 'ExtensionRef';

export interface GRPCRouteFilter {
  type: GRPCRouteFilterType;
  requestHeaderModifier?: HTTPHeaderFilter;
  responseHeaderModifier?: HTTPHeaderFilter;
  requestMirror?: HTTPRequestMirrorFilter;
  extensionRef?: LocalObjectReference;
}

export interface GRPCBackendRef extends BackendRef {
  filters?: GRPCRouteFilter[];
}

export interface GRPCRouteRule {
  name?: string;
  matches?: GRPCRouteMatch[];
  filters?: GRPCRouteFilter[];
  backendRefs?: GRPCBackendRef[];
  sessionPersistence?: SessionPersistence;
}

export interface GRPCRouteSpec extends CommonRouteSpec {
  hostnames?: string[];
  rules?: GRPCRouteRule[];
}

export interface KubeGRPCRoute extends KubeObjectInterface {
  spec: GRPCRouteSpec;
  status?: RouteStatus;
}

// ---------------------------------------------------------------------------------------------
// TLSRoute, TCPRoute, UDPRoute
// ---------------------------------------------------------------------------------------------

export interface L4RouteRule {
  name?: string;
  backendRefs?: BackendRef[];
}

export interface L4RouteSpec extends CommonRouteSpec {
  rules?: L4RouteRule[];
}

export interface TLSRouteSpec extends L4RouteSpec {
  hostnames?: string[];
}

export interface KubeTLSRoute extends KubeObjectInterface {
  spec: TLSRouteSpec;
  status?: RouteStatus;
}

export interface KubeTCPRoute extends KubeObjectInterface {
  spec: L4RouteSpec;
  status?: RouteStatus;
}

export interface KubeUDPRoute extends KubeObjectInterface {
  spec: L4RouteSpec;
  status?: RouteStatus;
}

/** Any route kind. */
export type KubeRoute = KubeHTTPRoute | KubeGRPCRoute | KubeTLSRoute | KubeTCPRoute | KubeUDPRoute;

// ---------------------------------------------------------------------------------------------
// ReferenceGrant
// ---------------------------------------------------------------------------------------------

export interface ReferenceGrantFrom {
  group: string;
  kind: string;
  namespace: string;
}

export interface ReferenceGrantTo {
  group: string;
  kind: string;
  name?: string;
}

export interface ReferenceGrantSpec {
  from: ReferenceGrantFrom[];
  to: ReferenceGrantTo[];
}

export interface KubeReferenceGrant extends KubeObjectInterface {
  spec: ReferenceGrantSpec;
}

// ---------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------

export interface PolicyAncestorStatus {
  ancestorRef: ParentReference;
  controllerName: string;
  conditions?: Condition[];
}

export interface PolicyStatus {
  ancestors?: PolicyAncestorStatus[];
}

export interface LocalPolicyTargetReference extends LocalObjectReference {
  sectionName?: string;
}

export interface SubjectAltName {
  type: 'Hostname' | 'URI';
  hostname?: string;
  uri?: string;
}

export interface BackendTLSPolicyValidation {
  caCertificateRefs?: LocalObjectReference[];
  wellKnownCACertificates?: 'System' | string;
  hostname: string;
  subjectAltNames?: SubjectAltName[];
}

export interface BackendTLSPolicySpec {
  targetRefs: LocalPolicyTargetReference[];
  validation: BackendTLSPolicyValidation;
  options?: Record<string, string>;
}

export interface KubeBackendTLSPolicy extends KubeObjectInterface {
  spec: BackendTLSPolicySpec;
  status?: PolicyStatus;
}

// ---------------------------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------------------------

export interface DraftMetadata {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  resourceVersion?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  [key: string]: unknown;
}

/**
 * A resource as edited by the forms and the YAML editor. Unlike the `Kube*` interfaces nothing is
 * guaranteed to be present or well-formed: the YAML editor can produce any shape, and the forms
 * must render (and report) it rather than crash.
 */
export interface KubeJson {
  apiVersion?: string;
  kind?: string;
  metadata?: DraftMetadata;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}
