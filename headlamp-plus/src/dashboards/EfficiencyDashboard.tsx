/** Resource efficiency: requested against used CPU and memory per workload. */
import {
  Box,
  CircularProgress,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import React from 'react';
import { Bar, cardGrid, Panel, RouteLink, Stat, StatCard } from '../overview/blocks';
import { formatCores, formatGiB, usageTone } from '../overview/clusterHealth';
import { ServicePicker } from '../overview/usePrometheus';
import {
  DAY_QUERIES,
  EffPodJson,
  idle,
  SortBy,
  sortRows,
  totals,
  usageFromMetrics,
  usageFromPrometheus,
  WorkloadRow,
  workloadRows,
} from './efficiency';
import { DashboardShell, DataTable } from './shell';
import { listStatus, useApiList } from './useApi';
import { usePromInstant } from './usePromInstant';

const ROUTES: Record<string, string> = {
  Deployment: 'Deployment',
  StatefulSet: 'StatefulSet',
  DaemonSet: 'DaemonSet',
  Job: 'Job',
  Pod: 'Pod',
};

const MAX_ROWS = 100;

type Source = 'now' | 'day';

function UsageCell({
  requested,
  used,
  format,
}: {
  requested: number;
  used?: number;
  format: (v: number) => string;
}) {
  if (used === undefined) return <>{format(requested)} requested</>;
  if (requested === 0) {
    return (
      <Typography variant="body2" component="span" color="warning.main">
        {format(used)} used, no request
      </Typography>
    );
  }
  return (
    <Box sx={{ minWidth: 140 }}>
      <Typography variant="body2" component="div">
        {format(used)} / {format(requested)}{' '}
        <Box component="span" sx={{ color: 'text.secondary' }}>
          ({Math.round((used / requested) * 100)}%)
        </Box>
      </Typography>
      <Bar value={used} total={requested} tone={usageTone(used, requested)} />
    </Box>
  );
}

export function EfficiencyDashboard() {
  const [source, setSource] = React.useState<Source>('now');
  const [sortBy, setSortBy] = React.useState<SortBy>('idleCpu');
  const [namespace, setNamespace] = React.useState('');
  const pods = useApiList<EffPodJson>(
    `/api/v1/pods?fieldSelector=${encodeURIComponent('status.phase=Running')}`
  );
  const metrics = useApiList<Parameters<typeof usageFromMetrics>[0][number]>(
    source === 'now' ? '/apis/metrics.k8s.io/v1beta1/pods' : null
  );
  const day = usePromInstant([DAY_QUERIES.cpu, DAY_QUERIES.memory], source === 'day');
  const status = listStatus([['Pods', pods]]);

  const usage = React.useMemo(
    () =>
      source === 'now'
        ? metrics.data
          ? usageFromMetrics(metrics.data)
          : undefined
        : day.results
        ? usageFromPrometheus(day.results[0], day.results[1])
        : undefined,
    [source, metrics.data, day.results]
  );
  const all = React.useMemo(
    () => workloadRows(pods.data ?? [], usage ?? new Map()),
    [pods.data, usage]
  );
  const namespaces = [...new Set(all.map(r => r.namespace))].sort();
  const rows = sortRows(
    all.filter(r => !namespace || r.namespace === namespace),
    sortBy
  );
  const sum = totals(rows);
  const usageReady = !!usage;
  const idleCpu = rows.reduce((s, r) => s + Math.max(0, idle(r, 'cpu')), 0);
  const idleMemory = rows.reduce((s, r) => s + Math.max(0, idle(r, 'memory')), 0);
  const label = source === 'now' ? 'now' : 'CPU 24h average · memory 24h peak';

  const stats: Stat[] = [
    {
      id: 'cpu',
      label: 'CPU used / requested',
      value: usageReady ? `${formatCores(sum.used.cpu)} / ${formatCores(sum.requested.cpu)}` : '—',
      caption: `cores · ${source === 'now' ? 'now' : '24h average'}`,
      icon: 'mdi:chip',
      tone: 'primary',
    },
    {
      id: 'memory',
      label: 'Memory used / requested',
      value: usageReady
        ? `${formatGiB(sum.used.memory)} / ${formatGiB(sum.requested.memory)}`
        : '—',
      caption: `GiB · ${source === 'now' ? 'now' : '24h peak'}`,
      icon: 'mdi:memory',
      tone: 'primary',
    },
    {
      id: 'idleCpu',
      label: 'Requested, unused CPU',
      value: usageReady ? formatCores(idleCpu) : '—',
      caption: 'cores held by requests',
      icon: 'mdi:chip',
      tone: 'info',
    },
    {
      id: 'idleMemory',
      label: 'Requested, unused memory',
      value: usageReady ? formatGiB(idleMemory) : '—',
      caption: 'GiB held by requests',
      icon: 'mdi:memory',
      tone: 'info',
    },
    {
      id: 'noRequests',
      label: 'Without requests',
      value: pods.data ? sum.withoutRequests : '—',
      caption: 'workloads the scheduler cannot plan for',
      icon: 'mdi:help-box-outline',
      tone: sum.withoutRequests > 0 ? 'warning' : 'success',
    },
  ];

  const usageMissing =
    source === 'now' ? metrics.data === null : day.prom.status === 'missing' || !!day.error;

  return (
    <DashboardShell
      icon="mdi:tune-variant"
      title="Resource efficiency"
      subtitle="What workloads request and what they use, to size requests right"
      issues={[]}
      {...status}
    >
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={source}
          onChange={(_, v) => v && setSource(v)}
          aria-label="Usage source"
        >
          <ToggleButton value="now">Now (metrics API)</ToggleButton>
          <ToggleButton value="day">Last 24 hours (Prometheus)</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select
          size="small"
          label="Namespace"
          value={namespace}
          onChange={e => setNamespace(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All namespaces</MenuItem>
          {namespaces.map(ns => (
            <MenuItem key={ns} value={ns}>
              {ns}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Sort by"
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="idleCpu">Unused requested CPU</MenuItem>
          <MenuItem value="idleMemory">Unused requested memory</MenuItem>
          <MenuItem value="cpu">CPU used</MenuItem>
          <MenuItem value="memory">Memory used</MenuItem>
        </TextField>
      </Box>
      <Box sx={cardGrid(200)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>
      <Panel title="Workloads" icon="mdi:tune-variant">
        {source === 'day' && day.prom.status === 'missing' ? (
          <ServicePicker onChoose={day.choose} needs="the kubelet's cAdvisor metrics" />
        ) : usageMissing ? (
          <Typography variant="body2" color="text.secondary">
            {source === 'now'
              ? 'Usage needs the metrics API (metrics-server), which is not available. Try the last 24 hours from Prometheus.'
              : day.error}
          </Typography>
        ) : !usageReady || !pods.data ? (
          <CircularProgress size={20} />
        ) : (
          <>
            <DataTable<WorkloadRow>
              rows={rows.slice(0, MAX_ROWS)}
              rowKey={r => `${r.kind}/${r.namespace}/${r.name}`}
              empty="No running workload."
              maxHeight={560}
              columns={[
                {
                  label: 'Workload',
                  render: r =>
                    ROUTES[r.kind] ? (
                      <RouteLink
                        to={{
                          route: ROUTES[r.kind],
                          params: { namespace: r.namespace, name: r.name },
                        }}
                      >
                        {r.name}
                      </RouteLink>
                    ) : (
                      r.name
                    ),
                },
                { label: 'Kind', render: r => r.kind },
                { label: 'Namespace', render: r => r.namespace },
                { label: 'Pods', align: 'right', render: r => r.pods },
                {
                  label: 'CPU (cores)',
                  render: r => (
                    <UsageCell
                      requested={r.requested.cpu}
                      used={r.used?.cpu}
                      format={formatCores}
                    />
                  ),
                },
                {
                  label: 'Memory (GiB)',
                  render: r => (
                    <UsageCell
                      requested={r.requested.memory}
                      used={r.used?.memory}
                      format={formatGiB}
                    />
                  ),
                },
              ]}
            />
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
              Usage: {label}. Running pods only
              {rows.length > MAX_ROWS ? `; the first ${MAX_ROWS} of ${rows.length} workloads` : ''}.
              A short sample can miss peaks: check the last 24 hours before lowering a request.
            </Typography>
          </>
        )}
      </Panel>
    </DashboardShell>
  );
}
