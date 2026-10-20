/**
 * Data hooks shared by the relationship sections, the overview and the native integrations.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { getCachedAvailability, isAvailable } from '../api/discovery';
import { crd } from '../resources/registry';
import { CiliumEndpoint } from '../resources/runtime';
import {
  Labels,
  LabelSelector,
  NamespaceLike,
  NodeLike,
  PodLike,
  ServiceLike,
} from '../resources/types';
import { EndpointSubject, subjectFromIdentityLabels } from '../utils/policyMatch';
import { Workload, WorkloadKind } from '../utils/workloads';
import { useCurrentCluster } from './useDiscovery';

export interface ListResult<T> {
  /** null while loading. */
  items: T[] | null;
  error: unknown;
  /** The CRD is not installed in this cluster (items is then an empty list). */
  missing: boolean;
}

/** `useList` without issuing any request. */
const NO_REQUESTS = { clusters: [] as string[] };

/**
 * Lists a Cilium kind. When the CRD is not installed nothing is requested and the result is an
 * empty list, so callers can combine several kinds without checking availability themselves.
 * While API discovery is still running the result is "loading".
 */
export function useCiliumList<T>(kind: string, namespace?: string): ListResult<T> {
  const cluster = useCurrentCluster();
  const info = crd(kind);
  const availability = getCachedAvailability(cluster);
  const available = isAvailable(availability, info.plural);
  const [items, error] = info.cls.useList(
    !available ? NO_REQUESTS : namespace && info.namespaced ? { namespace } : {}
  );
  // Nothing is requested before discovery has run: callers render inside a CRDGate or use
  // useCiliumDiscovery themselves, which re-renders them once the availability is known.
  if (!availability) return { items: null, error: null, missing: false };
  if (!available) return { items: [], error: null, missing: true };
  return { items: items as T[] | null, error, missing: false };
}

interface CoreObject<J> {
  jsonData: J;
}

/** Lists a core kind and returns the plain JSON of each object. */
function useCoreList<J>(kind: string, namespace?: string): ListResult<J> {
  // Headlamp's resource classes are heterogeneous; only `useList` is used here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cls = (K8s.ResourceClasses as Record<string, any>)[kind];
  const [items, error] = cls.useList(namespace ? { namespace } : {});
  const json = React.useMemo(
    () => (items ? (items as Array<CoreObject<J>>).map(i => i.jsonData) : null),
    [items]
  );
  return { items: json, error, missing: false };
}

export function usePods(namespace?: string): ListResult<PodLike> {
  return useCoreList<PodLike>('Pod', namespace);
}

export function useNodes(): ListResult<NodeLike> {
  return useCoreList<NodeLike>('Node');
}

export function useServices(namespace?: string): ListResult<ServiceLike> {
  return useCoreList<ServiceLike>('Service', namespace);
}

export function useNamespaces(): ListResult<NamespaceLike> {
  return useCoreList<NamespaceLike>('Namespace');
}

/** Namespace labels by namespace name (empty while loading or when namespaces cannot be read). */
export function useNamespaceLabels(): Record<string, Labels> {
  const { items } = useNamespaces();
  return React.useMemo(() => {
    const out: Record<string, Labels> = {};
    for (const ns of items || []) out[ns.metadata.name] = ns.metadata.labels || {};
    return out;
  }, [items]);
}

export interface EndpointWithSubject {
  endpoint: CiliumEndpoint;
  subject: EndpointSubject;
}

/** All Cilium endpoints with the label set policies are evaluated against. */
export function useEndpointSubjects(namespace?: string): ListResult<EndpointWithSubject> {
  const { items, error, missing } = useCiliumList<CiliumEndpoint>('CiliumEndpoint', namespace);
  const subjects = React.useMemo(
    () =>
      items
        ? items.map(endpoint => ({
            endpoint,
            subject: subjectFromIdentityLabels(
              endpoint.metadata.namespace || '',
              endpoint.status.identity?.labels || []
            ),
          }))
        : null,
    [items]
  );
  return { items: subjects, error, missing };
}

interface WorkloadJson {
  metadata: { name: string; namespace?: string };
  spec?: { selector?: LabelSelector };
}

const WORKLOAD_KINDS: WorkloadKind[] = ['Deployment', 'StatefulSet', 'DaemonSet'];

/** Deployments, StatefulSets and DaemonSets with their pod selectors, sorted by name. */
export function useWorkloads(namespace?: string): ListResult<Workload> {
  const deployments = useCoreList<WorkloadJson>('Deployment', namespace);
  const statefulSets = useCoreList<WorkloadJson>('StatefulSet', namespace);
  const daemonSets = useCoreList<WorkloadJson>('DaemonSet', namespace);
  const lists = [deployments, statefulSets, daemonSets];
  const [d, s, ds] = [deployments.items, statefulSets.items, daemonSets.items];

  const items = React.useMemo(() => {
    // Show what could be listed; a kind the user may not read is simply left out.
    if (!d && !s && !ds) return null;
    const out: Workload[] = [];
    [d, s, ds].forEach((list, index) => {
      for (const item of list || []) {
        // A workload without a pod selector cannot be turned into an endpoint selector.
        if (!item.spec?.selector) continue;
        out.push({
          kind: WORKLOAD_KINDS[index],
          name: item.metadata.name,
          namespace: item.metadata.namespace || '',
          selector: item.spec.selector,
        });
      }
    });
    return out.sort(
      (a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
    );
  }, [d, s, ds]);

  const error = lists.every(l => !!l.error && !l.items) ? lists[0].error : null;
  return { items, error, missing: false };
}
