import { Icon } from '@iconify/react';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Grid, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { NotInstalledState } from '../../components/common/NotInstalledState';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { podHealth, PodJson } from '../../resources/pod';
import { Condition, KubeJson } from '../../resources/types';
import { classifyConditions, HealthSummary } from '../../utils/health';

interface ClusterPolicyJson extends KubeJson {
  spec?: Record<
    string,
    { enabled?: boolean; version?: string; image?: string; strategy?: string } | undefined
  >;
  status?: { state?: string; namespace?: string; conditions?: Condition[] };
}

interface NvidiaDriverJson extends KubeJson {
  spec?: { driverType?: string; version?: string; nodeSelector?: Record<string, string> };
  status?: { state?: string; conditions?: Condition[] };
}

/** Operands of the GPU Operator and whether they are enabled when not set explicitly. */
const COMPONENTS: Array<{ key: string; label: string; defaultEnabled: boolean }> = [
  { key: 'driver', label: 'Driver', defaultEnabled: true },
  { key: 'toolkit', label: 'Container toolkit', defaultEnabled: true },
  { key: 'devicePlugin', label: 'Device plugin', defaultEnabled: true },
  { key: 'gfd', label: 'GPU feature discovery', defaultEnabled: true },
  { key: 'dcgmExporter', label: 'DCGM exporter', defaultEnabled: true },
  { key: 'dcgm', label: 'DCGM host engine', defaultEnabled: false },
  { key: 'migManager', label: 'MIG manager', defaultEnabled: true },
  { key: 'nodeStatusExporter', label: 'Node status exporter', defaultEnabled: false },
  { key: 'validator', label: 'Validator', defaultEnabled: true },
  { key: 'gds', label: 'GPUDirect Storage', defaultEnabled: false },
  { key: 'gdrcopy', label: 'GDRCopy', defaultEnabled: false },
  { key: 'cdi', label: 'CDI', defaultEnabled: false },
  { key: 'sandboxWorkloads', label: 'Sandbox workloads', defaultEnabled: false },
  { key: 'vgpuManager', label: 'vGPU manager', defaultEnabled: false },
];

export function policyHealth(policy: ClusterPolicyJson): HealthSummary {
  switch (policy.status?.state) {
    case 'ready':
      return { health: 'ready', reason: 'ready' };
    case 'notReady': {
      const fromConditions = classifyConditions(policy.status?.conditions);
      return {
        health: fromConditions.health === 'failed' ? 'failed' : 'progressing',
        reason: fromConditions.reason || 'notReady',
        message: fromConditions.message,
      };
    }
    case 'disabled':
    case 'ignored':
      return { health: 'stopped', reason: policy.status.state };
    default:
      return { health: 'unknown', reason: policy.status?.state };
  }
}

function OperandPods({ namespace }: { namespace: string }) {
  const pods = useCoreList<PodJson>('v1', 'pods', true, { namespace }, 30000);
  if (pods.forbidden || pods.items.length === 0) return null;
  const groups = new Map<string, PodJson[]>();
  for (const pod of pods.items) {
    const app =
      pod.metadata.labels?.app ||
      pod.metadata.labels?.['app.kubernetes.io/component'] ||
      pod.metadata.labels?.['app.kubernetes.io/name'] ||
      pod.metadata.name.replace(/-[a-z0-9]{5}$/, '');
    groups.set(app, [...(groups.get(app) || []), pod]);
  }
  const rows = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('Operator pods in {{ns}}', { ns: namespace })}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {rows.map(([app, list]) => {
          const healths = list.map(podHealth);
          const failed = healths.filter(h => h.health === 'failed').length;
          const ready = healths.filter(h => h.health === 'ready' || h.health === 'stopped').length;
          return (
            <Tooltip
              key={app}
              title={failed ? healths.find(h => h.health === 'failed')?.reason || '' : ''}
            >
              <Chip
                size="small"
                variant="outlined"
                color={failed ? 'error' : ready === list.length ? 'success' : 'info'}
                icon={<Icon icon={failed ? 'mdi:alert-circle' : 'mdi:check-circle-outline'} />}
                label={`${app} ${ready}/${list.length}`}
              />
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}

export function GpuOperatorPanel() {
  const policies = useResourceList<ClusterPolicyJson>('clusterpolicies', {}, 30000);
  const drivers = useResourceList<NvidiaDriverJson>('nvidiadrivers', {}, 30000);

  if (policies.notInstalled && drivers.notInstalled) {
    return (
      <SectionBox title={t('NVIDIA GPU Operator')}>
        <NotInstalledState
          resources={['clusterpolicies']}
          title={t('The NVIDIA GPU Operator is not installed')}
        />
      </SectionBox>
    );
  }

  return (
    <SectionBox title={t('NVIDIA GPU Operator')}>
      {policies.items.length === 0 && !policies.loading && (
        <Typography variant="body2" color="text.secondary">
          {policies.forbidden
            ? t('You are not allowed to read ClusterPolicy objects.')
            : t('The operator CRDs are installed but no ClusterPolicy exists.')}
        </Typography>
      )}
      <Grid container spacing={2}>
        {policies.items.map(policy => {
          const namespace = policy.status?.namespace;
          return (
            <Grid item xs={12} key={policy.metadata.name}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <Icon icon="simple-icons:nvidia" width={28} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    <Link
                      routeName="customresource"
                      params={{
                        crd: 'clusterpolicies.nvidia.com',
                        namespace: '-',
                        crName: policy.metadata.name,
                      }}
                    >
                      {policy.metadata.name}
                    </Link>
                  </Typography>
                  <StatusBadge summary={policyHealth(policy)} />
                  {namespace && (
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={<Icon icon="mdi:folder-outline" />}
                      label={namespace}
                    />
                  )}
                  {policy.spec?.mig?.strategy && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t('MIG strategy: {{s}}', { s: policy.spec.mig.strategy })}
                    />
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
                  {COMPONENTS.map(c => {
                    const spec = policy.spec?.[c.key];
                    const enabled = spec?.enabled ?? c.defaultEnabled;
                    const version = spec?.version;
                    return (
                      <Tooltip
                        key={c.key}
                        title={
                          spec?.enabled === undefined
                            ? t('Not set; operator default')
                            : version
                            ? t('Version {{v}}', { v: version })
                            : ''
                        }
                      >
                        <Chip
                          size="small"
                          variant={enabled ? 'filled' : 'outlined'}
                          icon={<Icon icon={enabled ? 'mdi:check' : 'mdi:minus'} />}
                          label={version ? `${t(c.label)} ${version}` : t(c.label)}
                          sx={enabled ? undefined : { color: 'text.secondary' }}
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
                {namespace && <OperandPods namespace={namespace} />}
              </Paper>
            </Grid>
          );
        })}
      </Grid>
      {drivers.items.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('NVIDIADriver objects')}
          </Typography>
          <SimpleTable
            data={drivers.items}
            columns={[
              { label: t('Name'), getter: (d: NvidiaDriverJson) => d.metadata.name },
              { label: t('Type'), getter: (d: NvidiaDriverJson) => d.spec?.driverType || 'gpu' },
              { label: t('Version'), getter: (d: NvidiaDriverJson) => d.spec?.version || '—' },
              {
                label: t('Node selector'),
                getter: (d: NvidiaDriverJson) =>
                  Object.entries(d.spec?.nodeSelector || {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ') || t('All GPU nodes'),
              },
              {
                label: t('Status'),
                getter: (d: NvidiaDriverJson) => (
                  <StatusBadge
                    summary={
                      d.status?.state === 'ready'
                        ? { health: 'ready' }
                        : classifyConditions(d.status?.conditions, {
                            createdAt: d.metadata.creationTimestamp,
                          })
                    }
                  />
                ),
              },
            ]}
          />
        </Box>
      )}
    </SectionBox>
  );
}
