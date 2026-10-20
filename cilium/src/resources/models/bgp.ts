/**
 * BGP control plane resources (CiliumBGP*). All of them are cluster-scoped.
 */
import { CiliumObjectInterface, Condition, Health, LabelSelector } from '../types';

export interface BGPClusterPeer {
  name: string;
  peerAddress?: string;
  peerASN?: number;
  peerConfigRef?: { name: string; group?: string; kind?: string };
  autoDiscovery?: Record<string, unknown>;
}

export interface BGPClusterInstance {
  name: string;
  localASN?: number;
  localPort?: number;
  peers?: BGPClusterPeer[];
}

export interface BGPClusterConfigInterface extends CiliumObjectInterface {
  spec?: {
    nodeSelector?: LabelSelector;
    bgpInstances?: BGPClusterInstance[];
  };
  status?: { conditions?: Condition[] };
}

/**
 * Conditions on BGP resources describe problems: `True` means the problem exists
 * (e.g. NoMatchingNode, MissingPeerConfigs, ConflictingClusterConfig, MissingAuthSecret).
 */
export function problemConditions(conditions: Condition[]): Condition[] {
  return conditions.filter(c => c.status === 'True');
}

export function problemHealth(conditions: Condition[]): Health {
  if (conditions.length === 0) return 'unknown';
  return problemConditions(conditions).length > 0 ? 'error' : 'success';
}

export interface BGPFamily {
  afi: string;
  safi: string;
  advertisements?: LabelSelector;
}

export interface BGPPeerConfigInterface extends CiliumObjectInterface {
  spec?: {
    transport?: { peerPort?: number; sourceInterface?: string };
    timers?: {
      connectRetryTimeSeconds?: number;
      holdTimeSeconds?: number;
      keepAliveTimeSeconds?: number;
    };
    authSecretRef?: string;
    gracefulRestart?: { enabled?: boolean; restartTimeSeconds?: number };
    ebgpMultihop?: number;
    families?: BGPFamily[];
  };
  status?: { conditions?: Condition[] };
}

export function familyLabel(family: { afi?: string; safi?: string }): string {
  return `${family.afi || '?'}/${family.safi || '?'}`;
}

export type AdvertisementType = 'PodCIDR' | 'CiliumPodIPPool' | 'Service' | 'Interface';

export type ServiceAddressType = 'ClusterIP' | 'ExternalIP' | 'LoadBalancerIP';

export const SERVICE_ADDRESS_TYPES: ServiceAddressType[] = [
  'LoadBalancerIP',
  'ClusterIP',
  'ExternalIP',
];

export interface BGPAdvertisementEntry {
  advertisementType: AdvertisementType;
  service?: {
    addresses?: ServiceAddressType[];
    aggregationLengthIPv4?: number;
    aggregationLengthIPv6?: number;
  };
  selector?: LabelSelector;
  interface?: { name?: string };
  attributes?: {
    communities?: { standard?: string[]; large?: string[]; wellKnown?: string[] };
    localPreference?: number;
  };
}

export interface BGPAdvertisementInterface extends CiliumObjectInterface {
  spec?: { advertisements?: BGPAdvertisementEntry[] };
}

export interface BGPNodePeer {
  name: string;
  peerAddress?: string;
  peerASN?: number;
  localAddress?: string;
  peerConfigRef?: { name: string };
}

export interface BGPNodeInstance {
  name: string;
  localASN?: number;
  routerID?: string;
  localPort?: number;
  peers?: BGPNodePeer[];
}

export interface BGPNodePeerStatus {
  name: string;
  peerAddress?: string;
  peerASN?: number;
  peeringState?: string;
  establishedTime?: string;
  timers?: { appliedHoldTimeSeconds?: number; appliedKeepaliveSeconds?: number };
  routeCount?: Array<{ afi: string; safi: string; received?: number; advertised?: number }>;
}

export interface BGPNodeInstanceStatus {
  name: string;
  localASN?: number;
  peers?: BGPNodePeerStatus[];
}

export interface BGPNodeConfigInterface extends CiliumObjectInterface {
  spec?: { bgpInstances?: BGPNodeInstance[] };
  status?: { bgpInstances?: BGPNodeInstanceStatus[]; conditions?: Condition[] };
}

export function isEstablished(state?: string): boolean {
  return (state || '').toLowerCase() === 'established';
}

export function peeringStateHealth(state?: string): Health {
  if (!state) return 'unknown';
  if (isEstablished(state)) return 'success';
  return ['idle', 'active', 'connect'].includes(state.toLowerCase()) ? 'error' : 'warning';
}

export interface SessionCounts {
  total: number;
  established: number;
}

export interface BGPNodeOverrideInstance {
  name: string;
  routerID?: string;
  localPort?: number;
  localASN?: number;
  peers?: Array<{ name: string; localAddress?: string; localPort?: number }>;
}

export interface BGPNodeConfigOverrideInterface extends CiliumObjectInterface {
  spec?: { bgpInstances?: BGPNodeOverrideInstance[] };
}

export interface BGPVirtualRouter {
  localASN?: number;
  exportPodCIDR?: boolean;
  neighbors?: Array<{ peerAddress?: string; peerASN?: number; peerPort?: number }>;
  serviceSelector?: LabelSelector;
  podIPPoolSelector?: LabelSelector;
}

export interface BGPPeeringPolicyInterface extends CiliumObjectInterface {
  spec?: { nodeSelector?: LabelSelector; virtualRouters?: BGPVirtualRouter[] };
}
