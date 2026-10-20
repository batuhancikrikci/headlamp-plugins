/**
 * Load balancing, IPAM, egress and Envoy resources.
 */
import { CiliumObjectInterface, Condition, Health, LabelSelector, Protocol } from '../types';

export interface LBIPBlock {
  cidr?: string;
  start?: string;
  stop?: string;
}

export interface LBIPPoolInterface extends CiliumObjectInterface {
  spec?: {
    blocks?: LBIPBlock[];
    serviceSelector?: LabelSelector;
    allowFirstLastIPs?: 'Yes' | 'No';
    disabled?: boolean;
  };
  status?: { conditions?: Condition[] };
}

export function blockLabel(block: LBIPBlock): string {
  if (block.cidr) return block.cidr;
  if (block.start) return block.stop ? `${block.start} – ${block.stop}` : block.start;
  return '-';
}

export interface PoolUsage {
  total?: number;
  available?: number;
  used?: number;
  conflict: boolean;
  conflictMessage?: string;
}

function conditionNumber(conditions: Condition[], type: string): number | undefined {
  const raw = conditions.find(c => c.type === type)?.message;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** LB IPAM publishes its counters as condition messages (cilium.io/IPsTotal, ...). */
export function poolUsage(conditions: Condition[]): PoolUsage {
  const conflict = conditions.find(c => c.type === 'cilium.io/PoolConflict');
  return {
    total: conditionNumber(conditions, 'cilium.io/IPsTotal'),
    available: conditionNumber(conditions, 'cilium.io/IPsAvailable'),
    used: conditionNumber(conditions, 'cilium.io/IPsUsed'),
    conflict: conflict?.status === 'True',
    conflictMessage: conflict?.status === 'True' ? conflict.message : undefined,
  };
}

export function poolHealth(usage: PoolUsage, disabled?: boolean): Health {
  if (usage.conflict) return 'error';
  if (disabled) return 'warning';
  if (usage.available === 0 && usage.total !== undefined) return 'warning';
  if (usage.total === undefined) return 'unknown';
  return 'success';
}

export interface L2AnnouncementPolicyInterface extends CiliumObjectInterface {
  spec?: {
    nodeSelector?: LabelSelector;
    serviceSelector?: LabelSelector;
    loadBalancerIPs?: boolean;
    externalIPs?: boolean;
    interfaces?: string[];
  };
  status?: { conditions?: Condition[] };
}

export interface PodIPPoolFamily {
  cidrs?: string[];
  maskSize?: number;
}

export interface PodIPPoolInterface extends CiliumObjectInterface {
  spec?: {
    ipv4?: PodIPPoolFamily;
    ipv6?: PodIPPoolFamily;
    podSelector?: LabelSelector;
    namespaceSelector?: LabelSelector;
  };
}

export interface EgressRuleSelector {
  podSelector?: LabelSelector;
  namespaceSelector?: LabelSelector;
  nodeSelector?: LabelSelector;
}

export interface EgressGateway {
  nodeSelector?: LabelSelector;
  interface?: string;
  egressIP?: string;
}

export interface EgressGatewayPolicyInterface extends CiliumObjectInterface {
  spec?: {
    selectors?: EgressRuleSelector[];
    destinationCIDRs?: string[];
    excludedCIDRs?: string[];
    egressGateway?: EgressGateway;
    egressGateways?: EgressGateway[];
  };
}

/** All gateways of an egress policy: the single `egressGateway` and the newer list form. */
export function egressGateways(spec?: EgressGatewayPolicyInterface['spec']): EgressGateway[] {
  return [...(spec?.egressGateway ? [spec.egressGateway] : []), ...(spec?.egressGateways || [])];
}

export interface RedirectPort {
  port?: string;
  protocol?: Protocol;
  name?: string;
}

export interface LocalRedirectPolicyInterface extends CiliumObjectInterface {
  spec?: {
    description?: string;
    redirectFrontend?: {
      addressMatcher?: { ip?: string; toPorts?: RedirectPort[] };
      serviceMatcher?: { serviceName?: string; namespace?: string; toPorts?: RedirectPort[] };
    };
    redirectBackend?: {
      localEndpointSelector?: LabelSelector;
      toPorts?: RedirectPort[];
    };
    skipRedirectFromBackend?: boolean;
  };
  status?: { ok?: boolean; conditions?: Condition[] };
}

export function redirectPortLabel(port: RedirectPort): string {
  const base = `${port.port || '?'}/${port.protocol || 'TCP'}`;
  return port.name ? `${port.name}:${base}` : base;
}

export interface EnvoyServiceRef {
  name: string;
  namespace?: string;
  listener?: string;
  ports?: number[];
}

export interface EnvoyBackendServiceRef {
  name: string;
  namespace?: string;
  number?: string[];
}

export interface EnvoyResource {
  '@type'?: string;
  name?: string;
  [key: string]: unknown;
}

export interface EnvoyConfigInterface extends CiliumObjectInterface {
  spec?: {
    services?: EnvoyServiceRef[];
    backendServices?: EnvoyBackendServiceRef[];
    resources?: EnvoyResource[];
    nodeSelector?: LabelSelector;
  };
}

/** "type.googleapis.com/envoy.config.listener.v3.Listener" -> "Listener". */
export function envoyResourceKind(resource: EnvoyResource): string {
  const type = resource['@type'] || '';
  return type.split('.').pop() || type || 'Unknown';
}

export function envoyResourceKinds(resources: EnvoyResource[] = []): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const resource of resources) {
    const kind = envoyResourceKind(resource);
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}
