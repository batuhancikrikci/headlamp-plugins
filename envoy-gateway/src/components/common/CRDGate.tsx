import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Button } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { NotInstalled } from '../../common/States';
import { crdByPlural } from '../../resources/registry';
import { Availability, isAvailable, useEnvoyGatewayDiscovery } from '../../utils/versionDiscovery';

interface CRDGateProps {
  title: string;
  /** Resource plural that must be available; omit to only require the API group. */
  plural?: string;
  children: React.ReactNode | ((availability: Availability) => React.ReactNode);
}

/**
 * Waits for API version discovery of the current cluster, then renders its children if the
 * required CRD is installed, or an explanatory empty state otherwise.
 */
export function CRDGate({ title, plural, children }: CRDGateProps) {
  const { t } = useText();
  const state = useEnvoyGatewayDiscovery();

  if (state.status === 'loading') {
    return <Loader title={t('Discovering Envoy Gateway APIs…')} />;
  }
  if (state.status === 'error') {
    return (
      <SectionBox title={title}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={state.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {t('Could not discover the Envoy Gateway API: {{error}}', { error: state.error })}
        </Alert>
      </SectionBox>
    );
  }
  if (!state.availability.groupInstalled) {
    return <NotInstalled title={title} />;
  }
  if (plural && !isAvailable(state.availability, plural)) {
    return <NotInstalled title={title} kind={crdByPlural(plural)?.kind || plural} />;
  }
  return <>{typeof children === 'function' ? children(state.availability) : children}</>;
}
