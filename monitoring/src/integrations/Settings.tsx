import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Box, MenuItem, TextField, Typography } from '@mui/material';
import React, { useState } from 'react';
import { useText } from '../common/i18n';
import {
  ClusterMonitoringSettings,
  DEFAULT_REFRESH_SECONDS,
  settingsStore,
  updateClusterSettings,
  useMonitoringSettings,
} from '../settings';
import { parseServiceOverride } from '../utils/discovery';

/** Plugin settings (Settings → Plugins → monitoring). */
export default function MonitoringSettings() {
  const { t } = useText();
  const settings = useMonitoringSettings();
  const clustersConf = K8s.useClustersConf() || {};
  const clusters = Object.keys(clustersConf).sort();
  const [cluster, setCluster] = useState<string>(clusters[0] || '');
  const cs: ClusterMonitoringSettings = settings.clusters?.[cluster] || {};

  const overrideField = (key: 'prometheusOverride' | 'alertmanagerOverride', label: string) => {
    const value = cs[key] || '';
    const invalid = !!value && !parseServiceOverride(value);
    return (
      <TextField
        size="small"
        fullWidth
        label={label}
        value={value}
        placeholder="monitoring/kube-prometheus-stack-prometheus:http-web"
        onChange={e => updateClusterSettings(cluster, { [key]: e.target.value || undefined })}
        error={invalid}
        helperText={
          invalid
            ? t('Format: [https://]namespace/service:port[/path-prefix]')
            : t('Leave empty to discover the service from the custom resource.')
        }
      />
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 640, py: 1 }}>
      <TextField
        select
        size="small"
        label={t('Auto refresh for live data')}
        value={settings.refreshInterval ?? DEFAULT_REFRESH_SECONDS}
        onChange={e => settingsStore.update({ refreshInterval: Number(e.target.value) })}
      >
        {[0, 10, 30, 60, 300].map(s => (
          <MenuItem key={s} value={s}>
            {s === 0 ? t('Off') : s < 60 ? `${s}s` : `${s / 60}m`}
          </MenuItem>
        ))}
      </TextField>

      <Typography variant="subtitle2">{t('Per-cluster service overrides')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t(
          'Use these when Prometheus/Alertmanager is exposed by a custom service (e.g. Thanos Query) or cannot be discovered from the custom resources.'
        )}
      </Typography>
      {clusters.length > 0 ? (
        <>
          <TextField
            select
            size="small"
            label={t('Cluster')}
            value={cluster}
            onChange={e => setCluster(e.target.value)}
          >
            {clusters.map(c => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          {overrideField('prometheusOverride', t('Prometheus service'))}
          {overrideField('alertmanagerOverride', t('Alertmanager service'))}
        </>
      ) : (
        <Typography color="text.secondary">{t('No clusters configured.')}</Typography>
      )}
    </Box>
  );
}
