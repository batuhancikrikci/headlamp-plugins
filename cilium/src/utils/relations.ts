/**
 * Cross-resource relationships that Cilium does not record explicitly: which services a pool or
 * announcement policy covers, which nodes a BGP or egress configuration applies to, and so on.
 * All functions are pure so they can be tested without a cluster.
 */
import { BGPFamily } from '../resources/models/bgp';
import {
  EgressGatewayPolicyInterface,
  egressGateways,
  L2AnnouncementPolicyInterface,
  LBIPBlock,
  LBIPPoolInterface,
  LocalRedirectPolicyInterface,
} from '../resources/models/network';
import { Labels, LabelSelector, NodeLike, PodLike, ServiceLike } from '../resources/types';
import { blockContainsIP } from './cidr';
import { NAMESPACE_LABEL, subjectFromPod } from './policyMatch';
import { matchesLabelSelector } from './selectors';

export const SERVICE_NAMESPACE_LABEL = 'io.kubernetes.service.namespace';
export const SERVICE_NAME_LABEL = 'io.kubernetes.service.name';

/** Labels a service selector is evaluated against: the service labels plus name and namespace. */
export function serviceLabelSet(service: ServiceLike): Labels {
  return {
    ...(service.metadata.labels || {}),
    [SERVICE_NAMESPACE_LABEL]: service.metadata.namespace || '',
    [SERVICE_NAME_LABEL]: service.metadata.name,
  };
}

/** IPs assigned to a LoadBalancer service. */
export function loadBalancerIPs(service: ServiceLike): string[] {
  return (service.status?.loadBalancer?.ingress || []).map(i => i.ip || '').filter(Boolean);
}

export function isLoadBalancer(service: ServiceLike): boolean {
  return service.spec?.type === 'LoadBalancer';
}

/** Whether LB IPAM considers the pool for the service (a missing selector matches everything). */
export function poolSelectsService(spec: LBIPPoolInterface['spec'], service: ServiceLike): boolean {
  if (!isLoadBalancer(service)) return false;
  return matchesLabelSelector(spec?.serviceSelector, serviceLabelSet(service), 'all');
}

export function blocksContainIP(blocks: LBIPBlock[] | undefined, ip: string): boolean {
  return (blocks || []).some(block => blockContainsIP(block, ip));
}

/** The IPs of a service that were allocated from the pool. */
export function ipsFromPool(spec: LBIPPoolInterface['spec'], service: ServiceLike): string[] {
  return loadBalancerIPs(service).filter(ip => blocksContainIP(spec?.blocks, ip));
}

export function l2PolicySelectsService(
  spec: L2AnnouncementPolicyInterface['spec'],
  service: ServiceLike
): boolean {
  const announcesLB = !!spec?.loadBalancerIPs && loadBalancerIPs(service).length > 0;
  const announcesExternal = !!spec?.externalIPs && (service.spec?.externalIPs || []).length > 0;
  if (!announcesLB && !announcesExternal) return false;
  return matchesLabelSelector(spec?.serviceSelector, serviceLabelSet(service), 'all');
}

/** Node selectors on Cilium resources select every node when missing. */
export function nodeSelectorMatches(
  selector: LabelSelector | null | undefined,
  node: NodeLike
): boolean {
  return matchesLabelSelector(selector, node.metadata.labels, 'all');
}

export function selectedNodes<T extends NodeLike>(
  selector: LabelSelector | null | undefined,
  nodes: T[]
): T[] {
  return nodes.filter(node => nodeSelectorMatches(selector, node));
}

/**
 * Advertisements picked up by a BGP address family: the family's `advertisements` selector is
 * matched against the labels of each CiliumBGPAdvertisement; without a selector nothing is
 * advertised.
 */
export function advertisementsForFamily<T extends { metadata: { labels?: Labels } }>(
  family: BGPFamily,
  advertisements: T[]
): T[] {
  return advertisements.filter(a =>
    matchesLabelSelector(family.advertisements, a.metadata.labels, 'none')
  );
}

/** Whether an egress gateway policy applies to the pod. */
export function egressPolicySelectsPod(
  spec: EgressGatewayPolicyInterface['spec'],
  pod: PodLike,
  namespaceLabels: Labels | undefined,
  node?: NodeLike
): boolean {
  const subject = subjectFromPod(pod, namespaceLabels);
  return (spec?.selectors || []).some(selector => {
    if (!selector.podSelector && !selector.namespaceSelector) return false;
    if (selector.nodeSelector && node && !nodeSelectorMatches(selector.nodeSelector, node)) {
      return false;
    }
    const namespaceMatches = matchesLabelSelector(
      selector.namespaceSelector,
      { ...(namespaceLabels || {}), 'kubernetes.io/metadata.name': subject.namespace },
      'all'
    );
    return namespaceMatches && matchesLabelSelector(selector.podSelector, subject.labels, 'all');
  });
}

/** Nodes that can act as gateway for an egress policy. */
export function egressGatewayNodes<T extends NodeLike>(
  spec: EgressGatewayPolicyInterface['spec'],
  nodes: T[]
): T[] {
  const gateways = egressGateways(spec);
  // A gateway without a node selector is invalid, not "all nodes".
  return nodes.filter(node =>
    gateways.some(g => !!g.nodeSelector && nodeSelectorMatches(g.nodeSelector, node))
  );
}

/** Whether a local redirect policy uses the service as its frontend. */
export function redirectTargetsService(
  policy: { metadata: { namespace?: string }; spec?: LocalRedirectPolicyInterface['spec'] },
  service: ServiceLike
): boolean {
  const matcher = policy.spec?.redirectFrontend?.serviceMatcher;
  if (!matcher?.serviceName) return false;
  const namespace = matcher.namespace || policy.metadata.namespace;
  return matcher.serviceName === service.metadata.name && namespace === service.metadata.namespace;
}

/** Whether a pod is a local redirect backend of the policy (same namespace, matching labels). */
export function redirectSelectsPod(
  policy: { metadata: { namespace?: string }; spec?: LocalRedirectPolicyInterface['spec'] },
  pod: PodLike
): boolean {
  const selector = policy.spec?.redirectBackend?.localEndpointSelector;
  if (!selector || policy.metadata.namespace !== pod.metadata.namespace) return false;
  return matchesLabelSelector(selector, {
    ...(pod.metadata.labels || {}),
    [NAMESPACE_LABEL]: pod.metadata.namespace || '',
  });
}

/** Name of the lease Cilium holds while a node announces a service over L2. */
export function l2LeaseName(service: ServiceLike): string {
  return `cilium-l2announce-${service.metadata.namespace}-${service.metadata.name}`;
}
