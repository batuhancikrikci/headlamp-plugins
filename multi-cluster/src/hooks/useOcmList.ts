/**
 * List hooks shared by the overview, the relationship sections and the wizards.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { getCachedAvailability, isKindAvailable } from '../api/discovery';
import { KubeJson } from '../resources/models/common';
import { crd } from '../resources/registry';
import { useCurrentCluster, useOcmDiscovery } from './useDiscovery';

export interface ListResult<J> {
  /** Plain JSON of the objects; null while loading. */
  items: J[] | null;
  error: unknown;
  /** The kind is not served by this cluster (items is then an empty list). */
  missing: boolean;
}

/** `useList` options that issue no request at all. */
const NO_REQUESTS = { clusters: [] as string[] };

/**
 * Lists a kind and returns the plain JSON of each object. When the kind is not installed
 * nothing is requested and the result is an empty list, so callers can combine several kinds
 * without checking availability themselves. While discovery runs the result is "loading".
 */
export function useOcmList<J extends KubeJson = KubeJson>(
  kind: string,
  options: { namespace?: string; labelSelector?: string; enabled?: boolean } = {}
): ListResult<J> {
  // Re-render once discovery completes (the hook below shares the per-cluster cache).
  useOcmDiscovery();
  const cluster = useCurrentCluster();
  const info = crd(kind);
  const availability = getCachedAvailability(cluster);
  const available = isKindAvailable(availability, info) && options.enabled !== false;
  const query: Record<string, string> = {};
  if (options.namespace && info.namespaced) query.namespace = options.namespace;
  if (options.labelSelector) query.labelSelector = options.labelSelector;
  const [items, error] = info.cls.useList(available ? query : NO_REQUESTS);
  const json = React.useMemo(
    () => (items ? (items as unknown as Array<{ jsonData: J }>).map(i => i.jsonData) : null),
    [items]
  );
  if (!availability) return { items: null, error: null, missing: false };
  if (!available) return { items: [], error: null, missing: true };
  return { items: json, error, missing: false };
}

/** Lists a core Kubernetes kind known to Headlamp (Namespace, Secret, ...). */
export function useCoreList<J extends KubeJson = KubeJson>(
  kind: string,
  namespace?: string,
  labelSelector?: string
): ListResult<J> {
  // Headlamp's resource classes are heterogeneous; only `useList` is used here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cls = (K8s.ResourceClasses as Record<string, any>)[kind];
  const query: Record<string, string> = {};
  if (namespace) query.namespace = namespace;
  if (labelSelector) query.labelSelector = labelSelector;
  const [items, error] = cls.useList(query);
  const json = React.useMemo(
    () => (items ? (items as Array<{ jsonData: J }>).map(i => i.jsonData) : null),
    [items]
  );
  return { items: json, error, missing: false };
}

/** Namespace names (empty while loading or when namespaces cannot be listed). */
export function useNamespaceNames(): string[] {
  const { items } = useCoreList('Namespace');
  return React.useMemo(
    () => (items || []).map(n => n.metadata.name).sort((a, b) => a.localeCompare(b)),
    [items]
  );
}
