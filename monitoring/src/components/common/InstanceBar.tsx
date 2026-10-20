import { Icon } from '@iconify/react';
import {
  Box,
  CircularProgress,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import type { MonitoringEndpoint } from '../../hooks/useMonitoringEndpoint';
import { formatServiceEndpoint } from '../../utils/discovery';
import { instanceKey } from '../../utils/keys';
import { ApiErrorAlert } from './Feedback';

interface InstanceLike {
  metadata: { name: string; namespace?: string };
}

/** Instance picker + resolved service + refresh control shown on live-data pages. */
export function InstanceBar<T extends InstanceLike>({
  kind,
  ep,
  onRefresh,
  refreshing,
  lastUpdated,
  children,
}: {
  kind: 'Prometheus' | 'Alertmanager';
  ep: MonitoringEndpoint<T>;
  onRefresh?: () => void;
  refreshing?: boolean;
  lastUpdated?: Date | null;
  children?: React.ReactNode;
}) {
  const { t } = useText();
  const label = kind === 'Prometheus' ? t('Prometheus instance') : t('Alertmanager instance');
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
      {ep.instances.length > 1 && ep.source !== 'override' ? (
        <TextField
          select
          size="small"
          label={label}
          value={ep.instance ? instanceKey(ep.instance) : ''}
          onChange={e => ep.select(e.target.value)}
          sx={{ minWidth: 260 }}
        >
          {ep.instances.map(i => (
            <MenuItem key={instanceKey(i)} value={instanceKey(i)}>
              {instanceKey(i)}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      {ep.endpoint && (
        <Tooltip
          title={
            ep.source === 'override'
              ? t('Manual service override from the plugin settings')
              : t('Service discovered from the {{kind}} resource', { kind })
          }
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <Icon icon="mdi:lan-connect" />
            {formatServiceEndpoint(ep.endpoint)}
          </Typography>
        </Tooltip>
      )}
      {children}
      <Box sx={{ flexGrow: 1 }} />
      {lastUpdated && (
        <Typography variant="caption" color="text.secondary">
          {t('Updated {{time}}', { time: lastUpdated.toLocaleTimeString() })}
        </Typography>
      )}
      {onRefresh && (
        <Tooltip title={t('Refresh')}>
          <span>
            <IconButton
              aria-label={t('Refresh')}
              onClick={onRefresh}
              disabled={refreshing}
              size="small"
            >
              {refreshing ? <CircularProgress size={18} /> : <Icon icon="mdi:refresh" />}
            </IconButton>
          </span>
        </Tooltip>
      )}
    </Box>
  );
}

/**
 * Renders loading / error / not-found states for an endpoint. Returns null when
 * the endpoint is ready so callers can do `return gate || <Page/>`.
 */
export function EndpointGate<T extends InstanceLike>({
  kind,
  ep,
}: {
  kind: 'Prometheus' | 'Alertmanager';
  ep: MonitoringEndpoint<T>;
}): JSX.Element | null {
  const { t } = useText();
  if (ep.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress aria-label={t('Loading')} />
      </Box>
    );
  }
  if (ep.error) {
    return <ApiErrorAlert error={ep.error} title={t('Could not discover {{kind}}', { kind })} />;
  }
  if (ep.notFound || !ep.baseUrl) {
    return (
      <EmptyState
        icon="mdi:monitor-eye"
        title={t('No {{kind}} instance found', { kind })}
        description={t(
          'Install kube-prometheus-stack (or the Prometheus Operator) and create a {{kind}} resource, or set a manual service in Settings → Plugins → monitoring.',
          { kind }
        )}
      />
    );
  }
  return null;
}
