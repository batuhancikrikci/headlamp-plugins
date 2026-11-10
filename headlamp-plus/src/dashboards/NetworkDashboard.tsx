/** Network dashboard: services, endpoints, ingresses and NetworkPolicy coverage. */
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { Bar, cardGrid, Panel, RouteLink, Stat, StatCard, twoColumns } from '../overview/blocks';
import { Issue } from '../overview/clusterHealth';
import {
  EndpointSliceJson,
  ingressIssues,
  IngressJson,
  NamespacedJson,
  NetServiceJson,
  NetworkPolicyJson,
  policyCoverage,
  SERVICE_TYPES,
  serviceIssues,
  serviceTypes,
} from './network';
import { AttentionPanel, DashboardShell, DataTable } from './shell';
import { listStatus, useApiList } from './useApi';

export function NetworkDashboard() {
  const services = useApiList<NetServiceJson>('/api/v1/services');
  const slices = useApiList<EndpointSliceJson>('/apis/discovery.k8s.io/v1/endpointslices');
  const ingresses = useApiList<IngressJson>('/apis/networking.k8s.io/v1/ingresses');
  const policies = useApiList<NetworkPolicyJson>('/apis/networking.k8s.io/v1/networkpolicies');
  const pods = useApiList<NamespacedJson>(
    `/api/v1/pods?fieldSelector=${encodeURIComponent('status.phase=Running')}`
  );
  const status = listStatus([
    ['Services', services],
    ['Endpoint Slices', slices],
    ['Ingresses', ingresses],
    ['Network Policies', policies],
    ['Pods', pods],
  ]);

  const issues: Issue[] = React.useMemo(
    () => [
      ...(services.data && slices.data ? serviceIssues(services.data, slices.data) : []),
      ...(ingresses.data && services.data ? ingressIssues(ingresses.data, services.data) : []),
    ],
    [services.data, slices.data, ingresses.data]
  );
  const types = serviceTypes(services.data ?? []);
  const coverage = policyCoverage(pods.data ?? [], policies.data ?? []);
  const open = coverage.filter(r => r.policies === 0);
  const count = (title: string) => issues.filter(i => i.title === title).length;
  const total = services.data?.length ?? 0;

  const stats: Stat[] = [
    {
      id: 'services',
      label: 'Services',
      value: services.data ? total : '—',
      caption: `${types.LoadBalancer} load balancer · ${types.NodePort} node port`,
      icon: 'mdi:lan',
      tone: 'primary',
    },
    {
      id: 'endpoints',
      label: 'Without endpoints',
      value: services.data && slices.data ? count('No ready endpoints') : '—',
      caption: 'services selecting no ready pod',
      icon: 'mdi:lan-disconnect',
      tone: count('No ready endpoints') > 0 ? 'warning' : 'success',
    },
    {
      id: 'lb',
      label: 'Load balancers pending',
      value: services.data ? count('No external address') : '—',
      caption: 'without an external address',
      icon: 'mdi:ip-network-outline',
      tone: count('No external address') > 0 ? 'warning' : 'success',
    },
    {
      id: 'ingresses',
      label: 'Ingresses',
      value: ingresses.data ? ingresses.data.length : '—',
      caption: `${issues.filter(i => i.kind === 'Ingress').length} with problems`,
      icon: 'mdi:web',
      tone: issues.some(i => i.kind === 'Ingress') ? 'warning' : 'success',
    },
    {
      id: 'policies',
      label: 'Namespaces without policy',
      value: pods.data && policies.data ? open.length : '—',
      caption: `of ${coverage.length} with running pods`,
      icon: 'mdi:wall-fire',
      tone: open.length > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <DashboardShell
      icon="mdi:lan"
      title="Network"
      subtitle="Services, endpoints, ingresses and network policies of the cluster"
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
          emptyText="Every selecting service has ready endpoints, every load balancer and ingress has an address and every ingress backend exists."
        />
        <Panel title="Service types" icon="mdi:chart-bar">
          {SERVICE_TYPES.map(type => (
            <Box key={type} sx={{ py: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                  {type}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {types[type] ?? 0}
                </Typography>
              </Box>
              <Bar value={types[type] ?? 0} total={total} tone="primary" />
            </Box>
          ))}
        </Panel>
      </Box>
      <Panel
        title="Network policy coverage"
        icon="mdi:wall-fire"
        action={
          pods.data &&
          policies.data && (
            <Chip
              size="small"
              color={open.length > 0 ? 'warning' : 'success'}
              label={`${open.length} without policy`}
            />
          )
        }
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Namespaces with running pods (system namespaces left out) and their Kubernetes
          NetworkPolicies. Without any, every pod accepts traffic from everywhere, unless a CNI
          policy (for example Cilium's or Calico's own kinds) restricts it; those are not counted
          here.
        </Typography>
        <DataTable
          rows={coverage}
          rowKey={r => r.namespace}
          empty={pods.data ? 'No running pod.' : 'Loading…'}
          maxHeight={360}
          columns={[
            {
              label: 'Namespace',
              render: r => (
                <RouteLink to={{ route: 'namespace', params: { name: r.namespace } }}>
                  {r.namespace}
                </RouteLink>
              ),
            },
            { label: 'Running pods', align: 'right', render: r => r.pods },
            {
              label: 'Network policies',
              align: 'right',
              render: r =>
                r.policies > 0 ? (
                  r.policies
                ) : (
                  <Typography variant="body2" color="warning.main" component="span">
                    none
                  </Typography>
                ),
            },
          ]}
        />
      </Panel>
    </DashboardShell>
  );
}
