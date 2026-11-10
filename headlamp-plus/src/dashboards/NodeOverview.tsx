/**
 * Node dashboard, shown at the top of Headlamp's node page: allocation against what the node can
 * allocate, usage, conditions and taints, the heaviest pods and the usage trend.
 */
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import {
  Bar,
  cardGrid,
  Panel,
  percent,
  RouteLink,
  rowSx,
  Stat,
  StatCard,
  twoColumns,
} from '../overview/blocks';
import {
  formatCores,
  formatGiB,
  isNodeReady,
  Issue,
  MetricsJson,
  nodeIssues,
  nodeRoles,
  parseCpu,
  parseMemory,
  podIssues,
  PodJson,
  usageTone,
} from '../overview/clusterHealth';
import { UsageTrends } from '../overview/UsageTrends';
import { usageFromMetrics } from './efficiency';
import {
  heaviest,
  nodeAllocation,
  NodeDetailJson,
  NodePodJson,
  podLoads,
  taintLabel,
} from './node';
import { AttentionPanel, DashboardShell } from './shell';
import { listStatus, useApiGet, useApiList } from './useApi';

function AllocationRow({
  label,
  requested,
  limits,
  used,
  total,
  format,
  unit,
}: {
  label: string;
  requested: number;
  limits: number;
  used?: number;
  total: number;
  format: (v: number) => string;
  unit: string;
}) {
  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {format(requested)} requested · {format(limits)} limits
          {used !== undefined ? ` · ${format(used)} used` : ''} of {format(total)} {unit}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
          {percent(requested, total)}
        </Typography>
      </Box>
      <Bar value={requested} total={total} tone={usageTone(requested, total)} />
      {limits > total && (
        <Typography variant="caption" color="warning.main">
          Limits are {percent(limits, total)} of allocatable: pods can compete for it under load.
        </Typography>
      )}
    </Box>
  );
}

export function NodeOverview({ node }: { node: NodeDetailJson }) {
  const name = node.metadata?.name ?? '';
  const pods = useApiList<NodePodJson & PodJson>(
    `/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${name}`)}`
  );
  const nodeMetrics = useApiGet<MetricsJson>(
    `/apis/metrics.k8s.io/v1beta1/nodes/${encodeURIComponent(name)}`
  );
  const podMetrics = useApiList<Parameters<typeof usageFromMetrics>[0][number]>(
    '/apis/metrics.k8s.io/v1beta1/pods'
  );
  const status = listStatus([['Pods', pods]]);
  const podList = pods.data ?? [];
  const allocation = nodeAllocation(node, podList);
  const used = nodeMetrics.data
    ? {
        cpu: parseCpu(nodeMetrics.data.usage?.cpu),
        memory: parseMemory(nodeMetrics.data.usage?.memory),
      }
    : undefined;
  const usage = React.useMemo(
    () => (podMetrics.data ? usageFromMetrics(podMetrics.data) : undefined),
    [podMetrics.data]
  );
  const loads = podLoads(podList, usage);
  const issues: Issue[] = React.useMemo(
    () => [
      ...nodeIssues(node),
      ...podList.flatMap(p =>
        podIssues(p).map(issue => ({
          ...issue,
          link: { route: 'Pod', params: { namespace: issue.namespace ?? '', name: issue.name } },
        }))
      ),
    ],
    // podList follows from pods.data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, pods.data]
  );
  const ready = isNodeReady(node);
  const taints = node.spec?.taints ?? [];
  const metricsMissing = nodeMetrics.data === null;

  const stats: Stat[] = [
    {
      id: 'cpu',
      label: 'CPU requested',
      value: pods.data ? percent(allocation.requests.cpu, allocation.allocatable.cpu) : '—',
      caption: `${formatCores(allocation.requests.cpu)} of ${formatCores(
        allocation.allocatable.cpu
      )} cores`,
      icon: 'mdi:chip',
      tone: usageTone(allocation.requests.cpu, allocation.allocatable.cpu),
    },
    {
      id: 'memory',
      label: 'Memory requested',
      value: pods.data ? percent(allocation.requests.memory, allocation.allocatable.memory) : '—',
      caption: `${formatGiB(allocation.requests.memory)} of ${formatGiB(
        allocation.allocatable.memory
      )} GiB`,
      icon: 'mdi:memory',
      tone: usageTone(allocation.requests.memory, allocation.allocatable.memory),
    },
    {
      id: 'pods',
      label: 'Pods',
      value: pods.data ? `${allocation.pods}/${allocation.allocatable.pods}` : '—',
      caption: 'running or pending of the pod limit',
      icon: 'mdi:cube-outline',
      tone: usageTone(allocation.pods, allocation.allocatable.pods),
    },
    {
      id: 'cpuUsed',
      label: 'CPU used',
      value: used ? percent(used.cpu, allocation.allocatable.cpu) : '—',
      caption: used
        ? `${formatCores(used.cpu)} cores`
        : metricsMissing
        ? 'Needs the metrics API'
        : 'Loading…',
      icon: 'mdi:speedometer',
      tone: used ? usageTone(used.cpu, allocation.allocatable.cpu) : 'info',
    },
    {
      id: 'memoryUsed',
      label: 'Memory used',
      value: used ? percent(used.memory, allocation.allocatable.memory) : '—',
      caption: used
        ? `${formatGiB(used.memory)} GiB`
        : metricsMissing
        ? 'Needs the metrics API'
        : 'Loading…',
      icon: 'mdi:speedometer',
      tone: used ? usageTone(used.memory, allocation.allocatable.memory) : 'info',
    },
  ];

  const heavy = (by: 'cpu' | 'memory', format: (v: number) => string, title: string) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {heaviest(loads, by).map(l => (
        <Box key={`${l.namespace}/${l.name}`} sx={{ display: 'flex', gap: 1, ...rowSx }}>
          <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            <RouteLink to={{ route: 'Pod', params: { namespace: l.namespace, name: l.name } }}>
              {l.name}
            </RouteLink>
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {format(l.used?.[by] ?? l.requests[by])}
          </Typography>
        </Box>
      ))}
    </Box>
  );

  return (
    <DashboardShell
      inset
      icon="mdi:server"
      title={name}
      subtitle={[
        'Node overview',
        nodeRoles(node).join(', '),
        ready ? 'Ready' : 'Not ready',
        node.spec?.unschedulable ? 'cordoned' : '',
      ]
        .filter(Boolean)
        .join(' · ')}
      issues={issues}
      {...status}
    >
      <Box sx={cardGrid(200)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>
      <Box sx={twoColumns}>
        <AttentionPanel
          issues={issues}
          pending={status.pending}
          emptyText="The node is ready without pressure and no pod on it is failing."
        />
        <Panel title="Allocation" icon="mdi:gauge">
          <AllocationRow
            label="CPU"
            requested={allocation.requests.cpu}
            limits={allocation.limits.cpu}
            used={used?.cpu}
            total={allocation.allocatable.cpu}
            format={formatCores}
            unit="cores"
          />
          <AllocationRow
            label="Memory"
            requested={allocation.requests.memory}
            limits={allocation.limits.memory}
            used={used?.memory}
            total={allocation.allocatable.memory}
            format={formatGiB}
            unit="GiB"
          />
          <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 0.5 }}>
            Taints
          </Typography>
          {taints.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              None: any pod can be scheduled here.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {taints.map(t => (
                <Chip key={taintLabel(t)} size="small" variant="outlined" label={taintLabel(t)} />
              ))}
            </Box>
          )}
        </Panel>
      </Box>
      <Panel
        title={usage ? 'Heaviest pods (used)' : 'Heaviest pods (requested)'}
        icon="mdi:sort-descending"
      >
        {loads.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {pods.data ? 'No pod runs on this node.' : 'Loading…'}
          </Typography>
        ) : (
          <Box sx={cardGrid(220)}>
            {heavy('cpu', formatCores, 'CPU (cores)')}
            {heavy('memory', formatGiB, 'Memory (GiB)')}
          </Box>
        )}
      </Panel>
      <UsageTrends
        node={name}
        cpuCapacity={allocation.allocatable.cpu || undefined}
        memoryCapacity={allocation.allocatable.memory || undefined}
        capacityLabel="allocatable"
      />
    </DashboardShell>
  );
}
