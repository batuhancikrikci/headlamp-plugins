import { Icon } from '@iconify/react';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { patchAnnotations } from '../../api/mutations';
import { t } from '../../common/i18n';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import { GuardedButton } from '../../components/common/GuardedButton';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useEfficiency } from '../../hooks/useEfficiency';
import { ModelEndpoint, STOP_ANNOTATION } from '../../resources/endpoint';
import { DETAIL_PAGES } from '../../routes';
import {
  DEFAULT_IDLE_THRESHOLD,
  EfficiencyRow,
  EfficiencyState,
  WindowId,
  WINDOWS,
} from '../../utils/efficiency';
import { formatPercent } from '../../utils/vllmMetrics';

const STATE_META: Record<
  EfficiencyState,
  { label: string; color: 'error' | 'warning' | 'success' | 'default' }
> = {
  idle: { label: 'Idle', color: 'error' },
  underused: { label: 'Underused', color: 'warning' },
  busy: { label: 'In use', color: 'success' },
  unknown: { label: 'No data', color: 'default' },
  stopped: { label: 'Stopped', color: 'default' },
};

function count(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function StopAction({ endpoint }: { endpoint: ModelEndpoint }) {
  const cluster = useCurrentCluster();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <GuardedButton
        check={{
          verb: 'patch',
          group: endpoint.apiVersion.split('/')[0],
          resource:
            endpoint.kind === 'LLMInferenceService' ? 'llminferenceservices' : 'inferenceservices',
          namespace: endpoint.namespace,
          name: endpoint.name,
        }}
        label={t('Stop')}
        icon="mdi:stop-circle-outline"
        size="small"
        onClick={() => setOpen(true)}
      />
      <ConfirmDialog
        open={open}
        title={t('Stop {{name}}?', { name: endpoint.name })}
        message={t(
          'KServe removes the model server pods and keeps the configuration (annotation serving.kserve.io/stop). GPUs are released until you resume the endpoint.'
        )}
        confirmLabel={t('Stop')}
        onConfirm={async () => {
          await patchAnnotations(endpoint.raw, { [STOP_ANNOTATION]: 'true' }, cluster);
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** What to do about an idle or underused endpoint. */
function suggestion(row: EfficiencyRow): React.ReactNode {
  const endpoint = row.endpoint;
  if (!endpoint || (row.state !== 'idle' && row.state !== 'underused')) return null;
  if (row.state === 'idle') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <StopAction endpoint={endpoint} />
        {(endpoint.minReplicas ?? 1) > 0 && endpoint.maxReplicas !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {t('or let autoscaling go to 0 replicas')}
          </Typography>
        )}
      </Box>
    );
  }
  return (
    <Typography variant="caption" color="text.secondary">
      {t('Few requests: fewer replicas or a smaller GPU may do.')}
    </Typography>
  );
}

/**
 * GPU Efficiency: GPUs held by endpoints and other workloads, how much they were used over a
 * window, and which sit idle.
 */
export function GpuEfficiencyPage() {
  const [window, setWindow] = React.useState<WindowId>('24h');
  const [threshold, setThreshold] = React.useState(DEFAULT_IDLE_THRESHOLD);
  const { rows, totals, prometheus, error, podsForbidden } = useEfficiency(window, threshold);
  const windowLabel = WINDOWS.find(w => w.id === window)?.label || window;

  return (
    <SectionBox
      title={t('GPU Efficiency')}
      headerProps={{
        titleSideActions: [
          <Box key="controls" sx={{ display: 'flex', gap: 1 }}>
            <TextField
              select
              size="small"
              label={t('Window')}
              value={window}
              onChange={e => setWindow(e.target.value as WindowId)}
              sx={{ minWidth: 140 }}
            >
              {WINDOWS.map(w => (
                <MenuItem key={w.id} value={w.id}>
                  {t(w.label)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="number"
              size="small"
              label={t('Idle below (%)')}
              value={threshold}
              inputProps={{ min: 1, max: 50 }}
              onChange={e => setThreshold(Math.min(50, Math.max(1, Number(e.target.value) || 5)))}
              sx={{ width: 140 }}
            />
          </Box>,
        ],
      }}
    >
      {prometheus.status !== 'ready' && prometheus.status !== 'loading' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t(
            'GPU utilization and traffic need Prometheus with the DCGM exporter and vLLM metrics (Settings). Until then only the GPUs held by each workload are shown.'
          )}
        </Alert>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {podsForbidden && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('You cannot list pods in all namespaces: GPUs are taken from the endpoint specs.')}
        </Alert>
      )}
      <SummaryTiles
        tiles={[
          {
            id: 'gpus',
            label: t('GPUs held'),
            value: totals.gpus,
            icon: 'mdi:expansion-card-variant',
            color: 'primary.main',
          },
          {
            id: 'idle',
            label: t('Idle GPUs ({{w}})', { w: t(windowLabel) }),
            value: totals.idleGpus,
            icon: 'mdi:sleep',
            color: totals.idleGpus ? 'error.main' : 'text.secondary',
          },
          {
            id: 'util',
            label: t('Average GPU utilization'),
            value: totals.util === undefined ? '—' : formatPercent(totals.util),
            icon: 'mdi:gauge',
            color: 'info.main',
          },
          {
            id: 'tokens',
            label: t('Tokens per GPU-hour'),
            value: count(totals.tokensPerGpuHour),
            icon: 'mdi:speedometer',
            color: 'text.secondary',
          },
        ]}
      />
      <SimpleTable
        data={rows}
        columns={[
          {
            label: t('Workload'),
            getter: (row: EfficiencyRow) =>
              row.endpoint ? (
                <Link
                  routeName={DETAIL_PAGES.endpoint.name}
                  params={{
                    slug: row.endpoint.slug,
                    namespace: row.endpoint.namespace,
                    name: row.endpoint.name,
                  }}
                >
                  {row.id}
                </Link>
              ) : (
                <Tooltip title={t('A GPU pod that belongs to no model endpoint')}>
                  <span>
                    <Icon icon="mdi:cube-outline" style={{ verticalAlign: 'text-bottom' }} />{' '}
                    {row.id}
                  </span>
                </Tooltip>
              ),
          },
          { label: t('GPUs'), getter: (row: EfficiencyRow) => row.gpus || '—' },
          {
            label: t('GPU utilization'),
            getter: (row: EfficiencyRow) =>
              row.util === undefined ? '—' : formatPercent(row.util),
          },
          { label: t('Requests'), getter: (row: EfficiencyRow) => count(row.requests) },
          { label: t('Tokens'), getter: (row: EfficiencyRow) => count(row.tokens) },
          {
            label: t('Tokens / GPU-hour'),
            getter: (row: EfficiencyRow) => count(row.tokensPerGpuHour),
          },
          {
            label: t('State'),
            getter: (row: EfficiencyRow) => (
              <Chip
                size="small"
                color={STATE_META[row.state].color}
                variant={row.state === 'busy' ? 'outlined' : 'filled'}
                label={t(STATE_META[row.state].label)}
              />
            ),
          },
          { label: t('Suggestion'), getter: (row: EfficiencyRow) => suggestion(row) },
        ]}
      />
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {t(
          'Idle: average GPU utilization below {{p}}% and no request in the window. Underused: below {{p}}% but with some traffic. Utilization is the DCGM average of the GPUs of the pods; traffic comes from vLLM counters.',
          { p: threshold }
        )}
      </Typography>
    </SectionBox>
  );
}
