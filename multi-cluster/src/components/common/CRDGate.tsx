import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Button } from '@mui/material';
import React from 'react';
import { anyOcmKind, Availability, kindState } from '../../api/discovery';
import { useText } from '../../common/i18n';
import { LoadingState, NotInstalled, UnsupportedVersion } from '../../common/States';
import { useOcmDiscovery } from '../../hooks/useDiscovery';
import { crd } from '../../resources/registry';

interface CRDGateProps {
  title: string;
  /** Kind that must be available; omit to only require some OCM API. */
  kind?: string;
  children: React.ReactNode | ((availability: Availability) => React.ReactNode);
}

/**
 * Waits for API discovery of the current cluster, then renders its children if the required
 * kind is available, or a clear "not installed" / "unsupported version" state otherwise.
 */
export function CRDGate({ title, kind, children }: CRDGateProps) {
  const { t } = useText();
  const state = useOcmDiscovery();

  if (state.status === 'loading') {
    return <LoadingState title={t('Discovering Open Cluster Management APIs…')} />;
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
                'Your user is not allowed to discover the API groups of this cluster ({{error}}). API discovery is normally granted to every authenticated user by the system:discovery role.',
                { error: state.error }
              )
            : t('Could not discover the cluster APIs: {{error}}', { error: state.error })}
        </Alert>
      </SectionBox>
    );
  }
  const availability = state.availability;
  if (!kind && !anyOcmKind(availability)) {
    return <NotInstalled title={title} />;
  }
  if (kind) {
    const info = crd(kind);
    const ks = kindState(availability, info);
    if (ks.status === 'missing') {
      return <NotInstalled title={title} kind={kind} group={info.group} />;
    }
    if (ks.status === 'unsupported') {
      return (
        <UnsupportedVersion
          title={title}
          kind={kind}
          served={ks.served.map(v => `${info.group}/${v}`)}
          supported={info.versions.map(v => `${info.group}/${v}`)}
        />
      );
    }
  }
  return <>{typeof children === 'function' ? children(availability) : children}</>;
}
