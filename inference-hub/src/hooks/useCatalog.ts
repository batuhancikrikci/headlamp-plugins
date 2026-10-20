import React from 'react';
import { CatalogEntry, catalogEntry, LocalModelCacheJson } from '../resources/catalog';
import { useEndpoints } from './useEndpoints';
import { useResourceList } from './useLive';

/** Catalog entries (LocalModelCaches) with their users resolved against the endpoints. */
export function useCatalog() {
  const caches = useResourceList<LocalModelCacheJson>('localmodelcaches');
  const { endpoints } = useEndpoints();
  const entries: CatalogEntry[] = React.useMemo(
    () =>
      caches.items
        .map(c => catalogEntry(c, endpoints))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [caches.items, endpoints]
  );
  return { ...caches, entries };
}
