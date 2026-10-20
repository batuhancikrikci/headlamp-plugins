import { Icon } from '@iconify/react';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Grid, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { DCGM_RANGE_QUERIES, metricsForNode, NodeGpuMetrics } from '../../api/dcgm';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '../../common/States';
import { TimeSeriesChart, toPoints } from '../../components/charts/TimeSeriesChart';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { ExpandableTable } from '../../components/common/ExpandableTable';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { UsageBar } from '../../components/common/UsageBar';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { usePromRange } from '../../hooks/usePromQuery';
import { GpuNode, GpuWorkload, physicalGpus, sharingLabel, totals } from '../../resources/gpu';
import { DETAIL_PAGES } from '../../routes';
import { formatBytes } from '../../utils/quantity';
import { GpuOperatorPanel } from './GpuOperatorPanel';

const MIB = 2 ** 20;

function shortResource(name: string) {
  return name.replace('nvidia.com/', '');
}

export function NodeStatusChip({ node }: { node: GpuNode }) {
  if (!node.ready)
    return <Chip size="small" color="error" variant="outlined" label={t('Not ready')} />;
  if (node.unschedulable)
    return <Chip size="small" color="warning" variant="outlined" label={t('Cordoned')} />;
  return <Chip size="small" color="success" variant="outlined" label={t('Ready')} />;
}

export function ResourceBars({ node }: { node: GpuNode }) {
  if (node.resources.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {node.draDevices.length ? t('{{n}} DRA devices', { n: node.draDevices.length }) : '—'}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {node.resources.map(r => (
        <UsageBar
          key={r.name}
          used={r.requested}
          total={r.allocatable}
          width={100}
          label={`${r.requested} / ${r.allocatable}${
            node.resources.length > 1 || r.name !== 'nvidia.com/gpu'
              ? ` ${shortResource(r.name)}`
              : ''
          }`}
          tooltip={t('{{r}}: {{req}} requested of {{alloc}} allocatable ({{cap}} capacity)', {
            r: r.name,
            req: r.requested,
            alloc: r.allocatable,
            cap: r.capacity,
          })}
        />
      ))}
    </Box>
  );
}

function MetricsCell({ metrics }: { metrics?: NodeGpuMetrics }) {
  if (!metrics) return <>—</>;
  const { util, memUsedMiB, memFreeMiB, tempC, powerW } = metrics.avg;
  const memTotal = (memUsedMiB ?? 0) + (memFreeMiB ?? 0);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {util !== undefined && (
        <UsageBar used={util} total={100} width={70} label={`${Math.round(util)}%`} />
      )}
      <Typography variant="caption" color="text.secondary">
        {[
          memTotal > 0
            ? `${formatBytes((memUsedMiB ?? 0) * MIB, 0)} / ${formatBytes(memTotal * MIB, 0)}`
            : '',
          tempC !== undefined ? `${Math.round(tempC)}°C` : '',
          powerW !== undefined ? `${Math.round(powerW)} W` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
    </Box>
  );
}

export function WorkloadLink({ w }: { w: GpuWorkload }) {
  if (w.endpoint) {
    return (
      <Link
        routeName={DETAIL_PAGES.endpoint.name}
        params={{
          slug: w.endpoint.kind === 'LLMInferenceService' ? 'llm' : 'isvc',
          namespace: w.namespace,
          name: w.endpoint.name,
        }}
      >
        {w.endpoint.name}
      </Link>
    );
  }
  return <>{w.owner ? `${w.owner.kind}/${w.owner.name}` : '—'}</>;
}

export function WorkloadsTable({ workloads }: { workloads: GpuWorkload[] }) {
  if (workloads.length === 0) {
    return <EmptyState dense icon="mdi:sleep" title={t('No pods are using GPUs')} />;
  }
  return (
    <SimpleTable
      data={workloads}
      columns={[
        {
          label: t('Pod'),
          getter: (w: GpuWorkload) => (
            <Link routeName="pod" params={{ namespace: w.namespace, name: w.pod }}>
              {w.pod}
            </Link>
          ),
        },
        { label: t('Namespace'), getter: (w: GpuWorkload) => w.namespace },
        { label: t('Model endpoint / owner'), getter: (w: GpuWorkload) => <WorkloadLink w={w} /> },
        {
          label: t('Devices'),
          getter: (w: GpuWorkload) =>
            Object.entries(w.requests)
              .map(([k, v]) => `${v} × ${shortResource(k)}`)
              .join(', '),
        },
        {
          label: t('Node'),
          getter: (w: GpuWorkload) =>
            w.node ? (
              <Link routeName="node" params={{ name: w.node }}>
                {w.node}
              </Link>
            ) : (
              <Chip size="small" color="warning" variant="outlined" label={t('Pending')} />
            ),
        },
        { label: t('Phase'), getter: (w: GpuWorkload) => w.phase || '—' },
      ]}
    />
  );
}

/** Per-GPU metrics and workloads of one node (table detail panel and Node page section). */
export function NodeGpuDetails({ node, metrics }: { node: GpuNode; metrics?: NodeGpuMetrics }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {node.family && <Chip size="small" label={t('Architecture: {{f}}', { f: node.family })} />}
        {node.computeCapability && (
          <Chip size="small" label={t('Compute capability {{c}}', { c: node.computeCapability })} />
        )}
        {node.driverVersion && (
          <Chip size="small" label={t('Driver {{v}}', { v: node.driverVersion })} />
        )}
        {node.cudaVersion && <Chip size="small" label={t('CUDA {{v}}', { v: node.cudaVersion })} />}
        {node.migCapable && (
          <Chip
            size="small"
            label={
              node.migConfig
                ? t('MIG config: {{c}} ({{s}})', {
                    c: node.migConfig,
                    s: node.migConfigState || 'unknown',
                  })
                : t('MIG capable')
            }
            color={node.migConfigState === 'failed' ? 'error' : 'default'}
          />
        )}
      </Box>
      {metrics && metrics.gpus.length > 0 && (
        <SimpleTable
          data={metrics.gpus}
          columns={[
            { label: t('GPU'), getter: g => g.id },
            { label: t('Model'), getter: g => g.model || node.product || '—' },
            {
              label: t('Utilization'),
              getter: g =>
                g.util !== undefined ? (
                  <UsageBar used={g.util} total={100} width={80} label={`${Math.round(g.util)}%`} />
                ) : (
                  '—'
                ),
            },
            {
              label: t('Memory'),
              getter: g =>
                g.memUsedMiB !== undefined && g.memFreeMiB !== undefined ? (
                  <UsageBar
                    used={g.memUsedMiB}
                    total={g.memUsedMiB + g.memFreeMiB}
                    width={80}
                    label={`${formatBytes(g.memUsedMiB * MIB, 0)} / ${formatBytes(
                      (g.memUsedMiB + g.memFreeMiB) * MIB,
                      0
                    )}`}
                  />
                ) : (
                  '—'
                ),
            },
            {
              label: t('Temp.'),
              getter: g => (g.tempC !== undefined ? `${Math.round(g.tempC)}°C` : '—'),
            },
            {
              label: t('Power'),
              getter: g => (g.powerW !== undefined ? `${Math.round(g.powerW)} W` : '—'),
            },
            {
              label: t('Pod'),
              getter: g => (g.pod ? `${g.namespace}/${g.pod}` : '—'),
            },
          ]}
        />
      )}
      {node.draDevices.length > 0 && (
        <SimpleTable
          data={node.draDevices}
          columns={[
            { label: t('DRA device'), getter: d => d.name },
            { label: t('Type'), getter: d => d.type || '—' },
            { label: t('Product'), getter: d => d.product || '—' },
            {
              label: t('Memory'),
              getter: d => (d.memoryBytes ? formatBytes(d.memoryBytes, 0) : '—'),
            },
            { label: t('Driver'), getter: d => d.driver },
          ]}
        />
      )}
      <WorkloadsTable workloads={node.workloads} />
    </Box>
  );
}

interface ModelGroup {
  product: string;
  memoryMiB?: number;
  nodes: number;
  physical: number;
  allocatable: number;
  requested: number;
}

function groupByModel(nodes: GpuNode[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const n of nodes) {
    const product = n.product || t('Unknown GPU');
    const g = groups.get(product) || {
      product,
      memoryMiB: n.memoryMiB,
      nodes: 0,
      physical: 0,
      allocatable: 0,
      requested: 0,
    };
    g.nodes += 1;
    g.physical += physicalGpus(n);
    g.allocatable += n.resources.reduce((s, r) => s + r.allocatable, 0);
    g.requested += n.resources.reduce((s, r) => s + r.requested, 0);
    groups.set(product, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.allocatable - a.allocatable);
}

function UtilizationCharts({ available }: { available: boolean }) {
  const util = usePromRange(available ? DCGM_RANGE_QUERIES.util : null, 3600, 60);
  const memory = usePromRange(available ? DCGM_RANGE_QUERIES.memory : null, 3600, 60);
  if (!available) return null;
  return (
    <Grid container spacing={2} sx={{ mb: 2 }}>
      <Grid item xs={12} md={6}>
        <TimeSeriesChart
          title={t('Average GPU utilization (1h)')}
          points={toPoints(util.data)}
          unit="%"
          max={100}
          format={v => v.toFixed(0)}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <TimeSeriesChart
          title={t('GPU memory in use (1h)')}
          points={toPoints(memory.data)}
          unit="%"
          max={100}
          format={v => v.toFixed(0)}
        />
      </Grid>
    </Grid>
  );
}

function MetricsNotice({ fleet }: { fleet: ReturnType<typeof useGpuFleet> }) {
  if (fleet.dcgmAvailable) return null;
  const { prometheus } = fleet;
  let message: string;
  if (prometheus.status === 'off') message = t('Metrics are disabled in Settings.');
  else if (prometheus.status === 'unavailable')
    message = t('No Prometheus endpoint: {{r}}', { r: prometheus.reason });
  else if (prometheus.status === 'loading' || !fleet.metrics) return null;
  else
    message = t(
      'Prometheus has no DCGM_FI_DEV_* series. Enable the GPU Operator DCGM exporter and its ServiceMonitor.'
    );
  return (
    <Alert severity="info" sx={{ mb: 2 }} icon={<Icon icon="mdi:chart-line" />}>
      {t('Live GPU utilization is not available. {{m}}', { m: message })}
    </Alert>
  );
}

function GpuFleetContent() {
  const fleet = useGpuFleet();
  const { nodes } = fleet;
  const sum = totals(nodes);
  const avgUtil = React.useMemo(() => {
    if (!fleet.metrics) return undefined;
    const values = Array.from(fleet.metrics.values())
      .flatMap(m => m.gpus.map(g => g.util))
      .filter((v): v is number => v !== undefined);
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined;
  }, [fleet.metrics]);
  const workloads = nodes.flatMap(n => n.workloads);

  if (fleet.nodesForbidden) {
    return (
      <SectionBox title={t('GPU Fleet')}>
        <ForbiddenState what={t('nodes')} />
      </SectionBox>
    );
  }
  if (fleet.loading && nodes.length === 0)
    return <LoadingState title={t('Reading GPU inventory…')} />;
  if (fleet.nodesError && nodes.length === 0) {
    return (
      <SectionBox title={t('GPU Fleet')}>
        <ErrorState error={fleet.nodesError} />
      </SectionBox>
    );
  }

  return (
    <>
      <SectionBox title={t('GPU Fleet')}>
        <SummaryTiles
          tiles={[
            {
              id: 'nodes',
              label: t('GPU nodes'),
              value: sum.nodes,
              icon: 'mdi:server',
              color: 'primary.main',
            },
            {
              id: 'physical',
              label: t('Physical GPUs'),
              value: sum.physical,
              icon: 'mdi:expansion-card-variant',
              color: 'primary.main',
            },
            {
              id: 'alloc',
              label: t('Schedulable devices'),
              value: sum.allocatable,
              icon: 'mdi:view-grid-outline',
              color: 'text.secondary',
            },
            {
              id: 'used',
              label: t('Requested'),
              value: fleet.podsForbidden ? '—' : sum.requested,
              icon: 'mdi:progress-check',
              color: 'info.main',
            },
            {
              id: 'free',
              label: t('Free'),
              value: fleet.podsForbidden ? '—' : Math.max(0, sum.allocatable - sum.requested),
              icon: 'mdi:checkbox-blank-outline',
              color: 'success.main',
            },
            {
              id: 'util',
              label: t('Avg. utilization'),
              value: avgUtil !== undefined ? `${Math.round(avgUtil)}%` : '—',
              icon: 'mdi:speedometer',
              color: 'text.secondary',
            },
          ]}
        />
        {fleet.podsForbidden && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('You cannot list pods in all namespaces, so requested and free GPUs are unknown.')}
          </Alert>
        )}
        <MetricsNotice fleet={fleet} />
        <UtilizationCharts available={fleet.dcgmAvailable} />

        {nodes.length === 0 ? (
          <EmptyState
            icon="mdi:expansion-card-variant"
            title={t('No GPU nodes found')}
            description={t(
              'No node advertises nvidia.com/gpu (or MIG / shared GPU resources), carries GPU Feature Discovery labels or has DRA GPU devices. Install the NVIDIA GPU Operator on clusters with NVIDIA GPUs.'
            )}
          />
        ) : (
          <>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              {t('Capacity by GPU model')}
            </Typography>
            <SimpleTable
              data={groupByModel(nodes)}
              columns={[
                {
                  label: t('GPU'),
                  getter: (g: ModelGroup) => (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Icon icon="simple-icons:nvidia" width={18} />
                      {g.product}
                    </Box>
                  ),
                },
                {
                  label: t('Memory per GPU'),
                  getter: (g: ModelGroup) =>
                    g.memoryMiB ? formatBytes(g.memoryMiB * MIB, 0) : '—',
                },
                { label: t('Nodes'), getter: (g: ModelGroup) => g.nodes },
                { label: t('Physical GPUs'), getter: (g: ModelGroup) => g.physical || '—' },
                {
                  label: t('Requested / schedulable'),
                  getter: (g: ModelGroup) => <UsageBar used={g.requested} total={g.allocatable} />,
                },
              ]}
            />
          </>
        )}
      </SectionBox>

      {nodes.length > 0 && (
        <SectionBox title={t('GPU nodes')}>
          <ExpandableTable<GpuNode>
            rows={nodes}
            getRowId={n => n.name}
            renderDetail={row => (
              <NodeGpuDetails node={row} metrics={metricsForNode(fleet.metrics, row.name)} />
            )}
            columns={[
              {
                id: 'name',
                header: t('Node'),
                value: n => n.name,
                render: row => (
                  <Link routeName="node" params={{ name: row.name }}>
                    {row.name}
                  </Link>
                ),
              },
              {
                id: 'product',
                header: t('GPU'),
                value: n => n.product || '',
                render: row => (
                  <Box>
                    <Typography variant="body2">{row.product || t('Unknown')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[
                        row.physicalGpus !== undefined ? `${row.physicalGpus} ×` : '',
                        row.memoryMiB ? formatBytes(row.memoryMiB * MIB, 0) : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    </Typography>
                  </Box>
                ),
              },
              {
                id: 'sharing',
                header: t('Sharing'),
                value: n => sharingLabel(n),
                render: row => (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={
                      <Icon
                        icon={
                          row.sharing === 'exclusive'
                            ? 'mdi:lock-outline'
                            : 'mdi:share-variant-outline'
                        }
                      />
                    }
                    label={sharingLabel(row)}
                  />
                ),
              },
              {
                id: 'devices',
                header: t('Requested / schedulable'),
                value: n => n.resources.reduce((s, r) => s + r.requested, 0),
                render: row => <ResourceBars node={row} />,
              },
              {
                id: 'metrics',
                header: t('Live (DCGM)'),
                value: n => metricsForNode(fleet.metrics, n.name)?.avg.util ?? -1,
                render: row => <MetricsCell metrics={metricsForNode(fleet.metrics, row.name)} />,
              },
              {
                id: 'driver',
                header: t('Driver / CUDA'),
                value: n => n.driverVersion || '',
                render: row => (
                  <Tooltip
                    title={
                      row.computeCapability
                        ? t('Compute capability {{c}}', { c: row.computeCapability })
                        : ''
                    }
                  >
                    <Typography variant="body2">
                      {row.driverVersion || '—'}
                      {row.cudaVersion ? ` / ${row.cudaVersion}` : ''}
                    </Typography>
                  </Tooltip>
                ),
              },
              { id: 'pods', header: t('GPU pods'), value: n => n.workloads.length },
              {
                id: 'status',
                header: t('Status'),
                value: n => (n.ready ? (n.unschedulable ? 'cordoned' : 'ready') : 'not-ready'),
                render: row => <NodeStatusChip node={row} />,
              },
            ]}
          />
        </SectionBox>
      )}

      {nodes.length > 0 && !fleet.podsForbidden && (
        <SectionBox title={t('GPU workloads')}>
          <WorkloadsTable workloads={workloads} />
        </SectionBox>
      )}

      <GpuOperatorPanel />
    </>
  );
}

export function GpuFleetPage() {
  return (
    <DiscoveryGate title={t('GPU Fleet')}>
      <GpuFleetContent />
    </DiscoveryGate>
  );
}
