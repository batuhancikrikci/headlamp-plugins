import { CiliumClass } from './base';
import {
  CiliumBGPAdvertisement,
  CiliumBGPClusterConfig,
  CiliumBGPNodeConfig,
  CiliumBGPNodeConfigOverride,
  CiliumBGPPeerConfig,
  CiliumBGPPeeringPolicy,
} from './bgp';
import {
  CiliumClusterwideEnvoyConfig,
  CiliumEgressGatewayPolicy,
  CiliumEnvoyConfig,
  CiliumL2AnnouncementPolicy,
  CiliumLoadBalancerIPPool,
  CiliumLocalRedirectPolicy,
  CiliumPodIPPool,
} from './network';
import {
  CiliumCIDRGroup,
  CiliumClusterwideNetworkPolicy,
  CiliumNetworkPolicy,
} from './networkPolicy';
import {
  CiliumEndpoint,
  CiliumEndpointSlice,
  CiliumIdentity,
  CiliumNode,
  CiliumNodeConfig,
} from './runtime';
import { API_GROUP } from './types';

export const URL_PREFIX = '/cilium';
export const SIDEBAR_ROOT = 'cilium';

export type GroupId = 'policies' | 'endpoints' | 'nodes' | 'bgp' | 'lb' | 'egress' | 'envoy';

export interface GroupInfo {
  id: GroupId;
  /** URL segment below /cilium. */
  slug: string;
  label: string;
  icon: string;
  description: string;
}

/** Sidebar groups, in display order. */
export const GROUPS: GroupInfo[] = [
  {
    id: 'policies',
    slug: 'policies',
    label: 'Network Policies',
    icon: 'mdi:shield-lock-outline',
    description: 'L3/L4/L7 network policies and the CIDR groups they reference.',
  },
  {
    id: 'endpoints',
    slug: 'endpoints',
    label: 'Endpoints & Identities',
    icon: 'mdi:lan-connect',
    description: 'Runtime state of Cilium-managed pods and their security identities.',
  },
  {
    id: 'nodes',
    slug: 'nodes',
    label: 'Nodes',
    icon: 'mdi:server-network',
    description: 'Per-node datapath state and per-node configuration overrides.',
  },
  {
    id: 'bgp',
    slug: 'bgp',
    label: 'BGP',
    icon: 'mdi:router-network',
    description: 'BGP control plane: cluster configuration, peers and advertisements.',
  },
  {
    id: 'lb',
    slug: 'load-balancing',
    label: 'Load Balancing & IPAM',
    icon: 'mdi:ip-network-outline',
    description: 'LoadBalancer IP pools, L2 announcements and pod IP pools.',
  },
  {
    id: 'egress',
    slug: 'egress',
    label: 'Egress',
    icon: 'mdi:exit-to-app',
    description: 'Egress gateways and node-local traffic redirection.',
  },
  {
    id: 'envoy',
    slug: 'envoy',
    label: 'Service Mesh / Envoy',
    icon: 'mdi:hexagon-multiple-outline',
    description: 'Envoy listeners, routes and clusters programmed through Cilium.',
  },
];

export interface CRDInfo {
  kind: string;
  /** Resource plural as served by the API server. */
  plural: string;
  /** Singular label for buttons and titles. */
  label: string;
  /** Plural label for list titles and tabs. */
  labelPlural: string;
  /** Short tab label inside the group page. */
  tabLabel: string;
  cls: CiliumClass;
  namespaced: boolean;
  group: GroupId;
  icon: string;
  /** Short description shown on the overview and the empty states. */
  description: string;
  /** Runtime state managed by Cilium itself: no create or form editing. */
  readOnly: boolean;
  /** Deprecated upstream regardless of what the CRD object reports. */
  deprecated?: boolean;
  deprecationNote?: string;
  /** Version assumed until discovery has run. */
  defaultVersion: string;
}

interface CRDSeed extends Omit<CRDInfo, 'plural' | 'namespaced' | 'cls' | 'readOnly'> {
  // The resource classes narrow the generic parameter of CiliumObject, which makes their
  // constructors incompatible with the generic static side; the registry only uses statics and
  // narrows the class to CiliumClass where it reads the seed.
  cls: unknown;
  readOnly?: boolean;
}

const V2 = `${API_GROUP}/v2`;
const V2ALPHA1 = `${API_GROUP}/v2alpha1`;

const SEEDS: CRDSeed[] = [
  {
    kind: 'CiliumNetworkPolicy',
    label: 'Network Policy',
    labelPlural: 'Cilium Network Policies',
    tabLabel: 'Network Policies',
    cls: CiliumNetworkPolicy,
    group: 'policies',
    icon: 'mdi:shield-lock-outline',
    description: 'Namespaced L3–L7 policy for the endpoints of one namespace.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumClusterwideNetworkPolicy',
    label: 'Clusterwide Network Policy',
    labelPlural: 'Cilium Clusterwide Network Policies',
    tabLabel: 'Clusterwide Policies',
    cls: CiliumClusterwideNetworkPolicy,
    group: 'policies',
    icon: 'mdi:shield-star-outline',
    description: 'Cluster-scoped policy for endpoints in any namespace, or for the nodes.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumCIDRGroup',
    label: 'CIDR Group',
    labelPlural: 'Cilium CIDR Groups',
    tabLabel: 'CIDR Groups',
    cls: CiliumCIDRGroup,
    group: 'policies',
    icon: 'mdi:format-list-group',
    description: 'Named list of external CIDRs that policies can reference.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumEndpoint',
    label: 'Endpoint',
    labelPlural: 'Cilium Endpoints',
    tabLabel: 'Endpoints',
    cls: CiliumEndpoint,
    group: 'endpoints',
    icon: 'mdi:lan-connect',
    description: 'Datapath state of one Cilium-managed pod.',
    readOnly: true,
    defaultVersion: V2,
  },
  {
    kind: 'CiliumEndpointSlice',
    label: 'Endpoint Slice',
    labelPlural: 'Cilium Endpoint Slices',
    tabLabel: 'Endpoint Slices',
    cls: CiliumEndpointSlice,
    group: 'endpoints',
    icon: 'mdi:view-grid-outline',
    description: 'Batches of endpoints, used instead of CiliumEndpoint watches on large clusters.',
    readOnly: true,
    defaultVersion: V2ALPHA1,
  },
  {
    kind: 'CiliumIdentity',
    label: 'Identity',
    labelPlural: 'Cilium Identities',
    tabLabel: 'Identities',
    cls: CiliumIdentity,
    group: 'endpoints',
    icon: 'mdi:card-account-details-outline',
    description: 'Security identity: a number allocated for a unique set of labels.',
    readOnly: true,
    defaultVersion: V2,
  },
  {
    kind: 'CiliumNode',
    label: 'Cilium Node',
    labelPlural: 'Cilium Nodes',
    tabLabel: 'Cilium Nodes',
    cls: CiliumNode,
    group: 'nodes',
    icon: 'mdi:server-network',
    description: 'Addresses, pod CIDRs and IPAM state of a node as seen by Cilium.',
    readOnly: true,
    defaultVersion: V2,
  },
  {
    kind: 'CiliumNodeConfig',
    label: 'Node Config',
    labelPlural: 'Cilium Node Configs',
    tabLabel: 'Node Configs',
    cls: CiliumNodeConfig,
    group: 'nodes',
    icon: 'mdi:server-plus',
    description: 'Overrides cilium-config keys for a selected set of nodes.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPClusterConfig',
    label: 'BGP Cluster Config',
    labelPlural: 'BGP Cluster Configs',
    tabLabel: 'Cluster Configs',
    cls: CiliumBGPClusterConfig,
    group: 'bgp',
    icon: 'mdi:router-network',
    description: 'BGP instances and their peers for a selected set of nodes.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPPeerConfig',
    label: 'BGP Peer Config',
    labelPlural: 'BGP Peer Configs',
    tabLabel: 'Peer Configs',
    cls: CiliumBGPPeerConfig,
    group: 'bgp',
    icon: 'mdi:handshake-outline',
    description: 'Reusable peering settings: timers, authentication, address families.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPAdvertisement',
    label: 'BGP Advertisement',
    labelPlural: 'BGP Advertisements',
    tabLabel: 'Advertisements',
    cls: CiliumBGPAdvertisement,
    group: 'bgp',
    icon: 'mdi:bullhorn-outline',
    description: 'Which prefixes (pod CIDRs, services, pools) are advertised to peers.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPNodeConfig',
    label: 'BGP Node Config',
    labelPlural: 'BGP Node Configs',
    tabLabel: 'Node Configs',
    cls: CiliumBGPNodeConfig,
    group: 'bgp',
    icon: 'mdi:server-network-outline',
    description: 'Per-node BGP configuration and session state, generated by the operator.',
    readOnly: true,
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPNodeConfigOverride',
    label: 'BGP Node Config Override',
    labelPlural: 'BGP Node Config Overrides',
    tabLabel: 'Node Overrides',
    cls: CiliumBGPNodeConfigOverride,
    group: 'bgp',
    icon: 'mdi:server-plus-outline',
    description: 'Per-node overrides such as router ID and local addresses.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumBGPPeeringPolicy',
    label: 'BGP Peering Policy',
    labelPlural: 'BGP Peering Policies',
    tabLabel: 'Peering Policies',
    cls: CiliumBGPPeeringPolicy,
    group: 'bgp',
    icon: 'mdi:router-wireless-off',
    description: 'Legacy BGP configuration.',
    deprecated: true,
    deprecationNote:
      'CiliumBGPPeeringPolicy is the legacy BGP API. Migrate to CiliumBGPClusterConfig, CiliumBGPPeerConfig and CiliumBGPAdvertisement.',
    defaultVersion: V2ALPHA1,
  },
  {
    kind: 'CiliumLoadBalancerIPPool',
    label: 'LoadBalancer IP Pool',
    labelPlural: 'LoadBalancer IP Pools',
    tabLabel: 'LB IP Pools',
    cls: CiliumLoadBalancerIPPool,
    group: 'lb',
    icon: 'mdi:ip-network-outline',
    description: 'Address pools that LB IPAM assigns to LoadBalancer services.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumL2AnnouncementPolicy',
    label: 'L2 Announcement Policy',
    labelPlural: 'L2 Announcement Policies',
    tabLabel: 'L2 Announcements',
    cls: CiliumL2AnnouncementPolicy,
    group: 'lb',
    icon: 'mdi:access-point-network',
    description: 'Which nodes answer ARP/NDP for which service IPs on the local network.',
    defaultVersion: V2ALPHA1,
  },
  {
    kind: 'CiliumPodIPPool',
    label: 'Pod IP Pool',
    labelPlural: 'Pod IP Pools',
    tabLabel: 'Pod IP Pools',
    cls: CiliumPodIPPool,
    group: 'lb',
    icon: 'mdi:cube-scan',
    description: 'Pod address pools for multi-pool IPAM.',
    defaultVersion: V2ALPHA1,
  },
  {
    kind: 'CiliumEgressGatewayPolicy',
    label: 'Egress Gateway Policy',
    labelPlural: 'Egress Gateway Policies',
    tabLabel: 'Egress Gateways',
    cls: CiliumEgressGatewayPolicy,
    group: 'egress',
    icon: 'mdi:exit-to-app',
    description: 'Routes selected pod traffic through gateway nodes with a stable source IP.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumLocalRedirectPolicy',
    label: 'Local Redirect Policy',
    labelPlural: 'Local Redirect Policies',
    tabLabel: 'Local Redirects',
    cls: CiliumLocalRedirectPolicy,
    group: 'egress',
    icon: 'mdi:call-split',
    description: 'Redirects traffic for an address or service to a pod on the same node.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumEnvoyConfig',
    label: 'Envoy Config',
    labelPlural: 'Cilium Envoy Configs',
    tabLabel: 'Envoy Configs',
    cls: CiliumEnvoyConfig,
    group: 'envoy',
    icon: 'mdi:hexagon-multiple-outline',
    description: 'Namespaced Envoy resources attached to services.',
    defaultVersion: V2,
  },
  {
    kind: 'CiliumClusterwideEnvoyConfig',
    label: 'Clusterwide Envoy Config',
    labelPlural: 'Cilium Clusterwide Envoy Configs',
    tabLabel: 'Clusterwide Envoy Configs',
    cls: CiliumClusterwideEnvoyConfig,
    group: 'envoy',
    icon: 'mdi:hexagon-slice-6',
    description: 'Cluster-scoped Envoy resources attached to services in any namespace.',
    defaultVersion: V2,
  },
];

/** All supported Cilium CRDs, in tab order within their group. */
export const CRDS: CRDInfo[] = SEEDS.map(seed => {
  const cls = seed.cls as CiliumClass;
  return {
    ...seed,
    cls,
    plural: cls.apiName,
    namespaced: cls.isNamespaced,
    readOnly: !!seed.readOnly,
  };
});

const BY_KIND = new Map(CRDS.map(c => [c.kind, c]));
const BY_PLURAL = new Map(CRDS.map(c => [c.plural, c]));

export function crdByKind(kind: string): CRDInfo | undefined {
  return BY_KIND.get(kind);
}

/** Like crdByKind, for kinds that are known to be registered. */
export function crd(kind: string): CRDInfo {
  const info = BY_KIND.get(kind);
  if (!info) throw new Error(`Unknown Cilium kind: ${kind}`);
  return info;
}

export function crdByPlural(plural: string): CRDInfo | undefined {
  return BY_PLURAL.get(plural);
}

export function groupById(id: GroupId): GroupInfo {
  return GROUPS.find(g => g.id === id)!;
}

export function crdsOfGroup(id: GroupId): CRDInfo[] {
  return CRDS.filter(c => c.group === id);
}

/** Route (and sidebar entry) name of a group page. */
export function groupRouteName(id: GroupId): string {
  return `${SIDEBAR_ROOT}-${id}`;
}

export function groupPath(id: GroupId): string {
  return `${URL_PREFIX}/${groupById(id).slug}`;
}

export function listPath(info: CRDInfo): string {
  return `${groupPath(info.group)}/${info.plural}`;
}

export function detailPath(info: CRDInfo): string {
  return info.namespaced ? `${listPath(info)}/:namespace/:name` : `${listPath(info)}/:name`;
}
