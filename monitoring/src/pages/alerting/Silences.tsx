import { Icon } from '@iconify/react';
import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, IconButton, Link as MuiLink, Tooltip } from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useMemo, useState } from 'react';
import { useText } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { ApiErrorAlert } from '../../components/common/Feedback';
import { ChipFilter, FilterBar, SearchField, textMatches } from '../../components/common/Filters';
import { EndpointGate, InstanceBar } from '../../components/common/InstanceBar';
import { TagList } from '../../components/common/Selectors';
import { SilenceStateChip } from '../../components/common/StatusChip';
import { useAlertmanagerEndpoint } from '../../hooks/useMonitoringEndpoint';
import { usePolling } from '../../hooks/usePolling';
import { useQueryParam } from '../../hooks/useQueryParam';
import { refreshIntervalMs, useMonitoringSettings } from '../../settings';
import { AMSilence } from '../../types';
import { formatMatcher } from '../../utils/matchers';
import { amAlerts, amExpireSilence, amSilences } from '../../utils/monitoringApi';
import { SilenceDetailsDialog } from './DetailsDialogs';
import SilenceDialog from './SilenceDialog';

const { SimpleTable, ConfirmDialog } = CommonComponents;

const STATE_ORDER: Record<string, number> = { active: 0, pending: 1, expired: 2 };

export default function Silences() {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const settings = useMonitoringSettings();
  const am = useAlertmanagerEndpoint();
  const interval = refreshIntervalMs(settings);
  const silences = usePolling(
    am.baseUrl ? () => amSilences(am.baseUrl) : null,
    [am.baseUrl],
    interval
  );
  const alerts = usePolling(am.baseUrl ? () => amAlerts(am.baseUrl) : null, [am.baseUrl], interval);

  const [search, setSearch] = useQueryParam('q');
  const [stateParam, setStateParam] = useQueryParam('state', 'active,pending');
  const states = stateParam ? stateParam.split(',') : [];

  const [details, setDetails] = useState<AMSilence | null>(null);
  const [editor, setEditor] = useState<{ silence: AMSilence | null; recreate: boolean } | null>(
    null
  );
  const [toExpire, setToExpire] = useState<AMSilence | null>(null);

  const all = useMemo(
    () =>
      [...(silences.data || [])].sort(
        (a, b) =>
          (STATE_ORDER[a.status.state] ?? 9) - (STATE_ORDER[b.status.state] ?? 9) ||
          new Date(b.endsAt).getTime() - new Date(a.endsAt).getTime()
      ),
    [silences.data]
  );
  const filtered = all.filter(
    s =>
      (states.length === 0 || states.includes(s.status.state)) &&
      textMatches(search, s.comment, s.createdBy, s.id, ...s.matchers.map(formatMatcher))
  );
  const silencedCount = (id: string) =>
    (alerts.data || []).filter(a => a.status.silencedBy.includes(id)).length;

  const expire = async () => {
    const s = toExpire;
    setToExpire(null);
    if (!s) return;
    try {
      await amExpireSilence(am.baseUrl, s.id);
      enqueueSnackbar(t('Silence expired'), { variant: 'success' });
      if (details?.id === s.id) setDetails(null);
      silences.refresh();
      alerts.refresh();
    } catch (e) {
      enqueueSnackbar(t('Failed to expire silence: {{error}}', { error: (e as Error).message }), {
        variant: 'error',
      });
    }
  };

  const gate = <EndpointGate kind="Alertmanager" ep={am} />;
  if (am.loading || am.error || am.notFound || !am.baseUrl) return gate;

  return (
    <Box>
      <InstanceBar
        kind="Alertmanager"
        ep={am}
        onRefresh={() => {
          silences.refresh();
          alerts.refresh();
        }}
        refreshing={silences.refreshing}
        lastUpdated={silences.lastUpdated}
      >
        <Button
          variant="contained"
          startIcon={<Icon icon="mdi:plus" />}
          onClick={() => setEditor({ silence: null, recreate: false })}
        >
          {t('New silence')}
        </Button>
      </InstanceBar>
      <ApiErrorAlert error={silences.error} onRetry={silences.refresh} />
      <FilterBar>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t('Search matchers, comments, creators')}
        />
        <ChipFilter
          ariaLabel={t('State')}
          options={['active', 'pending', 'expired'].map(v => ({
            value: v,
            label: v === 'active' ? t('Active') : v === 'pending' ? t('Pending') : t('Expired'),
            count: all.filter(s => s.status.state === v).length,
          }))}
          selected={states}
          onChange={v => setStateParam(v.join(','))}
        />
      </FilterBar>
      {!silences.loading && all.length === 0 ? (
        <EmptyState
          icon="mdi:bell-off-outline"
          title={t('No silences')}
          description={t(
            'Silences temporarily mute notifications for alerts matching a set of matchers.'
          )}
        />
      ) : (
        <SimpleTable
          data={filtered}
          emptyMessage={silences.loading ? t('Loading…') : t('No silences match the filters.')}
          columns={[
            {
              label: t('Matchers'),
              getter: (s: AMSilence) => (
                <MuiLink
                  component="button"
                  onClick={() => setDetails(s)}
                  sx={{ textAlign: 'left' }}
                >
                  <TagList items={s.matchers.map(formatMatcher)} />
                </MuiLink>
              ),
            },
            {
              label: t('State'),
              getter: (s: AMSilence) => <SilenceStateChip state={s.status.state} />,
            },
            {
              label: t('Silenced alerts'),
              getter: (s: AMSilence) => (s.status.state === 'active' ? silencedCount(s.id) : '-'),
            },
            {
              label: t('Ends'),
              getter: (s: AMSilence) => new Date(s.endsAt).toLocaleString(),
              sort: (a: AMSilence, b: AMSilence) =>
                new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
            },
            { label: t('Created by'), getter: (s: AMSilence) => s.createdBy || '-' },
            { label: t('Comment'), getter: (s: AMSilence) => s.comment || '-' },
            {
              label: t('Actions'),
              getter: (s: AMSilence) =>
                s.status.state === 'expired' ? (
                  <Tooltip title={t('Recreate')}>
                    <IconButton
                      size="small"
                      aria-label={t('Recreate')}
                      onClick={() => setEditor({ silence: s, recreate: true })}
                    >
                      <Icon icon="mdi:history" />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Box sx={{ display: 'flex' }}>
                    <Tooltip title={t('Edit')}>
                      <IconButton
                        size="small"
                        aria-label={t('Edit')}
                        onClick={() => setEditor({ silence: s, recreate: false })}
                      >
                        <Icon icon="mdi:pencil" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('Expire')}>
                      <IconButton
                        size="small"
                        aria-label={t('Expire')}
                        onClick={() => setToExpire(s)}
                      >
                        <Icon icon="mdi:close" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ),
            },
          ]}
        />
      )}

      <SilenceDetailsDialog
        silence={details}
        affected={
          details ? (alerts.data || []).filter(a => a.status.silencedBy.includes(details.id)) : []
        }
        onClose={() => setDetails(null)}
        onEdit={s => {
          setDetails(null);
          setEditor({ silence: s, recreate: false });
        }}
        onRecreate={s => {
          setDetails(null);
          setEditor({ silence: s, recreate: true });
        }}
        onExpire={s => setToExpire(s)}
      />
      <SilenceDialog
        open={!!editor}
        onClose={() => setEditor(null)}
        baseUrl={am.baseUrl}
        silence={editor?.silence}
        recreate={editor?.recreate}
        alerts={alerts.data}
        onSaved={() => {
          silences.refresh();
          alerts.refresh();
        }}
      />
      <ConfirmDialog
        open={!!toExpire}
        title={t('Expire silence')}
        description={t('Notifications for the matching alerts will resume immediately.')}
        handleClose={() => setToExpire(null)}
        onConfirm={expire}
        confirmLabel={t('Expire')}
        cancelLabel={t('Cancel')}
      />
    </Box>
  );
}
