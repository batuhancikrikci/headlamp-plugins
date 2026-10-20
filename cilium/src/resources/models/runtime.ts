/**
 * Runtime state written by the Cilium agent and operator: endpoints, endpoint slices, identities
 * and nodes. These kinds are read-only in the plugin.
 */
import { CiliumObjectInterface, Health, Labels, LabelSelector } from '../types';

export interface AddressPair {
  ipv4?: string;
  ipv6?: string;
}

export interface EndpointNetworking {
  addressing?: AddressPair[];
  node?: string;
}

export interface NamedPort {
  name?: string;
  port?: number;
  protocol?: string;
}

export interface EndpointPolicyDirection {
  enforcing?: boolean;
  state?: string;
  allowed?: unknown[];
  denied?: unknown[];
}

export interface EndpointStatus {
  id?: number;
  state?: string;
  identity?: { id?: number; labels?: string[] };
  networking?: EndpointNetworking;
  policy?: { ingress?: EndpointPolicyDirection; egress?: EndpointPolicyDirection };
  encryption?: { mesh?: number };
  health?: { bpf?: string; policy?: string; connected?: boolean; overallHealth?: string };
  'named-ports'?: NamedPort[];
  'external-identifiers'?: Record<string, string>;
  log?: Array<{ code?: string; message?: string; state?: string; timestamp?: string }>;
  'visibility-policy-status'?: string;
}

export interface EndpointInterface extends CiliumObjectInterface {
  status?: EndpointStatus;
}

export function addressList(networking?: EndpointNetworking): string[] {
  const out: string[] = [];
  for (const pair of networking?.addressing || []) {
    if (pair.ipv4) out.push(pair.ipv4);
    if (pair.ipv6) out.push(pair.ipv6);
  }
  return out;
}

export function endpointStateHealth(state?: string): Health {
  switch (state) {
    case 'ready':
      return 'success';
    case 'waiting-for-identity':
    case 'waiting-to-regenerate':
    case 'regenerating':
    case 'restoring':
    case 'creating':
      return 'warning';
    case 'not-ready':
    case 'invalid':
    case 'disconnected':
    case 'disconnecting':
      return 'error';
    default:
      return 'unknown';
  }
}

export interface CoreEndpoint {
  name?: string;
  id?: number;
  networking?: EndpointNetworking;
  encryption?: { mesh?: number };
  'named-ports'?: NamedPort[];
}

export interface EndpointSliceInterface extends CiliumObjectInterface {
  namespace?: string;
  endpoints?: CoreEndpoint[];
}

export interface IdentityInterface extends CiliumObjectInterface {
  'security-labels'?: Labels;
}

/** Label source prefixes used in security labels ("k8s:app=foo"). */
const SOURCE_RE = /^(k8s|reserved|any|unspec|cidr|fqdn|node):/;

export function stripLabelSource(key: string): string {
  return key.replace(SOURCE_RE, '');
}

/** Label Cilium derives from the namespace of a pod. */
export const POD_NAMESPACE_LABEL = 'io.kubernetes.pod.namespace';

export interface NodeAddress {
  type?: string;
  ip?: string;
}

export interface NodeIPAMPoolAllocation {
  pool?: string;
  cidrs?: string[];
}

export interface CiliumNodeInterface extends CiliumObjectInterface {
  spec?: {
    addresses?: NodeAddress[];
    ipam?: {
      podCIDRs?: string[];
      pool?: Record<string, unknown>;
      pools?: {
        requested?: Array<{ pool?: string; needed?: Record<string, number> }>;
        allocated?: NodeIPAMPoolAllocation[];
      };
      'min-allocate'?: number;
      'max-allocate'?: number;
      'pre-allocate'?: number;
    };
    encryption?: { key?: number };
    health?: AddressPair;
    ingress?: AddressPair;
    'instance-id'?: string;
    nodeidentity?: number;
    bootid?: string;
  };
  status?: {
    ipam?: {
      used?: Record<string, { owner?: string; resource?: string }>;
      'operator-status'?: { error?: string };
    };
  };
}

export interface NodeConfigInterface extends CiliumObjectInterface {
  spec?: {
    nodeSelector?: LabelSelector;
    defaults?: Record<string, string>;
  };
}
