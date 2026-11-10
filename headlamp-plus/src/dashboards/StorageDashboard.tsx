/** Storage dashboard: claims, volumes and storage classes of the cluster, and volume fill. */
import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import React from 'react';
import { Bar, cardGrid, Panel, RouteLink, Stat, StatCard, twoColumns } from '../overview/blocks';
import { Issue, usageTone } from '../overview/clusterHealth';
import { pvcIssues, PvcJson } from '../overview/namespaceHealth';
import { ServicePicker } from '../overview/usePrometheus';
import { AttentionPanel, DashboardShell, DataTable } from './shell';
import {
  classRows,
  defaultClassIssues,
  fillIssues,
  formatBytes,
  pvIssues,
  PvJson,
  StorageClassJson,
  VOLUME_QUERIES,
  volumeFill,
  volumePhases,
} from './storage';
import { listStatus, useApiList } from './useApi';
import { usePromInstant } from './usePromInstant';

export function StorageDashboard() {
  const claims = useApiList<PvcJson>('/api/v1/persistentvolumeclaims');
  const volumes = useApiList<PvJson>('/api/v1/persistentvolumes');
  const classes = useApiList<StorageClassJson>('/apis/storage.k8s.io/v1/storageclasses');
  const fill = usePromInstant([VOLUME_QUERIES.used, VOLUME_QUERIES.capacity]);
  const status = listStatus([
    ['Persistent Volume Claims', claims],
    ['Persistent Volumes', volumes],
    ['Storage Classes', classes],
  ]);

  const fillRows = React.useMemo(
    () => (fill.results ? volumeFill(fill.results[0], fill.results[1]) : undefined),
    [fill.results]
  );
  const issues: Issue[] = React.useMemo(
    () => [
      ...(claims.data ?? []).flatMap(c =>
        pvcIssues(c).map(issue => ({
          ...issue,
          link: {
            route: 'persistentVolumeClaim',
            params: { namespace: issue.namespace ?? '', name: issue.name },
          },
        }))
      ),
      ...(volumes.data ?? []).flatMap(pvIssues),
      ...defaultClassIssues(classes.data ?? []),
      ...fillIssues(fillRows ?? []),
    ],
    [claims.data, volumes.data, classes.data, fillRows]
  );
  const rows = classRows(classes.data ?? [], claims.data ?? [], volumes.data ?? []);
  const phases = volumePhases(volumes.data ?? []);
  const claimList = claims.data ?? [];
  const bound = claimList.filter(c => c.status?.phase === 'Bound').length;
  const requested = rows.reduce((sum, r) => sum + r.requested, 0);
  const defaults = (classes.data ?? []).filter(sc =>
    rows.find(r => r.name === sc.metadata?.name && r.isDefault)
  );

  const stats: Stat[] = [
    {
      id: 'claims',
      label: 'Claims bound',
      value: claims.data ? `${bound}/${claimList.length}` : '—',
      caption: !claims.data
        ? 'Not available'
        : claimList.length === bound
        ? 'All bound'
        : `${claimList.length - bound} not bound`,
      icon: 'mdi:harddisk',
      tone: !claims.data || claimList.length === bound ? 'success' : 'warning',
    },
    {
      id: 'requested',
      label: 'Requested',
      value: claims.data ? formatBytes(requested) : '—',
      caption: 'by all claims',
      icon: 'mdi:database-outline',
      tone: 'primary',
    },
    {
      id: 'volumes',
      label: 'Volumes',
      value: volumes.data ? volumes.data.length : '—',
      caption:
        Object.entries(phases)
          .map(([phase, n]) => `${n} ${phase.toLowerCase()}`)
          .join(' · ') || 'None',
      icon: 'mdi:server',
      tone: (phases.Failed ?? 0) > 0 ? 'error' : (phases.Released ?? 0) > 0 ? 'warning' : 'success',
    },
    {
      id: 'classes',
      label: 'Storage classes',
      value: classes.data ? classes.data.length : '—',
      caption:
        defaults.length === 1
          ? `default: ${defaults[0].metadata?.name}`
          : defaults.length === 0
          ? 'No default'
          : `${defaults.length} defaults`,
      icon: 'mdi:layers-outline',
      tone: defaults.length === 1 ? 'success' : 'warning',
    },
  ];

  return (
    <DashboardShell
      icon="mdi:harddisk"
      title="Storage"
      subtitle="Claims, volumes and storage classes of the cluster"
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
          emptyText="Every claim is bound, no volume is released or failed, and no mounted volume is over 80% full."
        />
        <Panel title="Fullest volumes" icon="mdi:gauge">
          {fill.prom.status === 'loading' ? (
            <CircularProgress size={20} />
          ) : fill.prom.status === 'missing' ? (
            <ServicePicker onChoose={fill.choose} needs="the kubelet's volume stats" />
          ) : fill.error ? (
            <Typography variant="body2" color="error">
              {fill.error}
            </Typography>
          ) : !fillRows ? (
            <CircularProgress size={20} />
          ) : fillRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No volume stats: they come from the kubelets for mounted claims of volume plugins that
              report them.
            </Typography>
          ) : (
            fillRows.slice(0, 8).map(row => (
              <Box key={`${row.namespace}/${row.claim}`} sx={{ py: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                  <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                    <RouteLink
                      to={{
                        route: 'persistentVolumeClaim',
                        params: { namespace: row.namespace, name: row.claim },
                      }}
                    >
                      {row.claim}
                    </RouteLink>{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {row.namespace}
                    </Typography>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatBytes(row.used)} / {formatBytes(row.capacity)}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 700, minWidth: 40, textAlign: 'right' }}
                  >
                    {Math.round(row.ratio * 100)}%
                  </Typography>
                </Box>
                <Bar
                  value={row.used}
                  total={row.capacity}
                  tone={usageTone(row.used, row.capacity)}
                />
              </Box>
            ))
          )}
        </Panel>
      </Box>
      <Panel title="Storage classes" icon="mdi:layers-outline">
        <DataTable
          rows={rows}
          rowKey={r => r.name}
          empty="No storage class and no claim."
          columns={[
            {
              label: 'Class',
              render: r => (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  {r.provisioner === '—' ? (
                    r.name
                  ) : (
                    <RouteLink to={{ route: 'storageClass', params: { name: r.name } }}>
                      {r.name}
                    </RouteLink>
                  )}
                  {r.isDefault && <Chip size="small" label="default" />}
                </Box>
              ),
            },
            { label: 'Provisioner', render: r => r.provisioner },
            { label: 'Reclaim', render: r => r.reclaimPolicy },
            { label: 'Binding', render: r => r.bindingMode },
            {
              label: 'Expansion',
              render: r => (r.provisioner === '—' ? '—' : r.expansion ? 'Yes' : 'No'),
            },
            {
              label: 'Claims',
              align: 'right',
              render: r => (r.pending > 0 ? `${r.claims} (${r.pending} pending)` : r.claims),
            },
            { label: 'Requested', align: 'right', render: r => formatBytes(r.requested) },
            { label: 'Volumes', align: 'right', render: r => r.volumes },
            { label: 'Capacity', align: 'right', render: r => formatBytes(r.capacity) },
          ]}
        />
      </Panel>
    </DashboardShell>
  );
}
