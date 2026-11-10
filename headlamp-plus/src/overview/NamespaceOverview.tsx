/**
 * Namespace dashboard, shown at the top of Headlamp's namespace page: health of the workloads,
 * what needs attention, how full the quotas are, what the pods request and use, and the usage
 * trend. Headlamp's own sections (quotas, limit ranges, pods, events) stay below it.
 */
import { Icon } from '@iconify/react';
import { ApiProxy, K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Alert, Box, Chip, Typography } from '@mui/material';
import React from 'react';
import {
  Bar,
  cardGrid,
  DashboardHeader,
  HealthRow,
  isForbidden,
  IssueList,
  Panel,
  percent,
  plural,
  rowSx,
  Stat,
  StatCard,
  twoColumns,
} from './blocks';
import {
  CronJobJson,
  formatCores,
  formatGiB,
  Issue,
  isWorkloadHealthy,
  jobIssues,
  JobJson,
  jobState,
  podIssues,
  PodJson,
  podPhases,
  sortIssues,
  usageTone,
  workloadIssues,
  WorkloadJson,
} from './clusterHealth';
import {
  PodMetricsJson,
  podResources,
  PodSpecJson,
  PodUsage,
  podUsage,
  pvcIssues,
  PvcJson,
  quotaCapacity,
  quotaIssues,
  QuotaJson,
  QuotaRow,
  quotaRows,
  topPods,
  totalUsage,
} from './namespaceHealth';
import { UsageTrends } from './UsageTrends';

const {
  Pod,
  Deployment,
  StatefulSet,
  DaemonSet,
  Job,
  CronJob,
  PersistentVolumeClaim,
  ResourceQuota,
} = K8s.ResourceClasses;

/** Pod metrics of the namespace from the metrics API, refreshed every 30 seconds. */
function usePodMetrics(namespace: string): {
  items: PodMetricsJson[] | null;
  unavailable: boolean;
} {
  const cluster = K8s.useCluster() || '';
  const [state, setState] = React.useState<{
    items: PodMetricsJson[] | null;
    unavailable: boolean;
  }>({ items: null, unavailable: false });
  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      ApiProxy.request(
        `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`,
        cluster ? { cluster } : {}
      )
        .then((list: { items?: PodMetricsJson[] }) => {
          if (!cancelled) setState({ items: list?.items ?? [], unavailable: false });
        })
        .catch(() => !cancelled && setState({ items: null, unavailable: true }));
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [namespace, cluster]);
  return state;
}

function formatQuota(row: QuotaRow, value: number): string {
  if (row.kind === 'cpu') return `${formatCores(value)} cores`;
  if (row.kind === 'memory') return `${formatGiB(value)} GiB`;
  return String(Math.round(value));
}

function QuotaPanel({ rows }: { rows: QuotaRow[] }) {
  return (
    <Box>
      {rows.map(row => (
        <Box key={`${row.quota}/${row.resource}`} sx={{ py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1, wordBreak: 'break-all' }}>
              {row.resource}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {formatQuota(row, row.used)} / {formatQuota(row, row.hard)}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}>
              {percent(row.used, row.hard)}
            </Typography>
          </Box>
          <Bar value={row.used} total={row.hard} tone={usageTone(row.used, row.hard)} />
        </Box>
      ))}
    </Box>
  );
}

function RequestsPanel({
  requests,
  limits,
  used,
}: {
  requests: { cpu: number; memory: number };
  limits: { cpu: number; memory: number };
  used?: { cpu: number; memory: number };
}) {
  const row = (
    label: string,
    format: (v: number) => string,
    unit: string,
    value: { req: number; lim: number; use?: number }
  ) => (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {value.use !== undefined ? `${format(value.use)} used · ` : ''}
          {format(value.req)} requested
          {value.lim > 0 ? ` · ${format(value.lim)} limit` : ''} {unit}
        </Typography>
      </Box>
      {value.use !== undefined && value.req > 0 && (
        <Bar value={value.use} total={value.req} tone={usageTone(value.use, value.req)} />
      )}
    </Box>
  );
  return (
    <Box>
      {row('CPU', formatCores, 'cores', { req: requests.cpu, lim: limits.cpu, use: used?.cpu })}
      {row('Memory', formatGiB, 'GiB', {
        req: requests.memory,
        lim: limits.memory,
        use: used?.memory,
      })}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
        No ResourceQuota limits this namespace. The bars compare what the pods use with what they
        request.
      </Typography>
    </Box>
  );
}

function TopPods({ usage, objects }: { usage: PodUsage[]; objects: Map<string, KubeObject> }) {
  const columns: Array<{ by: 'cpu' | 'memory'; label: string; format: (v: number) => string }> = [
    { by: 'cpu', label: 'CPU (cores)', format: formatCores },
    { by: 'memory', label: 'Memory (GiB)', format: formatGiB },
  ];
  return (
    <Box sx={cardGrid(220)}>
      {columns.map(column => (
        <Box key={column.by} sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {column.label}
          </Typography>
          {topPods(usage, column.by).map(pod => {
            const object = objects.get(pod.name);
            return (
              <Box
                key={pod.name}
                sx={{ display: 'flex', gap: 1, alignItems: 'baseline', ...rowSx }}
              >
                <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                  {object ? <Link kubeObject={object} /> : pod.name}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                >
                  {column.format(pod[column.by])}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}

/** Dashboard of one namespace. */
export function NamespaceOverview({ namespace }: { namespace: string }) {
  const opts = { namespace };
  const [pods, podsError] = Pod.useList(opts);
  const [deployments, deploymentsError] = Deployment.useList(opts);
  const [statefulSets, statefulSetsError] = StatefulSet.useList(opts);
  const [daemonSets, daemonSetsError] = DaemonSet.useList(opts);
  const [jobs, jobsError] = Job.useList(opts);
  const [cronJobs] = CronJob.useList(opts);
  const [claims, claimsError] = PersistentVolumeClaim.useList(opts);
  const [quotas] = ResourceQuota.useList(opts);
  const metrics = usePodMetrics(namespace);

  const lists: [string, KubeObject[] | null, unknown][] = [
    ['Pods', pods, podsError],
    ['Deployments', deployments, deploymentsError],
    ['Stateful Sets', statefulSets, statefulSetsError],
    ['Daemon Sets', daemonSets, daemonSetsError],
    ['Jobs', jobs, jobsError],
    ['Persistent Volume Claims', claims, claimsError],
  ];
  const forbidden = lists.filter(([, , error]) => isForbidden(error)).map(([label]) => label);
  const pending = lists
    .filter(([, items, error]) => items === null && !error)
    .map(([label]) => label);

  const rows = React.useMemo(
    () => quotaRows((quotas ?? []).map(q => q.jsonData as QuotaJson)),
    [quotas]
  );

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
    collect(pods, json => podIssues(json as PodJson));
    collect(deployments, json => workloadIssues('Deployment', json as WorkloadJson));
    collect(statefulSets, json => workloadIssues('StatefulSet', json as WorkloadJson));
    collect(daemonSets, json => workloadIssues('DaemonSet', json as WorkloadJson));
    collect(jobs, json => jobIssues('Job', json as JobJson));
    collect(claims, json => pvcIssues(json as PvcJson));
    found.push(...quotaIssues(rows, namespace));
    return { issues: sortIssues(found), objects: byUid };
  }, [pods, deployments, statefulSets, daemonSets, jobs, claims, rows, namespace]);

  const podJson = (pods ?? []).map(p => p.jsonData as PodJson);
  const phases = podPhases(podJson);
  const controllers = [...(deployments ?? []), ...(statefulSets ?? []), ...(daemonSets ?? [])];
  const healthy = controllers.filter(item =>
    isWorkloadHealthy(item.jsonData as WorkloadJson)
  ).length;
  const failedJobs = (jobs ?? []).filter(j => jobState(j.jsonData as JobJson) === 'failed').length;
  const activeJobs = (jobs ?? []).filter(j => jobState(j.jsonData as JobJson) === 'active').length;
  const suspended = (cronJobs ?? []).filter(c => (c.jsonData as CronJobJson).spec?.suspend).length;
  const bound = (claims ?? []).filter(
    c => (c.jsonData as PvcJson).status?.phase === 'Bound'
  ).length;
  const resources = podResources((pods ?? []).map(p => p.jsonData as PodSpecJson));
  const usage = metrics.items ? podUsage(metrics.items) : null;
  const used = usage ? totalUsage(usage) : undefined;
  const podsByName = React.useMemo(
    () => new Map((pods ?? []).map(p => [p.metadata.name, p] as [string, KubeObject])),
    [pods]
  );
  const capacity = quotaCapacity(rows);
  const errorCount = issues.filter(issue => issue.level === 'error').length;
  const loading = pending.length > 0 && issues.length === 0;
  const listUrl = (route: string) =>
    `${Router.createRouteURL(route)}?namespace=${encodeURIComponent(namespace)}`;

  const stats: Stat[] = [
    {
      id: 'pods',
      label: 'Pods running',
      value: pods ? phases.running : '—',
      caption: !pods
        ? 'Not available'
        : phases.failed + phases.pending > 0
        ? `${phases.pending} pending · ${phases.failed} failed`
        : `of ${plural(pods.length, 'pod')}`,
      icon: 'mdi:cube-outline',
      tone: !pods
        ? 'primary'
        : phases.failed > 0
        ? 'error'
        : phases.pending > 0
        ? 'warning'
        : 'success',
      to: listUrl('Pods'),
    },
    {
      id: 'workloads',
      label: 'Workloads ready',
      value: controllers.length > 0 ? `${healthy}/${controllers.length}` : '—',
      caption:
        controllers.length === 0
          ? 'No deployments, stateful or daemon sets'
          : healthy === controllers.length
          ? 'All ready'
          : `${controllers.length - healthy} degraded`,
      icon: 'mdi:chart-donut',
      tone:
        controllers.length === 0
          ? 'primary'
          : healthy === controllers.length
          ? 'success'
          : 'warning',
      to: listUrl('workloads'),
    },
    {
      id: 'jobs',
      label: 'Jobs',
      value: jobs ? jobs.length : '—',
      caption: !jobs
        ? 'Not available'
        : failedJobs + activeJobs > 0
        ? `${activeJobs} active · ${failedJobs} failed`
        : suspended > 0
        ? `${suspended} cron job(s) suspended`
        : jobs.length > 0
        ? 'All completed'
        : 'None yet',
      icon: 'mdi:briefcase-check-outline',
      tone: !jobs ? 'primary' : failedJobs > 0 ? 'error' : activeJobs > 0 ? 'info' : 'success',
      to: listUrl('Jobs'),
    },
    {
      id: 'claims',
      label: 'Volume claims',
      value: claims ? `${bound}/${claims.length}` : '—',
      caption: !claims
        ? 'Not available'
        : claims.length === 0
        ? 'None'
        : bound === claims.length
        ? 'All bound'
        : `${claims.length - bound} not bound`,
      icon: 'mdi:harddisk',
      tone:
        !claims || claims.length === 0
          ? 'primary'
          : bound === claims.length
          ? 'success'
          : 'warning',
      to: listUrl('persistentVolumeClaims'),
    },
    {
      id: 'cpu',
      label: 'CPU used',
      value: used ? formatCores(used.cpu) : '—',
      caption: used
        ? `cores · ${formatCores(resources.requests.cpu)} requested`
        : metrics.unavailable
        ? 'Needs the metrics API'
        : 'Loading…',
      icon: 'mdi:chip',
      tone:
        used && resources.requests.cpu > 0 ? usageTone(used.cpu, resources.requests.cpu) : 'info',
    },
    {
      id: 'memory',
      label: 'Memory used',
      value: used ? formatGiB(used.memory) : '—',
      caption: used
        ? `GiB · ${formatGiB(resources.requests.memory)} requested`
        : metrics.unavailable
        ? 'Needs the metrics API'
        : 'Loading…',
      icon: 'mdi:memory',
      tone:
        used && resources.requests.memory > 0
          ? usageTone(used.memory, resources.requests.memory)
          : 'info',
    },
  ];

  const kinds: Array<{ label: string; icon: string; route: string; items: KubeObject[] | null }> = [
    {
      label: 'Deployments',
      icon: 'mdi:rocket-launch-outline',
      route: 'Deployments',
      items: deployments,
    },
    {
      label: 'Stateful Sets',
      icon: 'mdi:database-outline',
      route: 'StatefulSets',
      items: statefulSets,
    },
    { label: 'Daemon Sets', icon: 'mdi:server-network', route: 'DaemonSets', items: daemonSets },
  ];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2, mb: 2 }}>
      <DashboardHeader
        icon="mdi:folder-outline"
        title={namespace}
        subtitle={[
          'Namespace overview',
          pods && plural(pods.length, 'pod'),
          controllers.length > 0 && plural(controllers.length, 'workload'),
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

      <Box sx={cardGrid(200)}>
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
            emptyText="Every workload has its replicas, no pod or job is failing and every claim is bound."
          />
        </Panel>
        <Panel title={rows.length > 0 ? 'Quota' : 'Requests and usage'} icon="mdi:gauge">
          {rows.length > 0 ? (
            <QuotaPanel rows={rows} />
          ) : (
            <RequestsPanel requests={resources.requests} limits={resources.limits} used={used} />
          )}
        </Panel>
      </Box>

      <Box sx={twoColumns}>
        <Panel title="Top pods" icon="mdi:sort-descending">
          {usage && usage.length > 0 ? (
            <TopPods usage={usage} objects={podsByName} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {metrics.unavailable
                ? 'Pod usage needs the metrics API (metrics-server), which is not available.'
                : usage
                ? 'No pod is running.'
                : 'Loading…'}
            </Typography>
          )}
        </Panel>
        <Panel title="Workloads" icon="mdi:chart-donut">
          {kinds.map(kind => (
            <HealthRow
              key={kind.label}
              label={kind.label}
              icon={kind.icon}
              to={listUrl(kind.route)}
              loaded={!!kind.items}
              total={kind.items?.length ?? 0}
              healthy={
                (kind.items ?? []).filter(i => isWorkloadHealthy(i.jsonData as WorkloadJson)).length
              }
            />
          ))}
        </Panel>
      </Box>

      <UsageTrends
        namespace={namespace}
        cpuCapacity={capacity.cpu}
        memoryCapacity={capacity.memory}
        capacityLabel="quota"
      />
    </Box>
  );
}
