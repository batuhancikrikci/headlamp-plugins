/** Upgrade readiness: kubelet version skew, budgets that block drains and deprecated APIs. */
import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { cardGrid, Panel, RouteLink, Stat, StatCard, twoColumns } from '../overview/blocks';
import { Issue, NodeJson } from '../overview/clusterHealth';
import { ServicePicker } from '../overview/usePrometheus';
import { AttentionPanel, DashboardShell, DataTable } from './shell';
import {
  blockingPdbs,
  DEPRECATED_QUERY,
  deprecatedApis,
  deprecatedIssues,
  KUBELET_SKEW,
  kubeletVersions,
  pdbIssues,
  PdbJson,
  skewIssues,
} from './upgrade';
import { listStatus, useApiGet, useApiList } from './useApi';
import { usePromInstant } from './usePromInstant';

export function UpgradeDashboard() {
  const version = useApiGet<{ gitVersion?: string }>('/version', 300_000);
  const nodes = useApiList<NodeJson>('/api/v1/nodes');
  const pdbs = useApiList<PdbJson>('/apis/policy/v1/poddisruptionbudgets');
  const deprecated = usePromInstant([DEPRECATED_QUERY]);
  const status = listStatus([
    ['Version', version],
    ['Nodes', nodes],
    ['Pod Disruption Budgets', pdbs],
  ]);
  const apiServer = version.data?.gitVersion;
  const versions = kubeletVersions(nodes.data ?? [], apiServer);
  const blocking = blockingPdbs(pdbs.data ?? []);
  const apis = deprecated.results ? deprecatedApis(deprecated.results[0]) : undefined;
  const issues: Issue[] = React.useMemo(
    () => [
      ...skewIssues(versions, apiServer),
      ...pdbIssues(pdbs.data ?? []),
      ...deprecatedIssues(apis ?? [], apiServer),
    ],
    // versions and apis follow from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes.data, apiServer, pdbs.data, deprecated.results]
  );
  const oldest = versions.reduce<number | undefined>(
    (max, row) => (row.behind === undefined ? max : Math.max(max ?? 0, row.behind)),
    undefined
  );

  const stats: Stat[] = [
    {
      id: 'api',
      label: 'API server',
      value: apiServer ?? '—',
      caption: 'Kubernetes version',
      icon: 'mdi:kubernetes',
      tone: 'primary',
    },
    {
      id: 'kubelets',
      label: 'Kubelet versions',
      value: nodes.data ? versions.length : '—',
      caption:
        oldest === undefined
          ? 'Not compared'
          : oldest === 0
          ? 'All match the API server'
          : `oldest ${oldest} minor behind (max ${KUBELET_SKEW})`,
      icon: 'mdi:server',
      tone:
        oldest === undefined || oldest < KUBELET_SKEW
          ? 'success'
          : oldest === KUBELET_SKEW
          ? 'warning'
          : 'error',
    },
    {
      id: 'pdbs',
      label: 'Blocking budgets',
      value: pdbs.data ? blocking.length : '—',
      caption: `of ${pdbs.data?.length ?? 0} disruption budgets`,
      icon: 'mdi:hand-back-left-outline',
      tone: blocking.length > 0 ? 'warning' : 'success',
    },
    {
      id: 'deprecated',
      label: 'Deprecated APIs',
      value: apis ? apis.length : '—',
      caption: apis ? 'still requested' : 'Needs Prometheus',
      icon: 'mdi:api-off',
      tone: !apis ? 'info' : apis.length > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <DashboardShell
      icon="mdi:update"
      title="Upgrade readiness"
      subtitle="What stands in the way of the next Kubernetes upgrade"
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
          emptyText="Kubelets are within the supported skew, no budget blocks a drain and no deprecated API is requested."
        />
        <Panel title="Kubelet versions" icon="mdi:server">
          <DataTable
            rows={versions}
            rowKey={r => r.version}
            empty={nodes.data ? 'No node.' : 'Loading…'}
            maxHeight={320}
            columns={[
              { label: 'Version', render: r => r.version },
              {
                label: 'Behind',
                render: r =>
                  r.behind === undefined
                    ? '—'
                    : r.behind < 0
                    ? 'newer'
                    : r.behind === 0
                    ? 'same'
                    : `${r.behind} minor`,
              },
              {
                label: 'Nodes',
                render: r =>
                  r.nodes.length <= 3
                    ? r.nodes.map((n, i) => (
                        <React.Fragment key={n}>
                          {i > 0 && ', '}
                          <RouteLink to={{ route: 'node', params: { name: n } }}>{n}</RouteLink>
                        </React.Fragment>
                      ))
                    : `${r.nodes.length} nodes`,
              },
            ]}
          />
        </Panel>
      </Box>
      <Box sx={twoColumns}>
        <Panel title="Disruption budgets blocking drains" icon="mdi:hand-back-left-outline">
          <DataTable
            rows={blocking}
            rowKey={p => `${p.metadata?.namespace}/${p.metadata?.name}`}
            empty={pdbs.data ? 'Every budget allows at least one eviction.' : 'Loading…'}
            maxHeight={320}
            columns={[
              {
                label: 'Budget',
                render: p => (
                  <RouteLink
                    to={{
                      route: 'podDisruptionBudget',
                      params: {
                        namespace: p.metadata?.namespace ?? '',
                        name: p.metadata?.name ?? '',
                      },
                    }}
                  >
                    {p.metadata?.name}
                  </RouteLink>
                ),
              },
              { label: 'Namespace', render: p => p.metadata?.namespace },
              {
                label: 'Rule',
                render: p =>
                  p.spec?.maxUnavailable !== undefined
                    ? `maxUnavailable ${p.spec.maxUnavailable}`
                    : `minAvailable ${p.spec?.minAvailable}`,
              },
              {
                label: 'Healthy',
                align: 'right',
                render: p => `${p.status?.currentHealthy ?? 0}/${p.status?.expectedPods ?? 0}`,
              },
            ]}
          />
        </Panel>
        <Panel title="Deprecated APIs in use" icon="mdi:api-off">
          {deprecated.prom.status === 'loading' ? (
            <CircularProgress size={20} />
          ) : deprecated.prom.status === 'missing' ? (
            <ServicePicker
              onChoose={deprecated.choose}
              needs="the API server metrics (apiserver_requested_deprecated_apis)"
            />
          ) : deprecated.error ? (
            <Typography variant="body2" color="error">
              {deprecated.error}
            </Typography>
          ) : !apis ? (
            <CircularProgress size={20} />
          ) : (
            <DataTable
              rows={apis}
              rowKey={a => `${a.api} ${a.resource}`}
              empty="No deprecated API was requested since the API servers started (or their metrics are not scraped)."
              maxHeight={320}
              columns={[
                { label: 'API', render: a => a.api },
                { label: 'Resource', render: a => a.resource },
                {
                  label: 'Removed in',
                  render: a =>
                    a.removedRelease ? <Chip size="small" label={a.removedRelease} /> : '—',
                },
              ]}
            />
          )}
        </Panel>
      </Box>
    </DashboardShell>
  );
}
