import { Alert } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ErrorState } from '../../common/States';

/** Error alert with hints for errors of the Prometheus and Alertmanager APIs (service proxy). */
export function ApiErrorAlert({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const { t } = useText();
  const unreachable = t('The service is not reachable. Check that its pods are running and ready.');
  return (
    <ErrorState
      error={error}
      title={title}
      onRetry={onRetry}
      hints={{
        403: t(
          'Your user lacks permission. Proxying to Prometheus/Alertmanager requires "get" on "services/proxy" in the instance namespace.'
        ),
        404: t(
          'Endpoint not found. The instance may use a route prefix; adjust it in the plugin settings.'
        ),
        502: unreachable,
        503: unreachable,
      }}
    />
  );
}

/** Warns before editing objects owned by a Helm release. */
export function HelmManagedAlert({ release }: { release?: string | null }) {
  const { t } = useText();
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {release
        ? t(
            'This object is managed by the Helm release "{{release}}". Manual changes will be overwritten by the next helm upgrade; prefer changing the chart values.',
            { release }
          )
        : t(
            'This object is managed by Helm. Manual changes will be overwritten by the next helm upgrade; prefer changing the chart values.'
          )}
    </Alert>
  );
}
