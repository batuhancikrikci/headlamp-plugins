import { Loader, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Button } from '@mui/material';
import React from 'react';
import { Availability, isAvailable } from '../../api/discovery';
import { useText } from '../../common/i18n';
import { NotInstalled } from '../../common/States';
import { useCiliumDiscovery } from '../../hooks/useDiscovery';
import { crdByPlural } from '../../resources/registry';

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
  const state = useCiliumDiscovery();

  if (state.status === 'loading') {
    return <Loader title={t('Discovering Cilium APIs…')} />;
  }
  if (state.status === 'error') {
    return (
      <SectionBox title={title}>
        <Alert
          severity={state.forbidden ? 'warning' : 'error'}
          action={
            <Button color="inherit" size="small" onClick={state.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {state.forbidden
            ? t(
                'Your user is not allowed to discover the Cilium API group ({{error}}). API discovery is normally granted to every authenticated user by the system:discovery role.',
                { error: state.error }
              )
            : t('Could not discover the Cilium API: {{error}}', { error: state.error })}
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
