import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObject, KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import React from 'react';
import { envoyGatewayIcon } from '../../icons/envoyGatewayIcon';
import { Backend } from '../../resources/backend';
import { BackendTrafficPolicy } from '../../resources/backendTrafficPolicy';
import { ClientTrafficPolicy } from '../../resources/clientTrafficPolicy';
import { EnvoyExtensionPolicy } from '../../resources/envoyExtensionPolicy';
import { EnvoyPatchPolicy } from '../../resources/envoyPatchPolicy';
import { EnvoyProxy } from '../../resources/envoyProxy';
import { HTTPRouteFilter } from '../../resources/httpRouteFilter';
import { SecurityPolicy } from '../../resources/securityPolicy';
import { API_GROUP, ObjectJson } from '../../resources/types';
import {
  identityOf,
  objectRefMatches,
  policyTargets,
  routeBackendRefs,
  routeExtensionRefs,
} from '../../utils/targets';
import { useEnvoyGatewayDiscovery } from '../../utils/versionDiscovery';

function rc(kind: string): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

function list(result: [KubeObject[] | null, unknown]): KubeObject[] {
  return result[0] || [];
}

/**
 * Resource map source: Envoy Gateway resources and their edges to the Gateway API objects
 * they configure. Hooks are called unconditionally, missing CRDs simply yield empty lists.
 */
function useEnvoyGatewayGraph() {
  useEnvoyGatewayDiscovery();
  const policies = [
    list(BackendTrafficPolicy.useList()),
    list(ClientTrafficPolicy.useList()),
    list(SecurityPolicy.useList()),
    list(EnvoyExtensionPolicy.useList()),
    list(EnvoyPatchPolicy.useList()),
  ].flat();
  const proxies = list(EnvoyProxy.useList());
  const backends = list(Backend.useList());
  const filters = list(HTTPRouteFilter.useList());
  const gateways = list(rc('Gateway').useList());
  const classes = list(rc('GatewayClass').useList());
  const httpRoutes = list(rc('HTTPRoute').useList());
  const grpcRoutes = list(rc('GRPCRoute').useList());

  const targets = [...gateways, ...classes, ...httpRoutes, ...grpcRoutes];
  const nodes = new Map<string, { id: string; kubeObject: KubeObject }>();
  const edges: Array<{ id: string; source: string; target: string }> = [];
  const addNode = (obj: KubeObject) =>
    nodes.set(obj.metadata.uid, { id: obj.metadata.uid, kubeObject: obj });
  const addEdge = (source: KubeObject, target: KubeObject) => {
    addNode(source);
    addNode(target);
    edges.push({
      id: `${source.metadata.uid}-${target.metadata.uid}`,
      source: source.metadata.uid,
      target: target.metadata.uid,
    });
  };

  for (const obj of [...policies, ...proxies, ...backends, ...filters]) addNode(obj);

  for (const policy of policies) {
    for (const target of targets) {
      if (policyTargets(policy.jsonData as ObjectJson, identityOf(target.jsonData)))
        addEdge(policy, target);
    }
  }
  for (const proxy of proxies) {
    const ep = {
      group: API_GROUP,
      kind: 'EnvoyProxy',
      name: proxy.metadata.name,
      namespace: proxy.metadata.namespace,
    };
    for (const gc of classes) {
      if (objectRefMatches(gc.jsonData.spec?.parametersRef, ep, undefined)) addEdge(gc, proxy);
    }
    for (const gw of gateways) {
      if (
        objectRefMatches(gw.jsonData.spec?.infrastructure?.parametersRef, ep, gw.metadata.namespace)
      ) {
        addEdge(gw, proxy);
      }
    }
  }
  for (const route of [...httpRoutes, ...grpcRoutes]) {
    const json = route.jsonData as ObjectJson;
    const ns = route.metadata.namespace;
    for (const backend of backends) {
      const b = {
        group: API_GROUP,
        kind: 'Backend',
        name: backend.metadata.name,
        namespace: backend.metadata.namespace,
      };
      if (
        routeBackendRefs(json).some(ref =>
          objectRefMatches(ref, b, ns, { kind: 'Service', group: '' })
        )
      ) {
        addEdge(route, backend);
      }
    }
    for (const filter of filters) {
      const f = {
        group: API_GROUP,
        kind: 'HTTPRouteFilter',
        name: filter.metadata.name,
        namespace: filter.metadata.namespace,
      };
      if (routeExtensionRefs(json).some(ref => objectRefMatches(ref, f, ns)))
        addEdge(route, filter);
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

export const envoyGatewayMapSource = {
  id: 'envoy-gateway',
  label: 'Envoy Gateway',
  icon: <Icon icon={envoyGatewayIcon} width="100%" height="100%" />,
  useData: useEnvoyGatewayGraph,
};
