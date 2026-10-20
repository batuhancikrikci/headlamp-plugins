/**
 * Resource map sources: Cilium resources and their edges to the objects they act on.
 * The sources are split by area so that each can be toggled separately in the map.
 */
import { Icon } from '@iconify/react';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import React from 'react';
import { coreClass } from '../components/common/ResourceRefLink';
import { useCiliumList, useNamespaceLabels } from '../hooks/useClusterData';
import { useCiliumDiscovery } from '../hooks/useDiscovery';
import { ciliumIcon } from '../icons/ciliumIcon';
import {
  CiliumBGPAdvertisement,
  CiliumBGPClusterConfig,
  CiliumBGPNodeConfig,
  CiliumBGPPeerConfig,
} from '../resources/bgp';
import {
  CiliumEgressGatewayPolicy,
  CiliumL2AnnouncementPolicy,
  CiliumLoadBalancerIPPool,
} from '../resources/network';
import { CiliumClusterwideNetworkPolicy, CiliumNetworkPolicy } from '../resources/networkPolicy';
import { NodeLike, PodLike, ServiceLike } from '../resources/types';
import { policySelectsSubject, subjectFromPod } from '../utils/policyMatch';
import {
  advertisementsForFamily,
  egressGatewayNodes,
  egressPolicySelectsPod,
  ipsFromPool,
  l2PolicySelectsService,
  nodeSelectorMatches,
} from '../utils/relations';

/** Nodes of the map are Headlamp objects as returned by the list hooks. */
type GraphObject = KubeObject;

interface Graph {
  nodes: Array<{ id: string; kubeObject: GraphObject }>;
  edges: Array<{ id: string; source: string; target: string }>;
}

/** Collects nodes and edges, de-duplicating both. */
function graphBuilder() {
  const nodes = new Map<string, { id: string; kubeObject: GraphObject }>();
  const edges = new Map<string, { id: string; source: string; target: string }>();
  const addNode = (obj: GraphObject) => {
    nodes.set(obj.metadata.uid, { id: obj.metadata.uid, kubeObject: obj });
  };
  const addEdge = (source: GraphObject, target: GraphObject) => {
    addNode(source);
    addNode(target);
    const id = `${source.metadata.uid}-${target.metadata.uid}`;
    edges.set(id, { id, source: source.metadata.uid, target: target.metadata.uid });
  };
  const build = (): Graph => ({
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  });
  return { addNode, addEdge, build };
}

/** Lists a core kind as Headlamp objects (the map needs the objects, not just their JSON). */
function useCoreObjects(kind: 'Pod' | 'Service' | 'Node'): GraphObject[] {
  // Pod, Service and Node are Headlamp built-in classes, always present.
  const [items] = coreClass(kind)!.useList();
  return React.useMemo(() => (items || []) as GraphObject[], [items]);
}

function useReady(): boolean {
  const discovery = useCiliumDiscovery();
  return discovery.status === 'ready' && discovery.availability.groupInstalled;
}

/** Network policies and the pods they select. */
function usePolicyGraph(): Graph | null {
  const ready = useReady();
  const cnps = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy');
  const ccnps = useCiliumList<CiliumClusterwideNetworkPolicy>('CiliumClusterwideNetworkPolicy');
  const pods = useCoreObjects('Pod');
  const namespaceLabels = useNamespaceLabels();

  return React.useMemo(() => {
    if (!ready) return null;
    const graph = graphBuilder();
    const subjects = pods
      .filter(pod => !(pod.jsonData as PodLike).spec?.hostNetwork)
      .map(pod => ({
        pod,
        subject: subjectFromPod(
          pod.jsonData as PodLike,
          namespaceLabels[pod.metadata.namespace || '']
        ),
      }));
    for (const policy of [...(cnps.items || []), ...(ccnps.items || [])]) {
      graph.addNode(policy);
      for (const { pod, subject } of subjects) {
        if (policySelectsSubject(policy.jsonData, subject)) graph.addEdge(policy, pod);
      }
    }
    return graph.build();
  }, [ready, cnps.items, ccnps.items, pods, namespaceLabels]);
}

/** BGP cluster configs, the peer configs and advertisements they use, and the nodes they run on. */
function useBGPGraph(): Graph | null {
  const ready = useReady();
  const clusterConfigs = useCiliumList<CiliumBGPClusterConfig>('CiliumBGPClusterConfig');
  const peerConfigs = useCiliumList<CiliumBGPPeerConfig>('CiliumBGPPeerConfig');
  const advertisements = useCiliumList<CiliumBGPAdvertisement>('CiliumBGPAdvertisement');
  const nodeConfigs = useCiliumList<CiliumBGPNodeConfig>('CiliumBGPNodeConfig');
  const nodes = useCoreObjects('Node');

  return React.useMemo(() => {
    if (!ready) return null;
    const graph = graphBuilder();
    const peerByName = new Map((peerConfigs.items || []).map(p => [p.metadata.name, p]));
    const nodeByName = new Map(nodes.map(n => [n.metadata.name, n]));
    for (const config of clusterConfigs.items || []) {
      graph.addNode(config);
      for (const name of config.peerConfigNames) {
        const peerConfig = peerByName.get(name);
        if (peerConfig) graph.addEdge(config, peerConfig);
      }
      for (const node of nodes) {
        if (nodeSelectorMatches(config.spec.nodeSelector, node.jsonData as NodeLike)) {
          graph.addEdge(config, node);
        }
      }
    }
    for (const peerConfig of peerConfigs.items || []) {
      graph.addNode(peerConfig);
      for (const family of peerConfig.families) {
        for (const ad of advertisementsForFamily(family, advertisements.items || [])) {
          graph.addEdge(peerConfig, ad);
        }
      }
    }
    for (const ad of advertisements.items || []) graph.addNode(ad);
    for (const nodeConfig of nodeConfigs.items || []) {
      const node = nodeByName.get(nodeConfig.metadata.name);
      if (node) graph.addEdge(nodeConfig, node);
      else graph.addNode(nodeConfig);
    }
    return graph.build();
  }, [
    ready,
    clusterConfigs.items,
    peerConfigs.items,
    advertisements.items,
    nodeConfigs.items,
    nodes,
  ]);
}

/** LB IP pools and L2 announcement policies with the services they serve. */
function useLoadBalancingGraph(): Graph | null {
  const ready = useReady();
  const pools = useCiliumList<CiliumLoadBalancerIPPool>('CiliumLoadBalancerIPPool');
  const l2 = useCiliumList<CiliumL2AnnouncementPolicy>('CiliumL2AnnouncementPolicy');
  const services = useCoreObjects('Service');

  return React.useMemo(() => {
    if (!ready) return null;
    const graph = graphBuilder();
    for (const pool of pools.items || []) {
      graph.addNode(pool);
      for (const service of services) {
        if (ipsFromPool(pool.jsonData.spec, service.jsonData as ServiceLike).length > 0) {
          graph.addEdge(pool, service);
        }
      }
    }
    for (const policy of l2.items || []) {
      graph.addNode(policy);
      for (const service of services) {
        if (l2PolicySelectsService(policy.jsonData.spec, service.jsonData as ServiceLike)) {
          graph.addEdge(policy, service);
        }
      }
    }
    return graph.build();
  }, [ready, pools.items, l2.items, services]);
}

/** Egress gateway policies with their source pods and gateway nodes. */
function useEgressGraph(): Graph | null {
  const ready = useReady();
  const policies = useCiliumList<CiliumEgressGatewayPolicy>('CiliumEgressGatewayPolicy');
  const pods = useCoreObjects('Pod');
  const nodes = useCoreObjects('Node');
  const namespaceLabels = useNamespaceLabels();

  return React.useMemo(() => {
    if (!ready) return null;
    const graph = graphBuilder();
    for (const policy of policies.items || []) {
      graph.addNode(policy);
      for (const pod of pods) {
        const json = pod.jsonData as PodLike;
        if (
          !json.spec?.hostNetwork &&
          egressPolicySelectsPod(
            policy.jsonData.spec,
            json,
            namespaceLabels[pod.metadata.namespace || '']
          )
        ) {
          graph.addEdge(pod, policy);
        }
      }
      for (const node of nodes) {
        if (egressGatewayNodes(policy.jsonData.spec, [node.jsonData as NodeLike]).length > 0) {
          graph.addEdge(policy, node);
        }
      }
    }
    return graph.build();
  }, [ready, policies.items, pods, nodes, namespaceLabels]);
}

const icon = <Icon icon={ciliumIcon} width="100%" height="100%" />;

export const ciliumMapSource = {
  id: 'cilium',
  label: 'Cilium',
  icon,
  sources: [
    {
      id: 'cilium-policies',
      label: 'Network policies',
      icon,
      // Policy to pod edges can be numerous; the user opts in.
      isEnabledByDefault: false,
      useData: usePolicyGraph,
    },
    { id: 'cilium-bgp', label: 'BGP', icon, useData: useBGPGraph },
    { id: 'cilium-lb', label: 'Load balancing', icon, useData: useLoadBalancingGraph },
    { id: 'cilium-egress', label: 'Egress gateways', icon, useData: useEgressGraph },
  ],
};
