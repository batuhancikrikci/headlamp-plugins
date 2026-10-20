import { Icon } from '@iconify/react';
import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, IconButton, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import React, { useMemo, useState } from 'react';
import { useText } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { ApiErrorAlert } from '../../components/common/Feedback';
import { ChipFilter, FilterBar, SearchField, textMatches } from '../../components/common/Filters';
import { EndpointGate, InstanceBar } from '../../components/common/InstanceBar';
import {
  AlertStateChip,
  AMAlertStatusChip,
  SeverityChip,
  severityTone,
} from '../../components/common/StatusChip';
import { useAlertmanagerEndpoint, usePrometheusEndpoint } from '../../hooks/useMonitoringEndpoint';
import { usePolling } from '../../hooks/usePolling';
import { useQueryParam } from '../../hooks/useQueryParam';
import { refreshIntervalMs, useMonitoringSettings } from '../../settings';
import { AMAlert, PromAlert } from '../../types';
import { timeAgo } from '../../utils/duration';
import { amAlerts, promAlerts } from '../../utils/monitoringApi';
import { AlertDetailsDialog } from './DetailsDialogs';
import SilenceDialog from './SilenceDialog';

const { SimpleTable } = CommonComponents;

/** Alertmanager adds external labels, so its label set is a superset of Prometheus'. */
export function findAMAlert(alert: PromAlert, amList: AMAlert[] | undefined): AMAlert | null {
  if (!amList) return null;
  return (
    amList.find(a => Object.entries(alert.labels).every(([k, v]) => a.labels[k] === v)) || null
  );
}

export default function ActiveAlerts() {
  const { t } = useText();
  const settings = useMonitoringSettings();
  const interval = refreshIntervalMs(settings);
  const prom = usePrometheusEndpoint();
  const am = useAlertmanagerEndpoint();

  const alerts = usePolling(
    prom.baseUrl ? () => promAlerts(prom.baseUrl) : null,
    [prom.baseUrl],
    interval
  );
  const amList = usePolling(am.baseUrl ? () => amAlerts(am.baseUrl) : null, [am.baseUrl], interval);

  const [search, setSearch] = useQueryParam('q');
  const [stateParam, setStateParam] = useQueryParam('state');
  const [sevParam, setSevParam] = useQueryParam('severity');
  const states = stateParam ? stateParam.split(',') : [];
  const severities = sevParam ? sevParam.split(',') : [];

  const [selected, setSelected] = useState<PromAlert | null>(null);
  const [silenceFor, setSilenceFor] = useState<PromAlert | null>(null);

  const rows = useMemo(
    () =>
      (alerts.data || []).map(a => ({
        alert: a,
        am: findAMAlert(a, amList.data),
      })),
    [alerts.data, amList.data]
  );

  const severityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(r => {
      const s = r.alert.labels.severity || 'none';
      counts.set(s, (counts.get(s) || 0) + 1);
    });
    const order = ['critical', 'warning', 'info', 'none'];
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]);
        const ib = order.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
      })
      .map(([value, count]) => ({ value, label: value, count }));
  }, [rows]);

  const filtered = rows.filter(
    ({ alert }) =>
      (states.length === 0 || states.includes(alert.state)) &&
      (severities.length === 0 || severities.includes(alert.labels.severity || 'none')) &&
      textMatches(
        search,
        alert.labels.alertname,
        alert.labels.namespace,
        alert.annotations?.summary,
        alert.annotations?.description,
        ...Object.values(alert.labels)
      )
  );

  const gate = <EndpointGate kind="Prometheus" ep={prom} />;
  if (prom.loading || prom.error || prom.notFound || !prom.baseUrl) return gate;

  const refresh = () => {
    alerts.refresh();
    amList.refresh();
  };

  return (
    <Box>
      <InstanceBar
        kind="Prometheus"
        ep={prom}
        onRefresh={refresh}
        refreshing={alerts.refreshing || amList.refreshing}
        lastUpdated={alerts.lastUpdated}
      />
      {!am.loading && !am.baseUrl && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t(
            'Alertmanager was not found: silenced/inhibited status and silencing are unavailable.'
          )}
        </Typography>
      )}
      <ApiErrorAlert error={alerts.error} onRetry={alerts.refresh} />
      <ApiErrorAlert error={amList.error} title={t('Alertmanager')} />

      <FilterBar>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t('Search alerts, labels, summaries')}
        />
        <ChipFilter
          ariaLabel={t('State')}
          options={[
            {
              value: 'firing',
              label: t('Firing'),
              count: rows.filter(r => r.alert.state === 'firing').length,
            },
            {
              value: 'pending',
              label: t('Pending'),
              count: rows.filter(r => r.alert.state === 'pending').length,
            },
          ]}
          selected={states}
          onChange={v => setStateParam(v.join(','))}
        />
        <ChipFilter
          ariaLabel={t('Severity')}
          options={severityOptions}
          selected={severities}
          onChange={v => setSevParam(v.join(','))}
        />
      </FilterBar>

      {!alerts.loading && rows.length === 0 && !alerts.error ? (
        <EmptyState
          icon="mdi:check-circle"
          title={t('No active alerts')}
          description={t('Everything is quiet.')}
        />
      ) : (
        <SimpleTable
          data={filtered}
          emptyMessage={alerts.loading ? t('Loading…') : t('No alerts match the filters.')}
          columns={[
            {
              label: t('Alert'),
              getter: ({ alert }: { alert: PromAlert }) => (
                <MuiLink
                  component="button"
                  variant="body2"
                  onClick={() => setSelected(alert)}
                  sx={{ textAlign: 'left' }}
                >
                  {alert.labels.alertname}
                </MuiLink>
              ),
              sort: (a: { alert: PromAlert }, b: { alert: PromAlert }) =>
                (a.alert.labels.alertname || '').localeCompare(b.alert.labels.alertname || ''),
            },
            {
              label: t('Severity'),
              getter: ({ alert }: { alert: PromAlert }) => (
                <SeverityChip severity={alert.labels.severity} />
              ),
              sort: (a: { alert: PromAlert }, b: { alert: PromAlert }) => {
                const rank = { error: 0, warning: 1, info: 2, success: 3, default: 4 };
                return (
                  rank[severityTone(a.alert.labels.severity)] -
                  rank[severityTone(b.alert.labels.severity)]
                );
              },
            },
            {
              label: t('State'),
              getter: ({ alert }: { alert: PromAlert }) => <AlertStateChip state={alert.state} />,
            },
            {
              label: t('Notification'),
              getter: ({ am: a, alert }: { am: AMAlert | null; alert: PromAlert }) =>
                a ? (
                  <AMAlertStatusChip
                    state={a.status.state}
                    silenced={a.status.silencedBy.length > 0}
                    inhibited={a.status.inhibitedBy.length > 0}
                  />
                ) : alert.state === 'pending' ? (
                  '-'
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {am.baseUrl ? t('Not received') : '-'}
                  </Typography>
                ),
            },
            {
              label: t('Namespace'),
              getter: ({ alert }: { alert: PromAlert }) => alert.labels.namespace || '-',
            },
            {
              label: t('Summary'),
              getter: ({ alert }: { alert: PromAlert }) => (
                <Typography variant="body2" sx={{ maxWidth: 420 }}>
                  {alert.annotations?.summary ||
                    alert.annotations?.message ||
                    alert.annotations?.description ||
                    '-'}
                </Typography>
              ),
            },
            {
              label: t('Active for'),
              getter: ({ alert }: { alert: PromAlert }) => (
                <Tooltip title={alert.activeAt ? new Date(alert.activeAt).toLocaleString() : ''}>
                  <span>{timeAgo(alert.activeAt)}</span>
                </Tooltip>
              ),
              sort: (a: { alert: PromAlert }, b: { alert: PromAlert }) =>
                new Date(a.alert.activeAt || 0).getTime() -
                new Date(b.alert.activeAt || 0).getTime(),
            },
            {
              label: t('Actions'),
              getter: ({ alert }: { alert: PromAlert }) =>
                am.baseUrl ? (
                  <Tooltip title={t('Silence this alert')}>
                    <IconButton
                      size="small"
                      aria-label={t('Silence this alert')}
                      onClick={() => setSilenceFor(alert)}
                    >
                      <Icon icon="mdi:bell-off" />
                    </IconButton>
                  </Tooltip>
                ) : null,
            },
          ]}
        />
      )}

      <AlertDetailsDialog
        alert={selected}
        amAlert={selected ? findAMAlert(selected, amList.data) : null}
        onClose={() => setSelected(null)}
        onSilence={
          am.baseUrl
            ? a => {
                setSelected(null);
                setSilenceFor(a);
              }
            : undefined
        }
      />
      <SilenceDialog
        open={!!silenceFor}
        onClose={() => setSilenceFor(null)}
        baseUrl={am.baseUrl}
        initialLabels={silenceFor?.labels}
        alerts={amList.data}
        onSaved={() => amList.refresh()}
      />
    </Box>
  );
}
