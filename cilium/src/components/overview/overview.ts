/**
 * Pure aggregation for the overview dashboard: coverage statistics and the "needs attention"
 * list. Inputs are plain JSON objects so the logic can be tested without a cluster.
 */
import { InstallStatus } from '../../api/ciliumInstall';
import {
  BGPClusterConfigInterface,
  BGPNodeConfigInterface,
  BGPPeerConfigInterface,
  isEstablished,
  problemConditions,
} from '../../resources/models/bgp';
import {
  EgressGatewayPolicyInterface,
  LBIPPoolInterface,
  poolUsage,
} from '../../resources/models/network';
import { NetworkPolicyInterface, policyValidity } from '../../resources/models/policy';
import { CiliumNodeInterface, EndpointInterface } from '../../resources/models/runtime';
import { NodeLike, ServiceLike } from '../../resources/types';
import { egressGatewayNodes, isLoadBalancer, loadBalancerIPs } from '../../utils/relations';

export interface EndpointStats {
  total: number;
  ready: number;
  notReady: number;
  ingressEnforced: number;
  egressEnforced: number;
  /** Endpoints with policy enforcement in at least one direction. */
  enforced: number;
  identities: number;
}

export function endpointStats(endpoints: EndpointInterface[]): EndpointStats {
  const identities = new Set<number>();
  const stats: EndpointStats = {
    total: endpoints.length,
    ready: 0,
    notReady: 0,
    ingressEnforced: 0,
    egressEnforced: 0,
    enforced: 0,
    identities: 0,
  };
  for (const endpoint of endpoints) {
    const status = endpoint.status || {};
    if (status.state === 'ready') stats.ready++;
    else stats.notReady++;
    const ingress = !!status.policy?.ingress?.enforcing;
    const egress = !!status.policy?.egress?.enforcing;
    if (ingress) stats.ingressEnforced++;
    if (egress) stats.egressEnforced++;
    if (ingress || egress) stats.enforced++;
    if (status.identity?.id !== undefined) identities.add(status.identity.id);
  }
  stats.identities = identities.size;
  return stats;
}

export interface NamespaceCoverage {
  namespace: string;
  endpoints: number;
  enforced: number;
}

/**
 * Policy coverage per namespace, measured on the endpoints themselves: an endpoint is covered
 * when Cilium enforces policy for it in at least one direction. This reflects namespaced and
 * clusterwide policies alike.
 */
export function namespaceCoverage(endpoints: EndpointInterface[]): NamespaceCoverage[] {
  const byNamespace = new Map<string, NamespaceCoverage>();
  for (const endpoint of endpoints) {
    const namespace = endpoint.metadata.namespace || '';
    const entry = byNamespace.get(namespace) || { namespace, endpoints: 0, enforced: 0 };
    entry.endpoints++;
    const policy = endpoint.status?.policy;
    if (policy?.ingress?.enforcing || policy?.egress?.enforcing) entry.enforced++;
    byNamespace.set(namespace, entry);
  }
  return Array.from(byNamespace.values()).sort((a, b) => a.namespace.localeCompare(b.namespace));
}

export interface BGPStats {
  nodes: number;
  sessions: number;
  established: number;
}

export function bgpStats(nodeConfigs: BGPNodeConfigInterface[]): BGPStats {
  const stats: BGPStats = { nodes: nodeConfigs.length, sessions: 0, established: 0 };
  for (const config of nodeConfigs) {
    for (const instance of config.spec?.bgpInstances || []) {
      stats.sessions += instance.peers?.length || 0;
    }
    for (const instance of config.status?.bgpInstances || []) {
      stats.established += (instance.peers || []).filter(p => isEstablished(p.peeringState)).length;
    }
  }
  return stats;
}

export interface PoolStats {
  pools: number;
  total: number;
  used: number;
  available: number;
  conflicts: number;
  /** LoadBalancer services still waiting for an address. */
  pendingServices: number;
}

export function poolStats(pools: LBIPPoolInterface[], services: ServiceLike[]): PoolStats {
  const stats: PoolStats = {
    pools: pools.length,
    total: 0,
    used: 0,
    available: 0,
    conflicts: 0,
    pendingServices: 0,
  };
  for (const pool of pools) {
    const usage = poolUsage(pool.status?.conditions || []);
    stats.total += usage.total || 0;
    stats.used += usage.used || 0;
    stats.available += usage.available || 0;
    if (usage.conflict) stats.conflicts++;
  }
  stats.pendingServices = services.filter(
    svc => isLoadBalancer(svc) && loadBalancerIPs(svc).length === 0
  ).length;
  return stats;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  id: string;
  severity: Severity;
  /** Kind of the affected object, used to build a link; empty for installation issues. */
  kind: string;
  /** API group of `kind` ('' for core kinds). */
  group: string;
  name: string;
  namespace?: string;
  message: string;
}

export interface IssueInput {
  install?: InstallStatus;
  policies?: NetworkPolicyInterface[];
  endpoints?: EndpointInterface[];
  ciliumNodes?: CiliumNodeInterface[];
  bgpClusterConfigs?: BGPClusterConfigInterface[];
  bgpPeerConfigs?: BGPPeerConfigInterface[];
  bgpNodeConfigs?: BGPNodeConfigInterface[];
  pools?: LBIPPoolInterface[];
  services?: ServiceLike[];
  egressPolicies?: EgressGatewayPolicyInterface[];
  nodes?: NodeLike[];
}

const CILIUM = 'cilium.io';

/** Everything that currently deserves the operator's attention, most severe first. */
export function collectIssues(input: IssueInput): Issue[] {
  const issues: Issue[] = [];

  for (const component of Object.values(input.install?.components || {})) {
    for (const pod of component.notReady) {
      issues.push({
        id: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
        severity: component.info.optional ? 'warning' : 'error',
        kind: 'Pod',
        group: '',
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        message: `${component.info.label} pod is not ready (${pod.status?.phase || 'Unknown'})`,
      });
    }
    if (component.versions.length > 1) {
      issues.push({
        id: `versions-${component.info.id}`,
        severity: 'warning',
        kind: '',
        group: '',
        name: component.info.label,
        message: `Pods run different versions: ${component.versions.join(', ')}`,
      });
    }
  }

  for (const policy of input.policies || []) {
    const validity = policyValidity(policy.status?.conditions || []);
    if (validity.health === 'error') {
      issues.push({
        id: `policy-${policy.metadata.namespace}-${policy.metadata.name}`,
        severity: 'error',
        kind: policy.kind,
        group: CILIUM,
        name: policy.metadata.name,
        namespace: policy.metadata.namespace,
        message: `Policy is invalid: ${validity.message || 'see conditions'}`,
      });
    }
  }

  for (const endpoint of input.endpoints || []) {
    const state = endpoint.status?.state;
    if (state && state !== 'ready') {
      issues.push({
        id: `endpoint-${endpoint.metadata.namespace}-${endpoint.metadata.name}`,
        severity: ['not-ready', 'invalid', 'disconnected'].includes(state) ? 'error' : 'warning',
        kind: 'CiliumEndpoint',
        group: CILIUM,
        name: endpoint.metadata.name,
        namespace: endpoint.metadata.namespace,
        message: `Endpoint is in state "${state}"`,
      });
    }
  }

  for (const node of input.ciliumNodes || []) {
    const error = node.status?.ipam?.['operator-status']?.error;
    if (error) {
      issues.push({
        id: `ipam-${node.metadata.name}`,
        severity: 'error',
        kind: 'CiliumNode',
        group: CILIUM,
        name: node.metadata.name,
        message: `IPAM error: ${error}`,
      });
    }
  }

  for (const config of [...(input.bgpClusterConfigs || []), ...(input.bgpPeerConfigs || [])]) {
    for (const condition of problemConditions(config.status?.conditions || [])) {
      issues.push({
        id: `bgp-${config.kind}-${config.metadata.name}-${condition.type}`,
        severity: 'error',
        kind: config.kind,
        group: CILIUM,
        name: config.metadata.name,
        message: `${condition.type}${condition.message ? `: ${condition.message}` : ''}`,
      });
    }
  }

  for (const config of input.bgpNodeConfigs || []) {
    const peers = (config.spec?.bgpInstances || []).flatMap(i => i.peers || []);
    const statuses = (config.status?.bgpInstances || []).flatMap(i => i.peers || []);
    const down = peers.filter(
      peer => !isEstablished(statuses.find(s => s.name === peer.name)?.peeringState)
    );
    if (down.length > 0) {
      issues.push({
        id: `bgp-sessions-${config.metadata.name}`,
        severity: down.length === peers.length ? 'error' : 'warning',
        kind: 'CiliumBGPNodeConfig',
        group: CILIUM,
        name: config.metadata.name,
        message: `${down.length} of ${peers.length} BGP session(s) not established: ${down
          .map(p => p.name)
          .join(', ')}`,
      });
    }
  }

  for (const pool of input.pools || []) {
    const usage = poolUsage(pool.status?.conditions || []);
    if (usage.conflict) {
      issues.push({
        id: `pool-conflict-${pool.metadata.name}`,
        severity: 'error',
        kind: 'CiliumLoadBalancerIPPool',
        group: CILIUM,
        name: pool.metadata.name,
        message: `Pool conflict: ${usage.conflictMessage || 'overlaps with another pool'}`,
      });
    } else if (usage.total !== undefined && usage.available === 0 && !pool.spec?.disabled) {
      issues.push({
        id: `pool-exhausted-${pool.metadata.name}`,
        severity: 'warning',
        kind: 'CiliumLoadBalancerIPPool',
        group: CILIUM,
        name: pool.metadata.name,
        message: 'Pool has no free addresses left',
      });
    }
  }

  // A pending LoadBalancer service is only Cilium's concern when LB IPAM pools exist.
  if ((input.pools || []).length > 0) {
    for (const service of input.services || []) {
      if (isLoadBalancer(service) && loadBalancerIPs(service).length === 0) {
        issues.push({
          id: `svc-${service.metadata.namespace}-${service.metadata.name}`,
          severity: 'warning',
          kind: 'Service',
          group: '',
          name: service.metadata.name,
          namespace: service.metadata.namespace,
          message: 'LoadBalancer service has no address yet (no matching or free IP pool?)',
        });
      }
    }
  }

  if (input.nodes) {
    for (const policy of input.egressPolicies || []) {
      if (egressGatewayNodes(policy.spec, input.nodes).length === 0) {
        issues.push({
          id: `egress-${policy.metadata.name}`,
          severity: 'error',
          kind: 'CiliumEgressGatewayPolicy',
          group: CILIUM,
          name: policy.metadata.name,
          message: 'No node matches the gateway node selector: selected traffic is dropped',
        });
      }
    }
  }

  return issues.sort((a, b) =>
    a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === 'error' ? -1 : 1
  );
}
