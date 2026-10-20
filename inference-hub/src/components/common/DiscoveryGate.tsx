import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { Discovery, isServed } from '../../api/discovery';
import { t } from '../../common/i18n';
import { ErrorState, LoadingState } from '../../common/States';
import { useDiscovery } from '../../hooks/useDiscovery';
import { ResourceId } from '../../resources/definitions';
import { NotInstalledState } from './NotInstalledState';

interface DiscoveryGateProps {
  /** Section title used for the loading, error and not-installed states. */
  title: string;
  /** Rendered only when at least one of these resources is served. Omit to only wait. */
  anyOf?: ResourceId[];
  children: React.ReactNode | ((discovery: Discovery) => React.ReactNode);
}

/**
 * Waits for API discovery of the current cluster, then renders the children when the required
 * APIs are served, or an explanation of what is missing and how to install it.
 */
export function DiscoveryGate({ title, anyOf, children }: DiscoveryGateProps) {
  const state = useDiscovery();

  if (state.status === 'loading') {
    return <LoadingState title={t('Discovering AI platform APIs…')} />;
  }
  if (state.status === 'error') {
    return (
      <SectionBox title={title}>
        <ErrorState
          title={t('Could not read the API groups of this cluster')}
          error={state.error}
          onRetry={state.rescan}
        />
      </SectionBox>
    );
  }
  if (anyOf && anyOf.length > 0 && !anyOf.some(id => isServed(state.discovery, id))) {
    return (
      <SectionBox title={title}>
        <NotInstalledState resources={anyOf} />
      </SectionBox>
    );
  }
  return <>{typeof children === 'function' ? children(state.discovery) : children}</>;
}
