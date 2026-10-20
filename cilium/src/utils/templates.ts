/**
 * Starting objects for the create dialogs and wizards.
 */
import { isNamespacedKind } from '../resources/kinds';
import { KubeJson } from '../resources/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const initialSpecs: Record<string, () => Spec> = {
  CiliumNetworkPolicy: () => ({ endpointSelector: { matchLabels: {} } }),
  CiliumClusterwideNetworkPolicy: () => ({ endpointSelector: { matchLabels: {} } }),
  CiliumCIDRGroup: () => ({ externalCIDRs: [] }),
  CiliumNodeConfig: () => ({ nodeSelector: { matchLabels: {} }, defaults: {} }),
  CiliumBGPClusterConfig: () => ({
    nodeSelector: { matchLabels: {} },
    bgpInstances: [{ name: 'instance-65000', localASN: 65000, peers: [] }],
  }),
  CiliumBGPPeerConfig: () => ({
    timers: { holdTimeSeconds: 90, keepAliveTimeSeconds: 30 },
    gracefulRestart: { enabled: true, restartTimeSeconds: 120 },
    families: [
      { afi: 'ipv4', safi: 'unicast', advertisements: { matchLabels: { advertise: 'bgp' } } },
    ],
  }),
  CiliumBGPAdvertisement: () => ({ advertisements: [{ advertisementType: 'PodCIDR' }] }),
  CiliumBGPNodeConfigOverride: () => ({ bgpInstances: [{ name: 'instance-65000' }] }),
  CiliumBGPPeeringPolicy: () => ({ nodeSelector: { matchLabels: {} }, virtualRouters: [] }),
  CiliumLoadBalancerIPPool: () => ({ blocks: [{ cidr: '' }] }),
  CiliumL2AnnouncementPolicy: () => ({ loadBalancerIPs: true }),
  CiliumPodIPPool: () => ({ ipv4: { cidrs: [], maskSize: 27 } }),
  CiliumEgressGatewayPolicy: () => ({
    selectors: [{ podSelector: { matchLabels: {} } }],
    destinationCIDRs: ['0.0.0.0/0'],
    egressGateway: { nodeSelector: { matchLabels: {} } },
  }),
  CiliumLocalRedirectPolicy: () => ({
    redirectFrontend: {
      addressMatcher: { ip: '', toPorts: [{ port: '53', protocol: 'UDP', name: 'dns' }] },
    },
    redirectBackend: {
      localEndpointSelector: { matchLabels: {} },
      toPorts: [{ port: '53', protocol: 'UDP', name: 'dns' }],
    },
  }),
  CiliumEnvoyConfig: () => ({ services: [], resources: [] }),
  CiliumClusterwideEnvoyConfig: () => ({ services: [], resources: [] }),
};

/** A new, mostly empty object of the given kind for the create dialogs. */
export function newResource(kind: string, apiVersion: string, namespace = 'default'): KubeJson {
  const namespaced = isNamespacedKind(kind);
  return {
    apiVersion,
    kind,
    metadata: namespaced ? { name: '', namespace } : { name: '' },
    spec: initialSpecs[kind] ? initialSpecs[kind]() : {},
  };
}
