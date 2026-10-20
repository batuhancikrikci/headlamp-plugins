/**
 * Cluster overview dashboard: how healthy the cluster is, what needs attention and how much of
 * its capacity is used, followed by Headlamp's events table. Built from cards on a grid, the
 * same way the other plugins of this repository present their overview.
 */
import { Icon } from '@iconify/react';
import { K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Link,
  ResourceListView,
  ShowHideLabel,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box, Chip, FormControlLabel, Switch, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import {
  Bar,
  cardGrid,
  DashboardHeader,
  HealthRow,
  isForbidden,
  IssueList,
  LegendDot,
  pageSx,
  Panel,
  percent,
  plural,
  rowSx,
  ScrollArea,
  Stat,
  StatCard,
  Tone,
  twoColumns,
} from './blocks';
import {
  clusterCapacity,
  formatCores,
  formatGiB,
  isNodeReady,
  Issue,
  isWorkloadHealthy,
  MetricsJson,
  nodeIssues,
  NodeJson,
  nodeRoles,
  nodeUsage,
  podIssues,
  PodJson,
  podPhases,
  sortIssues,
  usageTone,
  workloadIssues,
  WorkloadJson,
} from './clusterHealth';

const { Node, Pod, Namespace, Deployment, StatefulSet, DaemonSet } = K8s.ResourceClasses;
// Event is not part of ResourceClasses; the module is exported as a namespace.
const Event = K8s.event.default;
// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

function useKubernetesVersion(cluster: string | null): string | undefined {
  const [version, setVersion] = React.useState<string>();
  React.useEffect(() => {
    let cancelled = false;
    setVersion(undefined);
    K8s.getVersion()
      .then(info => !cancelled && setVersion(info?.gitVersion))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cluster]);
  return version;
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

function UsageRow({
  label,
  used,
  total,
  unit,
  format,
  tone,
}: {
  label: string;
  used?: number;
  total: number;
  unit: string;
  format: (value: number) => string;
  tone?: Tone | 'neutral';
}) {
  const hasUsage = used !== undefined;
  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {hasUsage ? `${format(used)} / ` : ''}
          {format(total)} {unit}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
          {hasUsage ? percent(used, total) : '—'}
        </Typography>
      </Box>
      <Bar
        value={used ?? 0}
        total={total}
        tone={tone ?? (hasUsage ? usageTone(used, total) : 'neutral')}
      />
    </Box>
  );
}

function CapacityPanel({
  nodes,
  pods,
  metrics,
  metricsUnavailable,
}: {
  nodes: NodeJson[];
  pods: PodJson[] | null;
  metrics: MetricsJson[] | null;
  metricsUnavailable: boolean;
}) {
  const capacity = clusterCapacity(nodes, metrics);
  const phases = podPhases(pods ?? []);
  const scheduled = phases.running + phases.pending + phases.unknown;
  return (
    <>
      <UsageRow
        label="CPU"
        used={capacity.cpu.used}
        total={capacity.cpu.total}
        unit="cores"
        format={formatCores}
      />
      <UsageRow
        label="Memory"
        used={capacity.memory.used}
        total={capacity.memory.total}
        unit="GiB"
        format={formatGiB}
      />
      <UsageRow
        label="Pods"
        used={pods ? scheduled : undefined}
        total={capacity.podSlots}
        unit="slots"
        format={value => String(Math.round(value))}
      />
      {metricsUnavailable && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
          CPU and memory usage need the metrics API (metrics-server), which is not available.
        </Typography>
      )}
      {pods && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.5 }}>
          <LegendDot color="success.main" label="Running" value={phases.running} />
          <LegendDot color="warning.main" label="Pending" value={phases.pending} />
          <LegendDot color="error.main" label="Failed" value={phases.failed} />
          <LegendDot color="text.disabled" label="Completed" value={phases.succeeded} />
        </Box>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

function MiniUsage({ label, used, total }: { label: string; used: number; total: number }) {
  return (
    <Box sx={{ width: 110 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label} {percent(used, total)}
      </Typography>
      <Bar value={used} total={total} tone={usageTone(used, total)} />
    </Box>
  );
}

function NodeList({ nodes, metrics }: { nodes: KubeObject[]; metrics: MetricsJson[] | null }) {
  return (
    <ScrollArea maxHeight={360}>
      {nodes.map(node => {
        const json = node.jsonData as NodeJson;
        const ready = isNodeReady(json);
        const usage = nodeUsage(json, metrics);
        return (
          <Box
            key={node.metadata.uid}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', ...rowSx }}
          >
            <Tooltip title={ready ? 'Ready' : 'Not ready'}>
              <Box sx={{ color: ready ? 'success.main' : 'error.main', display: 'flex' }}>
                <Icon icon={ready ? 'mdi:check-circle' : 'mdi:alert-circle'} width={20} />
              </Box>
            </Tooltip>
            <Box sx={{ flexGrow: 1, minWidth: 140 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Link kubeObject={node} />
                {nodeRoles(json).map(role => (
                  <Chip key={role} label={role} size="small" variant="outlined" />
                ))}
                {json.spec?.unschedulable && (
                  <Chip label="cordoned" size="small" color="warning" variant="outlined" />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {json.status?.nodeInfo?.kubeletVersion}
              </Typography>
            </Box>
            {usage && (
              <>
                <MiniUsage label="CPU" used={usage.cpu.used} total={usage.cpu.total} />
                <MiniUsage label="Memory" used={usage.memory.used} total={usage.memory.total} />
              </>
            )}
          </Box>
        );
      })}
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------------------------
// Workloads
// ---------------------------------------------------------------------------------------------

interface WorkloadGroup {
  kind: string;
  label: string;
  icon: string;
  route: string;
  items: KubeObject[] | null;
}

function WorkloadRow({ group }: { group: WorkloadGroup }) {
  const items = group.items;
  return (
    <HealthRow
      label={group.label}
      icon={group.icon}
      to={Router.createRouteURL(group.route)}
      loaded={!!items}
      total={items?.length ?? 0}
      healthy={items?.filter(item => isWorkloadHealthy(item.jsonData as WorkloadJson)).length ?? 0}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Events (same table as Headlamp's own overview)
// ---------------------------------------------------------------------------------------------

const EVENT_WARNING_SWITCH_KEY = 'EVENT_WARNING_SWITCH_FILTER_STORAGE_KEY';

type KubeEventObject = InstanceType<typeof Event>;

function EventsSection() {
  const location = useLocation();
  const eventsFilter = new URLSearchParams(location.search).get('eventsFilter');
  const filterFunc = useFilterFunc<KubeEventObject>(['.jsonData.involvedObject.kind']);
  const [onlyWarnings, setOnlyWarnings] = React.useState(
    () => (localStorage.getItem(EVENT_WARNING_SWITCH_KEY) ?? 'true') === 'true'
  );
  const selected = useSelector(
    (state: { filter?: { namespaces?: Set<string> } }) => state.filter?.namespaces
  );
  const namespace = React.useMemo(() => [...(selected ?? [])], [selected]);
  const { items: events, errors } = Event.useList({ limit: Event.maxLimit, namespace });
  const warnings = React.useMemo(
    () => events?.filter(event => event.type === 'Warning').length ?? '?',
    [events]
  );

  return (
    <ResourceListView
      title="Events"
      headerProps={{
        noNamespaceFilter: false,
        titleSideActions: [
          <FormControlLabel
            key="warning-toggle"
            checked={onlyWarnings}
            label={`Only warnings (${warnings})`}
            control={<Switch color="primary" />}
            onChange={(_, checked) => {
              localStorage.setItem(EVENT_WARNING_SWITCH_KEY, String(checked));
              setOnlyWarnings(checked);
            }}
          />,
        ],
      }}
      defaultGlobalFilter={eventsFilter ?? undefined}
      data={events}
      errors={errors}
      columns={[
        {
          label: 'Type',
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => event.involvedObject.kind,
        },
        {
          label: 'Name',
          gridTemplate: 'auto',
          getValue: event => event.involvedObjectInstance?.getName() ?? event.involvedObject.name,
          render: event =>
            event.involvedObjectInstance ? (
              <Link kubeObject={event.involvedObjectInstance} />
            ) : (
              event.involvedObject.name
            ),
        },
        'namespace',
        'cluster',
        {
          label: 'Reason',
          gridTemplate: 'min-content',
          filterVariant: 'multi-select',
          getValue: event => event.reason,
          render: event => (
            <Tooltip title={event.reason}>
              <span>
                <StatusLabel status={event.type === 'Normal' ? '' : 'warning'}>
                  {event.reason}
                </StatusLabel>
              </span>
            </Tooltip>
          ),
        },
        {
          label: 'Message',
          gridTemplate: 'auto',
          getValue: event => event.message ?? '',
          render: event => (
            <ShowHideLabel labelId={event.metadata?.uid || ''}>{event.message || ''}</ShowHideLabel>
          ),
        },
        {
          id: 'count',
          label: 'Count',
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => event.count ?? null,
          render: event => event.count ?? '-',
        },
        {
          id: 'last-seen',
          label: 'Last Seen',
          gridTemplate: 'min-content',
          cellProps: { align: 'right' },
          getValue: event => -new Date(event.lastOccurrence).getTime(),
          render: event => <DateLabel date={event.lastOccurrence} format="mini" />,
        },
      ]}
      filterFunction={(event: KubeEventObject, search?: string) =>
        filterFunc(event, search) && (!onlyWarnings || event.jsonData.type === 'Warning')
      }
      defaultSortingColumn={{ id: 'last-seen', desc: false }}
      id="headlamp-cluster.overview.events"
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

/** Landing page of a cluster; replaces Headlamp's stock overview. */
export function ClusterOverview() {
  const cluster = K8s.useCluster();
  const version = useKubernetesVersion(cluster);
  const [nodes, nodesError] = Node.useList();
  const [pods, podsError] = Pod.useList();
  const [namespaces] = Namespace.useList();
  const [deployments, deploymentsError] = Deployment.useList();
  const [statefulSets, statefulSetsError] = StatefulSet.useList();
  const [daemonSets, daemonSetsError] = DaemonSet.useList();
  const [metrics, metricsError] = Node.useMetrics();

  const workloads: WorkloadGroup[] = [
    {
      kind: 'Deployment',
      label: 'Deployments',
      icon: 'mdi:rocket-launch-outline',
      route: 'Deployments',
      items: deployments,
    },
    {
      kind: 'StatefulSet',
      label: 'Stateful Sets',
      icon: 'mdi:database-outline',
      route: 'StatefulSets',
      items: statefulSets,
    },
    {
      kind: 'DaemonSet',
      label: 'Daemon Sets',
      icon: 'mdi:server-network',
      route: 'DaemonSets',
      items: daemonSets,
    },
  ];
  const lists: [string, KubeObject[] | null, unknown][] = [
    ['Nodes', nodes, nodesError],
    ['Pods', pods, podsError],
    ['Deployments', deployments, deploymentsError],
    ['Stateful Sets', statefulSets, statefulSetsError],
    ['Daemon Sets', daemonSets, daemonSetsError],
  ];
  const forbidden = lists.filter(([, , error]) => isForbidden(error)).map(([label]) => label);
  const pending = lists
    .filter(([, items, error]) => items === null && !error)
    .map(([label]) => label);

  const { issues, objects } = React.useMemo(() => {
    const found: Issue[] = [];
    const byUid = new Map<string, KubeObject>();
    const collect = (
      items: KubeObject[] | null,
      toIssues: (json: KubeObject['jsonData']) => Issue[]
    ) => {
      for (const item of items ?? []) {
        const itemIssues = toIssues(item.jsonData);
        if (itemIssues.length > 0 && item.metadata.uid) byUid.set(item.metadata.uid, item);
        found.push(...itemIssues);
      }
    };
    collect(nodes, json => nodeIssues(json as NodeJson));
    collect(pods, json => podIssues(json as PodJson));
    collect(deployments, json => workloadIssues('Deployment', json as WorkloadJson));
    collect(statefulSets, json => workloadIssues('StatefulSet', json as WorkloadJson));
    collect(daemonSets, json => workloadIssues('DaemonSet', json as WorkloadJson));
    return { issues: sortIssues(found), objects: byUid };
  }, [nodes, pods, deployments, statefulSets, daemonSets]);

  const nodeJson = React.useMemo(() => (nodes ?? []).map(n => n.jsonData as NodeJson), [nodes]);
  const podJson = React.useMemo(() => pods?.map(p => p.jsonData as PodJson) ?? null, [pods]);
  const metricsJson = metrics as MetricsJson[] | null;
  const capacity = clusterCapacity(nodeJson, metricsJson);
  const phases = podPhases(podJson ?? []);
  const readyNodes = nodeJson.filter(isNodeReady).length;
  const allWorkloads = workloads.flatMap(group => group.items ?? []);
  const healthyWorkloads = allWorkloads.filter(item =>
    isWorkloadHealthy(item.jsonData as WorkloadJson)
  ).length;
  const errorCount = issues.filter(issue => issue.level === 'error').length;
  // Issues are shown as soon as they are found; "healthy" needs every list.
  const loading = pending.length > 0 && issues.length === 0;

  const stats: Stat[] = [
    {
      id: 'nodes',
      label: 'Nodes',
      value: nodes ? `${readyNodes}/${nodes.length}` : '—',
      caption: !nodes
        ? 'Not available'
        : readyNodes === nodes.length
        ? 'All ready'
        : 'Not all ready',
      icon: 'mdi:server',
      tone: !nodes ? 'primary' : readyNodes === nodes.length ? 'success' : 'error',
      to: Router.createRouteURL('nodes'),
    },
    {
      id: 'pods',
      label: 'Pods',
      value: pods ? phases.running : '—',
      caption: !pods
        ? 'Not available'
        : phases.failed + phases.pending > 0
        ? `${phases.pending} pending · ${phases.failed} failed`
        : 'Running',
      icon: 'mdi:cube-outline',
      tone: !pods
        ? 'primary'
        : phases.failed > 0
        ? 'error'
        : phases.pending > 0
        ? 'warning'
        : 'success',
      to: Router.createRouteURL('Pods'),
    },
    {
      id: 'workloads',
      label: 'Workloads',
      value: allWorkloads.length > 0 ? `${healthyWorkloads}/${allWorkloads.length}` : '—',
      caption:
        allWorkloads.length === 0
          ? 'None yet'
          : healthyWorkloads === allWorkloads.length
          ? 'All ready'
          : `${allWorkloads.length - healthyWorkloads} degraded`,
      icon: 'mdi:chart-donut',
      tone:
        allWorkloads.length === 0
          ? 'primary'
          : healthyWorkloads === allWorkloads.length
          ? 'success'
          : 'warning',
      to: Router.createRouteURL('workloads'),
    },
    {
      id: 'namespaces',
      label: 'Namespaces',
      value: namespaces ? namespaces.length : '—',
      caption: 'In this cluster',
      icon: 'mdi:folder-outline',
      tone: 'primary',
      to: Router.createRouteURL('namespaces'),
    },
    {
      id: 'cpu',
      label: 'CPU usage',
      value: capacity.cpu.used !== undefined ? percent(capacity.cpu.used, capacity.cpu.total) : '—',
      caption:
        capacity.cpu.used !== undefined
          ? `${formatCores(capacity.cpu.used)} of ${formatCores(capacity.cpu.total)} cores`
          : nodes
          ? `${formatCores(capacity.cpu.total)} cores allocatable`
          : 'Not available',
      icon: 'mdi:chip',
      tone:
        capacity.cpu.used !== undefined ? usageTone(capacity.cpu.used, capacity.cpu.total) : 'info',
    },
    {
      id: 'memory',
      label: 'Memory usage',
      value:
        capacity.memory.used !== undefined
          ? percent(capacity.memory.used, capacity.memory.total)
          : '—',
      caption:
        capacity.memory.used !== undefined
          ? `${formatGiB(capacity.memory.used)} of ${formatGiB(capacity.memory.total)} GiB`
          : nodes
          ? `${formatGiB(capacity.memory.total)} GiB allocatable`
          : 'Not available',
      icon: 'mdi:memory',
      tone:
        capacity.memory.used !== undefined
          ? usageTone(capacity.memory.used, capacity.memory.total)
          : 'info',
    },
  ];

  return (
    <Box sx={pageSx}>
      <DashboardHeader
        icon="mdi:kubernetes"
        title={cluster || 'Cluster'}
        chips={version && <Chip label={`Kubernetes ${version}`} size="small" color="primary" />}
        subtitle={[
          'Cluster overview',
          nodes && plural(nodes.length, 'node'),
          namespaces && plural(namespaces.length, 'namespace'),
        ]
          .filter(Boolean)
          .join(' · ')}
        issues={issues}
        loading={loading}
      />

      {forbidden.length > 0 && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          Your user is not allowed to list some resources ({forbidden.join(', ')}), so parts of this
          overview are incomplete.
        </Alert>
      )}

      <Box sx={cardGrid(210)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title="Needs attention"
          icon="mdi:bell-alert-outline"
          action={
            !loading &&
            issues.length > 0 && (
              <Chip
                size="small"
                color={errorCount > 0 ? 'error' : 'warning'}
                label={issues.length}
              />
            )
          }
        >
          <IssueList
            issues={issues}
            objects={objects}
            pending={pending}
            emptyText="Every node is ready and every workload has its replicas."
          />
        </Panel>
        <Panel title="Capacity" icon="mdi:gauge">
          <CapacityPanel
            nodes={nodeJson}
            pods={podJson}
            metrics={metricsJson}
            metricsUnavailable={!!metricsError}
          />
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel
          title="Nodes"
          icon="mdi:server"
          action={nodes && <Chip size="small" variant="outlined" label={nodes.length} />}
        >
          {nodes ? (
            <NodeList nodes={nodes} metrics={metricsJson} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {nodesError ? 'Nodes are not available.' : 'Loading…'}
            </Typography>
          )}
        </Panel>
        <Panel title="Workloads" icon="mdi:chart-donut">
          {workloads.map(group => (
            <WorkloadRow key={group.kind} group={group} />
          ))}
        </Panel>
      </Box>

      <EventsSection />
    </Box>
  );
}
