import React from 'react';
import { useCoreList } from '../../hooks/useOcmList';
import { ArgoClusterSecret, clusterSecretInfo } from '../../resources/models/argo';

/**
 * Argo CD cluster secrets (label `argocd.argoproj.io/secret-type=cluster`). Only their metadata
 * is used; credentials are never displayed.
 */
export function useArgoClusterSecrets(namespace?: string): {
  items: ArgoClusterSecret[] | null;
  error: unknown;
} {
  const { items, error } = useCoreList(
    'Secret',
    namespace,
    'argocd.argoproj.io/secret-type=cluster'
  );
  const secrets = React.useMemo(() => (items ? items.map(clusterSecretInfo) : null), [items]);
  return { items: secrets, error };
}
