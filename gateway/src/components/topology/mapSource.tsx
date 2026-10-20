/**
 * Extension of Headlamp's resource map.
 *
 * Headlamp 0.45 already draws Gateway, GatewayClass, HTTPRoute, GRPCRoute, TCPRoute and UDPRoute
 * with their relations. This source adds the two kinds it does not relate to anything yet:
 * TLSRoute (to its Gateways and Services) and ListenerSet (to its Gateway). The dedicated
 * topology page of this plugin shows the complete picture including listeners.
 */
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import React from 'react';
import { Availability } from '../../discovery/availability';
import { Gateway, ListenerSet, TLSRoute } from '../../resources/classes';
import { GATEWAY_API_ICON } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { asRecord } from '../../utils/objects';
import {
  parentRefTargets,
  resolveParentRef,
  routeBackends,
  routeParentRefs,
} from '../../utils/refs';

interface MapNode {
  id: string;
  kubeObject: KubeObject;
}

interface MapEdge {
  id: string;
  source: string;
  target: string;
}

function edge(from: KubeObject, to: KubeObject): MapEdge {
  return {
    id: `${from.metadata.uid}-${to.metadata.uid}`,
    source: from.metadata.uid,
    target: to.metadata.uid,
  };
}

function json(obj: KubeObject): KubeJson {
  return obj.jsonData as unknown as KubeJson;
}

function useTLSRouteData() {
  const [routes] = TLSRoute.useList();
  const [gateways] = Gateway.useList();
  const [services] = K8s.ResourceClasses.Service.useList();

  return React.useMemo(() => {
    if (!routes) return null;
    const nodes: MapNode[] = routes.map(route => ({ id: route.metadata.uid, kubeObject: route }));
    const edges: MapEdge[] = [];
    for (const route of routes) {
      const parents = routeParentRefs(json(route));
      for (const gateway of gateways || []) {
        if (parents.some(ref => parentRefTargets(ref, json(gateway)))) {
          edges.push(edge(route, gateway));
        }
      }
      for (const backend of routeBackends(json(route))) {
        if (backend.ref.kind !== 'Service' || backend.ref.group !== '') continue;
        const service = (services || []).find(
          candidate =>
            candidate.metadata.name === backend.ref.name &&
            candidate.metadata.namespace === backend.ref.namespace
        );
        if (service) edges.push(edge(route, service));
      }
    }
    return { nodes, edges };
  }, [routes, gateways, services]);
}

function useListenerSetData() {
  const [sets] = ListenerSet.useList();
  const [gateways] = Gateway.useList();

  return React.useMemo(() => {
    if (!sets) return null;
    const nodes: MapNode[] = sets.map(set => ({ id: set.metadata.uid, kubeObject: set }));
    const edges: MapEdge[] = [];
    for (const set of sets) {
      const parentRef = asRecord(asRecord(json(set).spec).parentRef);
      if (!parentRef.name) continue;
      const ref = resolveParentRef(
        parentRef as unknown as { name: string },
        set.metadata.namespace
      );
      const gateway = (gateways || []).find(candidate => parentRefTargets(ref, json(candidate)));
      if (gateway) edges.push(edge(set, gateway));
    }
    return { nodes, edges };
  }, [sets, gateways]);
}

/**
 * Builds the map source for the kinds served by the cluster, or `null` when neither TLSRoute nor
 * ListenerSet is installed (their hooks would only produce failing requests).
 */
export function makeGatewayApiMapSource(availability: Availability) {
  const sources = [];
  if (availability.kinds.TLSRoute && availability.kinds.Gateway) {
    sources.push({
      id: 'gateway-api-plugin-tlsroutes',
      label: 'TLS Routes',
      icon: <Icon icon="mdi:lock-outline" width="100%" height="100%" />,
      useData: useTLSRouteData,
    });
  }
  if (availability.kinds.ListenerSet && availability.kinds.Gateway) {
    sources.push({
      id: 'gateway-api-plugin-listenersets',
      label: 'Listener Sets',
      icon: <Icon icon="mdi:playlist-plus" width="100%" height="100%" />,
      useData: useListenerSetData,
    });
  }
  if (sources.length === 0) return null;
  return {
    id: 'gateway-api-plugin',
    label: 'Gateway API (TLS routes, listener sets)',
    icon: <Icon icon={GATEWAY_API_ICON} width="100%" height="100%" />,
    sources,
  };
}
