import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Chip, Collapse, Grid, Link, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { Discovery, isStackInstalled, locationsOf } from '../../api/discovery';
import { t } from '../../common/i18n';
import { CopyableCode } from '../../components/common/CopyableCode';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { useResourceList } from '../../hooks/useLive';
import { usePrometheus } from '../../hooks/usePrometheus';
import { RESOURCE_LIST, StackInfo, STACKS } from '../../resources/definitions';
import { gpuDraDrivers, ResourceSliceJson, totals } from '../../resources/gpu';

const STACK_ICONS: Record<string, string> = {
  kserve: 'mdi:rocket-launch-outline',
  inference: 'mdi:routes',
  gatewayApi: 'mdi:gate',
  nvidia: 'mdi:expansion-card',
  dra: 'mdi:chip',
  lws: 'mdi:account-group-outline',
};

function StackCard({
  stack,
  discovery,
  installedOverride,
  note,
}: {
  stack: StackInfo;
  discovery: Discovery;
  /** Replaces the API based check for stacks whose API exists without the product. */
  installedOverride?: boolean;
  note?: string;
}) {
  const installed = installedOverride ?? isStackInstalled(discovery, stack.id);
  const [showHint, setShowHint] = React.useState(false);
  const served = RESOURCE_LIST.filter(r => r.stack === stack.id).flatMap(r =>
    locationsOf(discovery, r.id).map(l => ({ kind: r.kind, apiVersion: l.apiVersion }))
  );

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            p: 1,
            borderRadius: 1,
            bgcolor: installed ? 'success.main' : 'action.selected',
            color: installed ? 'success.contrastText' : 'text.secondary',
          }}
        >
          <Icon icon={STACK_ICONS[stack.id] || 'mdi:puzzle-outline'} width={22} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {stack.name}
          </Typography>
        </Box>
        <Chip
          size="small"
          color={installed ? 'success' : stack.optional ? 'default' : 'warning'}
          variant={installed ? 'filled' : 'outlined'}
          label={installed ? t('Installed') : stack.optional ? t('Optional') : t('Not installed')}
        />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t(stack.description)}
      </Typography>
      {note && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {note}
        </Typography>
      )}
      <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {served.map(s => (
          <Tooltip key={`${s.kind}-${s.apiVersion}`} title={s.apiVersion}>
            <Chip
              size="small"
              variant="outlined"
              label={`${s.kind} · ${s.apiVersion.split('/')[1]}`}
            />
          </Tooltip>
        ))}
      </Box>
      {!installed && (
        <Box sx={{ mt: 'auto', pt: 1 }}>
          <Button
            size="small"
            onClick={() => setShowHint(v => !v)}
            startIcon={<Icon icon={showHint ? 'mdi:chevron-up' : 'mdi:chevron-down'} />}
          >
            {t('How to install')}
          </Button>
          <Collapse in={showHint}>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t(stack.installHint)}
            </Typography>
            {stack.installCommand && <CopyableCode code={stack.installCommand} />}
            <Link href={stack.docsUrl} target="_blank" rel="noopener noreferrer" variant="body2">
              {t('Installation guide')}
            </Link>
          </Collapse>
        </Box>
      )}
    </Paper>
  );
}

/** The DRA API is built into Kubernetes; the stack counts as installed only with a GPU driver. */
function DraStackCard({ stack, discovery }: { stack: StackInfo; discovery: Discovery }) {
  const served = isStackInstalled(discovery, 'dra');
  const slices = useResourceList<ResourceSliceJson>('resourceslices', served ? {} : null, 60000);
  const drivers = gpuDraDrivers(slices.items);
  let note: string | undefined;
  if (served && !slices.loading && drivers.length === 0) {
    note = slices.forbidden
      ? t('The DRA API is available, but you cannot list ResourceSlices to check for a GPU driver.')
      : t('The Kubernetes DRA API is available, but no GPU DRA driver publishes devices.');
  } else if (drivers.length) {
    note = t('Drivers: {{d}}', { d: drivers.join(', ') });
  }
  return (
    <StackCard
      stack={stack}
      discovery={discovery}
      installedOverride={served && drivers.length > 0}
      note={note}
    />
  );
}

function SignalCard({
  icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: string;
  title: string;
  value: string;
  detail: string;
  tone: 'success' | 'warning' | 'default';
}) {
  const color =
    tone === 'success' ? 'success.main' : tone === 'warning' ? 'warning.main' : 'text.secondary';
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color }}>
        <Icon icon={icon} width={20} />
        <Typography variant="subtitle2" color="text.primary">
          {title}
        </Typography>
      </Box>
      <Typography variant="h5" sx={{ mt: 1 }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
    </Paper>
  );
}

function GpuNodesSignal() {
  const fleet = useGpuFleet({ withMetrics: false });
  if (fleet.nodesForbidden) {
    return (
      <SignalCard
        icon="mdi:expansion-card-variant"
        title={t('GPU nodes')}
        value="—"
        detail={t('Not allowed to list nodes')}
        tone="default"
      />
    );
  }
  const sum = totals(fleet.nodes);
  return (
    <SignalCard
      icon="mdi:expansion-card-variant"
      title={t('GPU nodes')}
      value={fleet.loading && !fleet.nodes.length ? '…' : String(sum.nodes)}
      detail={
        fleet.loading && !fleet.nodes.length
          ? t('Reading nodes…')
          : t('{{gpus}} schedulable GPU devices', { gpus: sum.allocatable })
      }
      tone={sum.nodes > 0 ? 'success' : 'warning'}
    />
  );
}

function MetricsSignal() {
  const prom = usePrometheus();
  const map = {
    off: { value: t('Disabled'), detail: t('Enable it in Settings'), tone: 'default' as const },
    loading: { value: '…', detail: t('Looking for Prometheus…'), tone: 'default' as const },
    unavailable: {
      value: t('Not found'),
      detail: t('Configure an endpoint in Settings'),
      tone: 'warning' as const,
    },
    ready: {
      value: t('Connected'),
      detail: prom.status === 'ready' ? prom.endpoint.label : '',
      tone: 'success' as const,
    },
  }[prom.status];
  return <SignalCard icon="mdi:chart-timeline-variant" title={t('Metrics')} {...map} />;
}

export function PlatformReadiness({
  discovery,
  onRescan,
  rescanning,
}: {
  discovery: Discovery;
  onRescan: () => void;
  rescanning: boolean;
}) {
  return (
    <SectionBox
      title={t('Platform readiness')}
      headerProps={{
        titleSideActions: [
          <Button
            key="rescan"
            size="small"
            onClick={onRescan}
            disabled={rescanning}
            startIcon={<Icon icon="mdi:refresh" />}
          >
            {rescanning ? t('Scanning…') : t('Rescan APIs')}
          </Button>,
        ],
      }}
    >
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <GpuNodesSignal />
        </Grid>
        <Grid item xs={12} sm={6}>
          <MetricsSignal />
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0 }}>
        {STACKS.map(stack => (
          <Grid key={stack.id} item xs={12} md={6} xl={4}>
            {stack.id === 'dra' ? (
              <DraStackCard stack={stack} discovery={discovery} />
            ) : (
              <StackCard stack={stack} discovery={discovery} />
            )}
          </Grid>
        ))}
      </Grid>
      {discovery.warnings.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
          {t('Some API versions could not be read: {{w}}', { w: discovery.warnings.join('; ') })}
        </Typography>
      )}
    </SectionBox>
  );
}
