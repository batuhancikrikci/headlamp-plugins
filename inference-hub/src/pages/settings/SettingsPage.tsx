import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { clusterParams } from '../../api/paths';
import {
  endpointFromService,
  PrometheusEndpoint,
  rankPrometheusServices,
  resolvePrometheus,
  testEndpoint,
} from '../../api/prometheus';
import { t } from '../../common/i18n';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useCoreList } from '../../hooks/useLive';
import {
  clusterSettingsOf,
  DEFAULT_PROMETHEUS,
  DEFAULT_REFRESH_SECONDS,
  featuresOf,
  FeatureToggles,
  PrometheusMode,
  PrometheusSettings,
  settingsStore,
  updateClusterSettings,
  useSettings,
} from '../../settings/settings';

const REFRESH_CHOICES = [5, 10, 15, 30, 60, 120];

const FEATURES: Array<{ key: keyof FeatureToggles; label: string; help: string }> = [
  {
    key: 'playground',
    label: 'Playground',
    help: 'Chat with endpoints through the Kubernetes service proxy.',
  },
  {
    key: 'podMetricsScrape',
    label: 'Read vLLM metrics from pods',
    help: 'When Prometheus is not available, read /metrics of vLLM pods through the pod proxy.',
  },
  {
    key: 'nodeGpuSection',
    label: 'GPU section on Node pages',
    help: 'Adds GPU inventory and allocation to the native Node detail page.',
  },
  {
    key: 'podAiSection',
    label: 'AI workload section on Pod pages',
    help: 'Adds model, role and endpoint information to the native Pod detail page.',
  },
];

interface ServiceJson {
  metadata: { name: string; namespace: string };
  spec?: { ports?: Array<{ name?: string; port: number }> };
}

function validatePrometheus(p: PrometheusSettings): string | null {
  if (p.mode === 'service') {
    const s = p.service;
    if (!s?.namespace || !s.name) return t('Enter the namespace and name of the service.');
    if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) {
      return t('Enter a valid port (1-65535).');
    }
    if (s.pathPrefix && !s.pathPrefix.startsWith('/'))
      return t('The path prefix must start with /.');
  }
  if (p.mode === 'url') {
    try {
      const url = new URL(p.url || '');
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    } catch {
      return t('Enter an http(s) URL, for example https://prometheus.example.com.');
    }
  }
  return null;
}

/** General settings that do not depend on a cluster. */
function GeneralSettings() {
  const settings = useSettings();
  const features = featuresOf(settings);
  return (
    <SectionBox title={t('General')}>
      <Stack spacing={3} sx={{ py: 1 }}>
        <FormControl sx={{ maxWidth: 320 }} size="small">
          <InputLabel id="ih-refresh">{t('Refresh interval')}</InputLabel>
          <Select
            labelId="ih-refresh"
            label={t('Refresh interval')}
            value={settings.refreshSeconds ?? DEFAULT_REFRESH_SECONDS}
            onChange={e => settingsStore.update({ refreshSeconds: Number(e.target.value) })}
          >
            {REFRESH_CHOICES.map(s => (
              <MenuItem key={s} value={s}>
                {t('Every {{s}} seconds', { s })}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box>
          <FormLabel component="legend">{t('Features')}</FormLabel>
          {FEATURES.map(f => (
            <Box key={f.key} sx={{ mt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={features[f.key]}
                    onChange={e =>
                      settingsStore.update({
                        features: { ...(settings.features || {}), [f.key]: e.target.checked },
                      })
                    }
                  />
                }
                label={t(f.label)}
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -0.5 }}>
                {t(f.help)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Stack>
    </SectionBox>
  );
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; endpoint: PrometheusEndpoint }
  | { status: 'failed'; message: string };

/** Cluster specific settings: metrics backend and default namespace. */
function ClusterSettingsSection({ cluster }: { cluster: string }) {
  const settings = useSettings();
  const { enqueueSnackbar } = useSnackbar();
  const stored = clusterSettingsOf(settings, cluster);
  const [prom, setProm] = React.useState<PrometheusSettings>(
    stored.prometheus || DEFAULT_PROMETHEUS
  );
  const [defaultNamespace, setDefaultNamespace] = React.useState(stored.defaultNamespace || '');
  const [test, setTest] = React.useState<TestState>({ status: 'idle' });
  const [candidates, setCandidates] = React.useState<ServiceJson[] | null>(null);
  const namespaces = useCoreList('v1', 'namespaces', false, {}, 60000);

  React.useEffect(() => {
    setProm(stored.prometheus || DEFAULT_PROMETHEUS);
    setDefaultNamespace(stored.defaultNamespace || '');
    setTest({ status: 'idle' });
    // Reset the draft only when the cluster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster]);

  React.useEffect(() => {
    if (prom.mode !== 'service' || candidates) return;
    ApiProxy.request('/api/v1/services', clusterParams(cluster))
      .then((list: { items?: ServiceJson[] }) => setCandidates(list.items || []))
      .catch(() => setCandidates([]));
  }, [prom.mode, candidates, cluster]);

  const suggestions = React.useMemo(
    () => rankPrometheusServices(candidates || []).slice(0, 6),
    [candidates]
  );
  const error = validatePrometheus(prom);
  const dirty =
    JSON.stringify(prom) !== JSON.stringify(stored.prometheus || DEFAULT_PROMETHEUS) ||
    defaultNamespace !== (stored.defaultNamespace || '');

  const setService = (patch: Partial<NonNullable<PrometheusSettings['service']>>) =>
    setProm(p => ({
      ...p,
      service: { namespace: '', name: '', port: 9090, ...(p.service || {}), ...patch },
    }));

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      const endpoint = await resolvePrometheus(prom, cluster, true);
      if (!endpoint) {
        setTest({ status: 'failed', message: t('No Prometheus compatible service was found.') });
        return;
      }
      await testEndpoint(endpoint, cluster);
      setTest({ status: 'ok', endpoint });
    } catch (err) {
      setTest({ status: 'failed', message: (err as Error)?.message || String(err) });
    }
  };

  const save = () => {
    updateClusterSettings(cluster, {
      prometheus: prom,
      defaultNamespace: defaultNamespace || undefined,
    });
    enqueueSnackbar(t('Settings saved for cluster {{cluster}}', { cluster }), {
      variant: 'success',
    });
  };

  return (
    <SectionBox title={t('Cluster: {{cluster}}', { cluster })}>
      <Stack spacing={3} sx={{ py: 1 }}>
        <FormControl sx={{ maxWidth: 320 }} size="small">
          <InputLabel id="ih-default-ns">{t('Default namespace')}</InputLabel>
          <Select
            labelId="ih-default-ns"
            label={t('Default namespace')}
            value={defaultNamespace}
            onChange={e => setDefaultNamespace(String(e.target.value))}
          >
            <MenuItem value="">
              <em>{t('None (all namespaces)')}</em>
            </MenuItem>
            {defaultNamespace &&
              !namespaces.items.some(ns => ns.metadata.name === defaultNamespace) && (
                <MenuItem value={defaultNamespace}>{defaultNamespace}</MenuItem>
              )}
            {namespaces.items.map(ns => (
              <MenuItem key={ns.metadata.name} value={ns.metadata.name}>
                {ns.metadata.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl>
          <FormLabel id="ih-prom-mode">{t('Metrics (Prometheus)')}</FormLabel>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(
              'Used for GPU (DCGM), vLLM and traffic metrics. Without Prometheus, vLLM metrics can still be read from pods directly.'
            )}
          </Typography>
          <RadioGroup
            aria-labelledby="ih-prom-mode"
            value={prom.mode}
            onChange={e => {
              setProm(p => ({ ...p, mode: e.target.value as PrometheusMode }));
              setTest({ status: 'idle' });
            }}
          >
            <FormControlLabel
              value="auto"
              control={<Radio />}
              label={t(
                'Discover automatically (Thanos first, then Prometheus, Mimir, VictoriaMetrics)'
              )}
            />
            <FormControlLabel
              value="service"
              control={<Radio />}
              label={t('Use a service in the cluster')}
            />
            <FormControlLabel value="url" control={<Radio />} label={t('Use a direct URL')} />
            <FormControlLabel value="off" control={<Radio />} label={t('Disabled')} />
          </RadioGroup>
        </FormControl>

        {prom.mode === 'service' && (
          <Box>
            {suggestions.length > 0 && (
              <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('Detected:')}
                </Typography>
                {suggestions.map(s => (
                  <Chip
                    key={`${s.namespace}/${s.name}:${s.port}`}
                    size="small"
                    icon={<Icon icon="mdi:chart-line" />}
                    label={endpointFromService(s).label}
                    onClick={() => setProm(p => ({ ...p, service: s }))}
                  />
                ))}
              </Box>
            )}
            <Grid container spacing={2} sx={{ maxWidth: 900 }}>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('Namespace')}
                  value={prom.service?.namespace || ''}
                  onChange={e => setService({ namespace: e.target.value.trim() })}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('Service name')}
                  value={prom.service?.name || ''}
                  onChange={e => setService({ name: e.target.value.trim() })}
                />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label={t('Port')}
                  value={prom.service?.port ?? 9090}
                  onChange={e => setService({ port: Number(e.target.value) })}
                />
              </Grid>
              <Grid item xs={6} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="ih-prom-scheme">{t('Scheme')}</InputLabel>
                  <Select
                    labelId="ih-prom-scheme"
                    label={t('Scheme')}
                    value={prom.service?.scheme || 'http'}
                    onChange={e => setService({ scheme: e.target.value as 'http' | 'https' })}
                  >
                    <MenuItem value="http">http</MenuItem>
                    <MenuItem value="https">https</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('Path prefix (optional)')}
                  placeholder="/prometheus"
                  value={prom.service?.pathPrefix || ''}
                  onChange={e => setService({ pathPrefix: e.target.value.trim() || undefined })}
                />
              </Grid>
            </Grid>
          </Box>
        )}

        {prom.mode === 'url' && (
          <Box sx={{ maxWidth: 640 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              {t(
                'Requests go directly from Headlamp to this URL, not through the cluster. The URL must allow cross-origin requests.'
              )}
            </Alert>
            <TextField
              fullWidth
              size="small"
              label={t('Prometheus URL')}
              placeholder="https://prometheus.example.com"
              value={prom.url || ''}
              onChange={e => setProm(p => ({ ...p, url: e.target.value.trim() }))}
            />
          </Box>
        )}

        {prom.mode !== 'off' && (
          <TextField
            size="small"
            sx={{ maxWidth: 320 }}
            label={t('Tenant (X-Scope-OrgID, optional)')}
            value={prom.orgId || ''}
            onChange={e => setProm(p => ({ ...p, orgId: e.target.value.trim() || undefined }))}
          />
        )}

        {error && <Alert severity="warning">{error}</Alert>}
        {test.status === 'ok' && (
          <Alert severity="success">
            {t('Connected to {{label}}', { label: test.endpoint.label })}
          </Alert>
        )}
        {test.status === 'failed' && (
          <Alert severity="error">{t('Connection failed: {{m}}', { m: test.message })}</Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" onClick={save} disabled={!dirty || !!error}>
            {t('Save')}
          </Button>
          {prom.mode !== 'off' && (
            <Button
              variant="outlined"
              onClick={runTest}
              disabled={!!error || test.status === 'testing'}
              startIcon={
                test.status === 'testing' ? (
                  <CircularProgress size={16} />
                ) : (
                  <Icon icon="mdi:connection" />
                )
              }
            >
              {t('Test connection')}
            </Button>
          )}
        </Box>
      </Stack>
    </SectionBox>
  );
}

/** Inference Hub > Settings page (inside a cluster). */
export function SettingsPage() {
  const cluster = useCurrentCluster();
  return (
    <>
      {cluster && <ClusterSettingsSection cluster={cluster} />}
      <GeneralSettings />
    </>
  );
}

/** Rendered by Headlamp in Settings > Plugins > inference-hub (outside of any cluster). */
export function PluginSettingsPanel() {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Cluster specific settings (Prometheus endpoint, default namespace) are under Inference Hub > Settings inside each cluster.'
        )}
      </Typography>
      <GeneralSettings />
    </Box>
  );
}
