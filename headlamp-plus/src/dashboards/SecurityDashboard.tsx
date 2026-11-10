/** Security dashboard: pod isolation findings, Pod Security levels and cluster-admin bindings. */
import { Box, Chip, FormControlLabel, Switch, Typography } from '@mui/material';
import React from 'react';
import { cardGrid, Panel, RouteLink, Stat, StatCard, twoColumns } from '../overview/blocks';
import { Issue } from '../overview/clusterHealth';
import {
  BindingJson,
  clusterAdmins,
  countByKind,
  FindingKind,
  FINDINGS,
  NamespaceJson,
  podSecurityRows,
  SecurityPodJson,
  securityRows,
} from './security';
import { DashboardShell, DataTable } from './shell';
import { listStatus, useApiList } from './useApi';

const ICONS: Record<FindingKind, string> = {
  privileged: 'mdi:shield-alert-outline',
  hostNamespaces: 'mdi:lan-connect',
  hostPath: 'mdi:folder-network-outline',
  capabilities: 'mdi:key-chain-variant',
  root: 'mdi:account-alert-outline',
  noMemoryLimit: 'mdi:memory',
};

export function SecurityDashboard() {
  const pods = useApiList<SecurityPodJson>('/api/v1/pods');
  const namespaces = useApiList<NamespaceJson>('/api/v1/namespaces');
  const bindings = useApiList<BindingJson>(
    '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings'
  );
  const [includeSystem, setIncludeSystem] = React.useState(false);
  const [kind, setKind] = React.useState<FindingKind | null>(null);
  const status = listStatus([
    ['Pods', pods],
    ['Namespaces', namespaces],
    ['Cluster Role Bindings', bindings],
  ]);

  const rows = React.useMemo(
    () => securityRows(pods.data ?? [], includeSystem),
    [pods.data, includeSystem]
  );
  const counts = countByKind(rows);
  const pss = podSecurityRows(namespaces.data ?? [], includeSystem);
  const unenforced = pss.filter(r => !r.enforce || r.enforce === 'privileged');
  const admins = clusterAdmins(bindings.data ?? []);
  const serviceAccountAdmins = admins.filter(a => a.kind === 'ServiceAccount');

  // The header counts the strongest findings; the rest are in the tables.
  const issues: Issue[] = [
    ...rows
      .filter(r => r.findings.some(f => FINDINGS[f.kind].level === 'error'))
      .map(r => ({
        kind: 'Pod',
        name: r.name,
        namespace: r.namespace,
        link: { route: 'Pod', params: { namespace: r.namespace, name: r.name } },
        level: 'error' as const,
        title: r.findings
          .filter(f => FINDINGS[f.kind].level === 'error')
          .map(f => FINDINGS[f.kind].label)
          .join(', '),
      })),
    ...serviceAccountAdmins.map(a => ({
      kind: 'ServiceAccount',
      name: a.name,
      namespace: a.namespace,
      level: 'warning' as const,
      title: 'Bound to cluster-admin',
      detail: `ClusterRoleBinding ${a.binding}`,
    })),
  ];

  const stats: Stat[] = (Object.keys(FINDINGS) as FindingKind[]).map(k => ({
    id: k,
    label: FINDINGS[k].label,
    value: pods.data ? counts[k] : '—',
    caption: counts[k] === 1 ? 'pod' : 'pods',
    icon: ICONS[k],
    tone: counts[k] === 0 ? 'success' : FINDINGS[k].level === 'error' ? 'error' : 'warning',
  }));
  const shown = kind ? rows.filter(r => r.findings.some(f => f.kind === kind)) : rows;

  return (
    <DashboardShell
      icon="mdi:shield-check-outline"
      title="Security"
      subtitle={
        includeSystem
          ? 'Pod isolation, Pod Security and cluster-admin bindings'
          : 'Pod isolation, Pod Security and cluster-admin bindings, without kube-system, kube-public and kube-node-lease'
      }
      issues={issues}
      {...status}
    >
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1 }}>
        <FormControlLabel
          control={
            <Switch checked={includeSystem} onChange={e => setIncludeSystem(e.target.checked)} />
          }
          label="Include system namespaces"
        />
      </Box>
      <Box sx={cardGrid(200)}>
        {stats.map(stat => (
          <StatCard key={stat.id} stat={stat} />
        ))}
      </Box>
      <Panel
        title="Pods"
        icon="mdi:cube-outline"
        action={
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {(Object.keys(FINDINGS) as FindingKind[]).map(k => (
              <Chip
                key={k}
                size="small"
                label={FINDINGS[k].label}
                color={kind === k ? 'primary' : 'default'}
                variant={kind === k ? 'filled' : 'outlined'}
                onClick={() => setKind(kind === k ? null : k)}
              />
            ))}
          </Box>
        }
      >
        <DataTable
          rows={shown}
          rowKey={r => `${r.namespace}/${r.name}`}
          empty={pods.data ? 'No pod has these findings.' : 'Loading…'}
          columns={[
            {
              label: 'Pod',
              render: r => (
                <RouteLink to={{ route: 'Pod', params: { namespace: r.namespace, name: r.name } }}>
                  {r.name}
                </RouteLink>
              ),
            },
            { label: 'Namespace', render: r => r.namespace },
            {
              label: 'Findings',
              render: r => (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                  {r.findings
                    .filter(f => !kind || f.kind === kind)
                    .map(f => (
                      <Typography key={f.kind} variant="body2">
                        <Box
                          component="span"
                          sx={{
                            fontWeight: 600,
                            color:
                              FINDINGS[f.kind].level === 'error' ? 'error.main' : 'warning.main',
                          }}
                        >
                          {FINDINGS[f.kind].label}
                        </Box>{' '}
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          {f.detail}
                        </Box>
                      </Typography>
                    ))}
                </Box>
              ),
            },
          ]}
        />
      </Panel>
      <Box sx={twoColumns}>
        <Panel
          title="Pod Security"
          icon="mdi:shield-lock-outline"
          action={
            namespaces.data && (
              <Chip
                size="small"
                color={unenforced.length > 0 ? 'warning' : 'success'}
                label={`${unenforced.length} not enforced`}
              />
            )
          }
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Pod Security Admission levels from the namespace labels. Without an enforce label (or
            with "privileged") any pod spec is admitted, unless a cluster-wide default says
            otherwise.
          </Typography>
          <DataTable
            rows={pss}
            rowKey={r => r.name}
            empty="No namespace."
            maxHeight={320}
            columns={[
              {
                label: 'Namespace',
                render: r => (
                  <RouteLink to={{ route: 'namespace', params: { name: r.name } }}>
                    {r.name}
                  </RouteLink>
                ),
              },
              {
                label: 'Enforce',
                render: r =>
                  r.enforce ? (
                    <Chip
                      size="small"
                      label={r.enforce}
                      color={r.enforce === 'privileged' ? 'warning' : 'success'}
                      variant="outlined"
                    />
                  ) : (
                    <Typography variant="body2" color="warning.main">
                      none
                    </Typography>
                  ),
              },
              { label: 'Warn', render: r => r.warn ?? '—' },
              { label: 'Audit', render: r => r.audit ?? '—' },
            ]}
          />
        </Panel>
        <Panel title="cluster-admin" icon="mdi:account-key-outline">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Subjects of ClusterRoleBindings to cluster-admin (the built-in system:masters group is
            left out). A service account here gives full control to every pod that runs as it.
          </Typography>
          <DataTable
            rows={admins}
            rowKey={a => `${a.binding}/${a.kind}/${a.namespace}/${a.name}`}
            empty={bindings.data ? 'No other subject is bound to cluster-admin.' : 'Loading…'}
            maxHeight={320}
            columns={[
              { label: 'Kind', render: a => a.kind },
              {
                label: 'Subject',
                render: a => (a.namespace ? `${a.namespace}/${a.name}` : a.name),
              },
              { label: 'Binding', render: a => a.binding },
            ]}
          />
        </Panel>
      </Box>
    </DashboardShell>
  );
}
