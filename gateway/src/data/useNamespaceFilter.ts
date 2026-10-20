import React from 'react';
import { useSelector } from 'react-redux';

interface FilterState {
  filter?: { namespaces?: Set<string> | string[] };
}

/** Namespaces selected in Headlamp's global namespace filter; empty means "all namespaces". */
export function useNamespaceFilter(): string[] {
  const namespaces = useSelector((state: FilterState) => state.filter?.namespaces);
  return React.useMemo(() => (namespaces ? Array.from(namespaces) : []), [namespaces]);
}

/** Whether an object passes the namespace filter. Cluster-scoped objects always do. */
export function inNamespaces(
  obj: { metadata?: { namespace?: string } },
  namespaces: string[]
): boolean {
  const namespace = obj.metadata?.namespace;
  return namespaces.length === 0 || !namespace || namespaces.includes(namespace);
}
