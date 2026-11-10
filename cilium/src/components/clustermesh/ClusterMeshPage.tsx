import { Icon } from '@iconify/react';
import { Link, SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { isPodReady } from '../../api/ciliumInstall';
import {
  apiserverAddress,
  globalServiceSettings,
  hostAliasClusters,
  meshIdentity,
  meshSettings,
  RemoteStatus,
  remoteStatus,
  remoteUsers,
  STATUS_QUERIES,
} from '../../api/clustermesh';
import { apiserverVersion, loadMeshState, MeshState } from '../../api/clustermeshData';
import { discoverPrometheus, PrometheusEndpoint, promQuery } from '../../api/prometheus';
import { useText } from '../../common/i18n';
import { ErrorState, LoadingState } from '../../common/States';
import { useServices } from '../../hooks/useClusterData';
import { ServiceLike } from '../../resources/types';
import { ConnectWizard } from './ConnectWizard';
import { GlobalServiceDialog } from './GlobalServiceDialog';

function useLocalMesh(): { state?: MeshState; error?: unknown; reload: () => void } {
  const cluster = getCluster() || '';
  const [result, setResult] = React.useState<{ state?: MeshState; error?: unknown }>({});
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadMeshState(cluster || undefined)
        .then(state => !cancelled && setResult({ state }))
        .catch(error => !cancelled && setResult({ error }));
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cluster, attempt]);
  return { ...result, reload: () => setAttempt(a => a + 1) };
}

/** Readiness of the remote clusters as the agents report it, when Prometheus has the metrics. */
function useRemoteStatus(): {
  rows?: RemoteStatus[];
  endpoint?: PrometheusEndpoint;
  missing?: boolean;
} {
  const cluster = getCluster() || '';
  const [state, setState] = React.useState<{
    rows?: RemoteStatus[];
    endpoint?: PrometheusEndpoint;
    missing?: boolean;
  }>({});
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const endpoint = await discoverPrometheus(cluster);
        if (!endpoint) {
          if (!cancelled) setState({ missing: true });
          return;
        }
        const [ready, agents, failures, lastFailure] = await Promise.all(
          [
            STATUS_QUERIES.ready,
            STATUS_QUERIES.agents,
            STATUS_QUERIES.failures,
            STATUS_QUERIES.lastFailure,
          ].map(q => promQuery(endpoint, q, cluster))
        );
        if (!cancelled)
          setState({ endpoint, rows: remoteStatus({ ready, agents, failures, lastFailure }) });
      } catch {
        if (!cancelled) setState({ missing: true });
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cluster]);
  return state;
}

function Fact({ label, children }: React.PropsWithChildren<{ label: string }>) {
  return (
    <Box sx={{ display: 'flex', gap: 2, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 220 }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function ThisCluster({ state }: { state: MeshState }) {
  const { t } = useText();
  const identity = meshIdentity(state.config);
  const settings = meshSettings(state.config);
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {t('This cluster')}
      </Typography>
      <Fact label={t('Cluster name')}>
        <Typography variant="body2">{identity.name}</Typography>
      </Fact>
      <Fact label={t('Cluster ID')}>
        <Typography variant="body2">{identity.id || t('not set')}</Typography>
      </Fact>
      {settings.map(s => (
        <Fact key={s.label} label={t(s.label)}>
          <Typography variant="body2">{s.value}</Typography>
        </Fact>
      ))}
      {identity.problems.map(p => (
        <Alert key={p} severity="warning" sx={{ mt: 1 }}>
          {t(p)}
        </Alert>
      ))}
    </Paper>
  );
}

function ApiServer({ state }: { state: MeshState }) {
  const { t } = useText();
  const pods = state.apiserverPods;
  const ready = pods.filter(isPodReady).length;
  const address = state.apiserverService ? apiserverAddress(state.apiserverService) : undefined;
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {t('Cluster Mesh API server')}
      </Typography>
      {pods.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t(
            'Not deployed. "cilium clustermesh enable" or the Helm value clustermesh.useAPIServer=true deploys it; the connect wizard shows the steps.'
          )}
        </Typography>
      ) : (
        <>
          <Fact label={t('Pods ready')}>
            <Chip
              size="small"
              color={ready === pods.length ? 'success' : 'warning'}
              label={`${ready}/${pods.length}`}
            />
          </Fact>
          <Fact label={t('Version')}>
            <Typography variant="body2">{apiserverVersion(state) || '—'}</Typography>
          </Fact>
          <Fact label={t('KVStoreMesh')}>
            <Typography variant="body2">
              {state.kvstoremesh ? t('Enabled') : t('Disabled')}
            </Typography>
          </Fact>
          <Fact label={t('Service')}>
            <Typography variant="body2">
              {address
                ? [
                    address.type,
                    address.address &&
                      `${address.address}${address.port ? `:${address.port}` : ''}`,
                    !address.address && address.port && `port ${address.port}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('not found')}
            </Typography>
            {address?.note && (
              <Typography variant="caption" color="text.secondary" component="div">
                {t(address.note)}
              </Typography>
            )}
          </Fact>
        </>
      )}
    </Paper>
  );
}

interface RemoteRow {
  cluster: string;
  allowedIn: boolean;
  dialedIps?: string[];
  status?: RemoteStatus;
}

function remoteRows(state: MeshState, status?: RemoteStatus[]): RemoteRow[] {
  const rows = new Map<string, RemoteRow>();
  const row = (cluster: string) => {
    let r = rows.get(cluster);
    if (!r) rows.set(cluster, (r = { cluster, allowedIn: false }));
    return r;
  };
  for (const name of remoteUsers(state.remoteUsersYaml)) row(name).allowedIn = true;
  for (const alias of hostAliasClusters(state.agentDaemonSet))
    row(alias.name).dialedIps = alias.ips;
  for (const s of status || []) row(s.cluster).status = s;
  return [...rows.values()].sort((a, b) => a.cluster.localeCompare(b.cluster));
}

function RemoteClusters({ state }: { state: MeshState }) {
  const { t } = useText();
  const status = useRemoteStatus();
  const rows = remoteRows(state, status.rows);
  return (
    <SectionBox title={t('Remote clusters')}>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t(
            "No remote cluster was found. They are read from the clusters allowed to connect (ConfigMap clustermesh-remote-users), the agents' host aliases and the agents' Cluster Mesh metrics."
          )}
        </Typography>
      ) : (
        <SimpleTable
          data={rows}
          columns={[
            { label: t('Cluster'), getter: (r: RemoteRow) => r.cluster },
            {
              label: t('May connect here'),
              getter: (r: RemoteRow) => (r.allowedIn ? t('Yes') : '—'),
            },
            {
              label: t('Agents connect to it'),
              getter: (r: RemoteRow) =>
                r.status ? (
                  <Chip
                    size="small"
                    color={r.status.readyAgents === r.status.agents ? 'success' : 'error'}
                    label={t('{{r}}/{{n}} ready', { r: r.status.readyAgents, n: r.status.agents })}
                  />
                ) : r.dialedIps ? (
                  <Tooltip title={t('From the host aliases of the agent DaemonSet')}>
                    <span>{r.dialedIps.join(', ')}</span>
                  </Tooltip>
                ) : (
                  '—'
                ),
            },
            {
              label: t('Failures (1 h)'),
              getter: (r: RemoteRow) => (r.status ? r.status.failuresLastHour : '—'),
            },
            {
              label: t('Last failure'),
              getter: (r: RemoteRow) =>
                r.status?.lastFailure ? new Date(r.status.lastFailure).toLocaleString() : '—',
            },
          ]}
        />
      )}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
        {status.endpoint
          ? t('Readiness from {{p}} (cilium_clustermesh_remote_cluster_* metrics of the agents).', {
              p: status.endpoint.label,
            })
          : status.missing
          ? t(
              'Connection readiness needs Prometheus scraping the Cilium agent metrics; none was found.'
            )
          : t('Looking for Prometheus…')}
      </Typography>
    </SectionBox>
  );
}

function GlobalServices() {
  const { t } = useText();
  const { items } = useServices();
  const [editing, setEditing] = React.useState<ServiceLike | null>(null);
  const [adding, setAdding] = React.useState('');
  const [namespace, setNamespace] = React.useState('');
  const everything = items || [];
  const namespaces = Array.from(new Set(everything.map(s => s.metadata.namespace || ''))).sort();
  const all = namespace
    ? everything.filter(s => (s.metadata.namespace || '') === namespace)
    : everything;
  const global = all.filter(s => globalServiceSettings(s.metadata.annotations).global);
  const others = all.filter(s => !global.includes(s));
  const key = (s: ServiceLike) => `${s.metadata.namespace}/${s.metadata.name}`;

  return (
    <SectionBox title={t('Global services')}>
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('Namespace')}
          value={namespace}
          onChange={e => {
            setNamespace(e.target.value);
            setAdding('');
          }}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">{t('All namespaces')}</MenuItem>
          {namespaces.map(ns => (
            <MenuItem key={ns} value={ns}>
              {ns}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('Make a service global')}
          value={adding}
          onChange={e => {
            setAdding(e.target.value);
            const service = others.find(s => key(s) === e.target.value);
            if (service) setEditing(service);
          }}
          sx={{ minWidth: 320 }}
        >
          {others.map(s => (
            <MenuItem key={key(s)} value={key(s)}>
              {key(s)}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {global.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {namespace
            ? t('No service in {{ns}} is global (annotation service.cilium.io/global).', {
                ns: namespace,
              })
            : t('No service is global (annotation service.cilium.io/global).')}
        </Typography>
      ) : (
        <SimpleTable
          data={global}
          columns={[
            {
              label: t('Service'),
              getter: (s: ServiceLike) => (
                <Link
                  routeName="service"
                  params={{ namespace: s.metadata.namespace || '', name: s.metadata.name }}
                >
                  {key(s)}
                </Link>
              ),
            },
            {
              label: t('Shared'),
              getter: (s: ServiceLike) =>
                globalServiceSettings(s.metadata.annotations).shared ? t('Yes') : t('No'),
            },
            {
              label: t('Affinity'),
              getter: (s: ServiceLike) => globalServiceSettings(s.metadata.annotations).affinity,
            },
            {
              label: t('EndpointSlice sync'),
              getter: (s: ServiceLike) => {
                const v = globalServiceSettings(s.metadata.annotations).syncEndpointSlices;
                return v === undefined ? t('cluster default') : v ? t('Yes') : t('No');
              },
            },
            {
              label: '',
              getter: (s: ServiceLike) => (
                <Button size="small" onClick={() => setEditing(s)}>
                  {t('Edit')}
                </Button>
              ),
            },
          ]}
        />
      )}
      {editing && (
        <GlobalServiceDialog
          service={editing}
          onClose={() => {
            setEditing(null);
            setAdding('');
          }}
        />
      )}
    </SectionBox>
  );
}

/** Cluster Mesh page: this cluster's identity and API server, remote clusters, global services. */
export function ClusterMeshPage() {
  const { t } = useText();
  const cluster = getCluster() || '';
  const { state, error, reload } = useLocalMesh();
  const [wizard, setWizard] = React.useState(false);

  if (error && !state)
    return <ErrorState error={error} title={t('Cluster Mesh')} onRetry={reload} />;
  if (!state) return <LoadingState title={t('Reading the Cluster Mesh configuration…')} />;

  return (
    <>
      <SectionBox
        title={t('Cluster Mesh')}
        headerProps={{
          titleSideActions: [
            <Button
              key="connect"
              variant="contained"
              size="small"
              startIcon={<Icon icon="mdi:transit-connection-variant" />}
              onClick={() => setWizard(true)}
            >
              {t('Connect clusters')}
            </Button>,
          ],
        }}
      >
        {!state.config && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('The cilium-config ConfigMap could not be read.')}
          </Alert>
        )}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <ThisCluster state={state} />
          </Grid>
          <Grid item xs={12} md={6}>
            <ApiServer state={state} />
          </Grid>
        </Grid>
      </SectionBox>
      <RemoteClusters state={state} />
      <GlobalServices />
      {wizard && <ConnectWizard cluster={cluster} onClose={() => setWizard(false)} />}
    </>
  );
}
