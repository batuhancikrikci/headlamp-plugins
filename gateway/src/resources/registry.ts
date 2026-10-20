/**
 * Static description of every Gateway API kind the plugin knows about: where it lives in the API,
 * how it is labelled and grouped in the UI, and which routes serve it.
 *
 * This module is plain data (no Headlamp imports), so the logic built on it can be unit tested.
 * The Headlamp resource classes derived from it live in `classes.ts`.
 */
import { GATEWAY_GROUP } from './types';

export const SIDEBAR_ROOT = 'gateway-api';
export const URL_PREFIX = '/gateway-api';
/** Icon of Headlamp's built-in "Gateway (beta)" sidebar entry (v0.45.0). */
export const GATEWAY_API_ICON = 'mdi:lan-connect';
/** Name of Headlamp's built-in Gateway API sidebar entry, hidden by this plugin. */
export const BUILTIN_SIDEBAR_NAME = 'gatewayapi';

export type KindName =
  | 'GatewayClass'
  | 'Gateway'
  | 'ListenerSet'
  | 'HTTPRoute'
  | 'GRPCRoute'
  | 'TLSRoute'
  | 'TCPRoute'
  | 'UDPRoute'
  | 'ReferenceGrant'
  | 'BackendTLSPolicy';

export type KindCategory = 'infrastructure' | 'routes' | 'policies';

/** Where the health of an object is reported. */
export type StatusModel = 'conditions' | 'parents' | 'ancestors' | 'none';

export interface KindInfo {
  kind: KindName;
  group: string;
  /** Resource plural as served by the API server. */
  plural: string;
  label: string;
  labelPlural: string;
  namespaced: boolean;
  category: KindCategory;
  statusModel: StatusModel;
  isRoute: boolean;
  icon: string;
  description: string;
  /** Versions known for the kind, most preferred first; the default until discovery has run. */
  knownVersions: string[];
  /** Paths of Headlamp's built-in pages that differ from this plugin's, kept as aliases. */
  aliasListPaths?: string[];
  aliasDetailPaths?: string[];
}

/** All supported kinds, in sidebar order. */
export const KINDS: KindInfo[] = [
  {
    kind: 'GatewayClass',
    group: GATEWAY_GROUP,
    plural: 'gatewayclasses',
    label: 'Gateway Class',
    labelPlural: 'Gateway Classes',
    namespaced: false,
    category: 'infrastructure',
    statusModel: 'conditions',
    isRoute: false,
    icon: 'mdi:layers-triple-outline',
    description: 'Cluster-scoped template of Gateways handled by one controller.',
    knownVersions: ['v1', 'v1beta1'],
  },
  {
    kind: 'Gateway',
    group: GATEWAY_GROUP,
    plural: 'gateways',
    label: 'Gateway',
    labelPlural: 'Gateways',
    namespaced: true,
    category: 'infrastructure',
    statusModel: 'conditions',
    isRoute: false,
    icon: 'mdi:gate',
    description: 'Traffic entry point: binds listeners (port, protocol, hostname) to addresses.',
    knownVersions: ['v1', 'v1beta1'],
  },
  {
    kind: 'ListenerSet',
    group: GATEWAY_GROUP,
    plural: 'listenersets',
    label: 'Listener Set',
    labelPlural: 'Listener Sets',
    namespaced: true,
    category: 'infrastructure',
    statusModel: 'conditions',
    isRoute: false,
    icon: 'mdi:playlist-plus',
    description: 'Additional listeners attached to a Gateway, managed in their own namespace.',
    knownVersions: ['v1'],
  },
  {
    kind: 'HTTPRoute',
    group: GATEWAY_GROUP,
    plural: 'httproutes',
    label: 'HTTP Route',
    labelPlural: 'HTTP Routes',
    namespaced: true,
    category: 'routes',
    statusModel: 'parents',
    isRoute: true,
    icon: 'mdi:routes',
    description: 'Routes HTTP and HTTPS requests by hostname, path, header, query or method.',
    knownVersions: ['v1', 'v1beta1'],
  },
  {
    kind: 'GRPCRoute',
    group: GATEWAY_GROUP,
    plural: 'grpcroutes',
    label: 'GRPC Route',
    labelPlural: 'GRPC Routes',
    namespaced: true,
    category: 'routes',
    statusModel: 'parents',
    isRoute: true,
    icon: 'mdi:swap-horizontal-bold',
    description: 'Routes gRPC calls by hostname, service, method or header.',
    knownVersions: ['v1', 'v1alpha2'],
  },
  {
    kind: 'TLSRoute',
    group: GATEWAY_GROUP,
    plural: 'tlsroutes',
    label: 'TLS Route',
    labelPlural: 'TLS Routes',
    namespaced: true,
    category: 'routes',
    statusModel: 'parents',
    isRoute: true,
    icon: 'mdi:lock-outline',
    description: 'Routes TLS connections by SNI hostname, usually without terminating TLS.',
    knownVersions: ['v1', 'v1alpha3', 'v1alpha2'],
  },
  {
    kind: 'TCPRoute',
    group: GATEWAY_GROUP,
    plural: 'tcproutes',
    label: 'TCP Route',
    labelPlural: 'TCP Routes',
    namespaced: true,
    category: 'routes',
    statusModel: 'parents',
    isRoute: true,
    icon: 'mdi:transit-connection-variant',
    description: 'Forwards TCP connections arriving on a listener to backends.',
    knownVersions: ['v1', 'v1alpha2'],
  },
  {
    kind: 'UDPRoute',
    group: GATEWAY_GROUP,
    plural: 'udproutes',
    label: 'UDP Route',
    labelPlural: 'UDP Routes',
    namespaced: true,
    category: 'routes',
    statusModel: 'parents',
    isRoute: true,
    icon: 'mdi:transit-connection-horizontal',
    description: 'Forwards UDP datagrams arriving on a listener to backends.',
    knownVersions: ['v1', 'v1alpha2'],
  },
  {
    kind: 'ReferenceGrant',
    group: GATEWAY_GROUP,
    plural: 'referencegrants',
    label: 'Reference Grant',
    labelPlural: 'Reference Grants',
    namespaced: true,
    category: 'policies',
    statusModel: 'none',
    isRoute: false,
    icon: 'mdi:handshake-outline',
    description: 'Lets resources in other namespaces reference objects in this namespace.',
    knownVersions: ['v1', 'v1beta1', 'v1alpha2'],
    aliasDetailPaths: ['/referencegrant/:namespace/:name'],
  },
  {
    kind: 'BackendTLSPolicy',
    group: GATEWAY_GROUP,
    plural: 'backendtlspolicies',
    label: 'Backend TLS Policy',
    labelPlural: 'Backend TLS Policies',
    namespaced: true,
    category: 'policies',
    statusModel: 'ancestors',
    isRoute: false,
    icon: 'mdi:shield-lock-outline',
    description: 'Tells Gateways how to connect to a backend over TLS and what to verify.',
    knownVersions: ['v1', 'v1alpha3'],
    aliasDetailPaths: ['/backendtlspolicy/:namespace/:name'],
  },
];

/** When (and where) each kind became available, shown when a kind is missing on a cluster. */
export const KIND_AVAILABILITY_NOTES: Record<KindName, string> = {
  GatewayClass: 'Part of every Gateway API release.',
  Gateway: 'Part of every Gateway API release.',
  HTTPRoute: 'Part of every Gateway API release.',
  GRPCRoute: 'Standard channel since Gateway API v1.1.',
  ReferenceGrant: 'Standard channel since Gateway API v0.6 (served as v1 since v1.5).',
  BackendTLSPolicy: 'Standard channel since Gateway API v1.4; experimental before.',
  ListenerSet: 'Standard channel since Gateway API v1.5.',
  TLSRoute: 'Standard channel since Gateway API v1.5; experimental before.',
  TCPRoute: 'Standard channel since Gateway API v1.6; experimental before.',
  UDPRoute: 'Standard channel since Gateway API v1.6; experimental before.',
};

export const CATEGORY_LABELS: Record<KindCategory, string> = {
  infrastructure: 'Infrastructure',
  routes: 'Routes',
  policies: 'Policies',
};

export const CATEGORY_ORDER: KindCategory[] = ['infrastructure', 'routes', 'policies'];

export const ROUTE_KINDS: KindName[] = KINDS.filter(k => k.isRoute).map(k => k.kind);

const BY_KIND = new Map<string, KindInfo>(KINDS.map(k => [k.kind, k]));

export function kindInfo(kind: KindName): KindInfo {
  return BY_KIND.get(kind)!;
}

/** Looks a kind up by name and (optionally) API group; unknown kinds yield undefined. */
export function findKind(kind?: string, group?: string): KindInfo | undefined {
  if (!kind) return undefined;
  const info = BY_KIND.get(kind);
  if (!info) return undefined;
  if (group !== undefined && group !== info.group) return undefined;
  return info;
}

export function kindsInCategory(category: KindCategory): KindInfo[] {
  return KINDS.filter(k => k.category === category);
}

export function sidebarName(info: KindInfo): string {
  return `gwapi-${info.plural}`;
}

export function listPath(info: KindInfo): string {
  return `/${info.plural}`;
}

export function detailPath(info: KindInfo): string {
  return info.namespaced ? `/${info.plural}/:namespace/:name` : `/${info.plural}/:name`;
}

/** Default apiVersion (`group/version`) of a kind, before or without discovery. */
export function defaultApiVersion(info: KindInfo): string {
  return `${info.group}/${info.knownVersions[0]}`;
}
