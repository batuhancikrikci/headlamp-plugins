import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  Affinity,
  ANNOTATIONS,
  GlobalServiceSettings,
  globalServiceSettings,
} from '../../api/clustermesh';
import { saveGlobalService } from '../../api/clustermeshData';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';
import { ServiceLike } from '../../resources/types';

type SyncChoice = 'default' | 'true' | 'false';

/** Edits the Cluster Mesh annotations of one Service. */
export function GlobalServiceDialog({
  service,
  onClose,
  onSaved,
}: {
  service: ServiceLike;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useText();
  const initial = globalServiceSettings(service.metadata.annotations);
  const [settings, setSettings] = React.useState<GlobalServiceSettings>(
    initial.global ? initial : { ...initial, global: true, shared: true }
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (patch: Partial<GlobalServiceSettings>) => setSettings(s => ({ ...s, ...patch }));
  const sync: SyncChoice =
    settings.syncEndpointSlices === undefined
      ? 'default'
      : settings.syncEndpointSlices
      ? 'true'
      : 'false';

  const preview = [
    `${ANNOTATIONS.global}: ${settings.global ? '"true"' : '(removed)'}`,
    ...(settings.global
      ? [
          `${ANNOTATIONS.shared}: ${settings.shared ? '(default, shared)' : '"false"'}`,
          `${ANNOTATIONS.affinity}: ${
            settings.affinity === 'none' ? '(default, none)' : `"${settings.affinity}"`
          }`,
          `${ANNOTATIONS.syncEndpointSlices}: ${
            sync === 'default' ? '(cluster default)' : `"${sync}"`
          }`,
        ]
      : []),
  ].join('\n');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveGlobalService(
        { name: service.metadata.name, namespace: service.metadata.namespace || 'default' },
        settings
      );
      onSaved?.();
      onClose();
    } catch (err) {
      setError((err as Error).message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('Cluster Mesh settings of {{name}}', {
          name: `${service.metadata.namespace}/${service.metadata.name}`,
        })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t(
              'A global service is load-balanced across the clusters of the mesh: a Service with the same name and namespace must exist in every cluster that takes part.'
            )}
          </Typography>
          <FormControlLabel
            control={
              <Switch checked={settings.global} onChange={e => set({ global: e.target.checked })} />
            }
            label={t('Global service')}
          />
          {settings.global && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.shared}
                    onChange={e => set({ shared: e.target.checked })}
                  />
                }
                label={t('Share the endpoints of this cluster with the other clusters')}
              />
              <TextField
                select
                size="small"
                label={t('Affinity')}
                value={settings.affinity}
                onChange={e => set({ affinity: e.target.value as Affinity })}
                helperText={t('Which endpoints are preferred while they are available.')}
              >
                <MenuItem value="none">{t('None: all clusters equally')}</MenuItem>
                <MenuItem value="local">{t('Local: this cluster first')}</MenuItem>
                <MenuItem value="remote">{t('Remote: other clusters first')}</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label={t('EndpointSlices of remote endpoints')}
                value={sync}
                onChange={e =>
                  set({
                    syncEndpointSlices:
                      e.target.value === 'default' ? undefined : e.target.value === 'true',
                  })
                }
                helperText={t(
                  'Creates EndpointSlices for the remote endpoints, e.g. for headless services or ingress controllers.'
                )}
              >
                <MenuItem value="default">{t('Cluster default')}</MenuItem>
                <MenuItem value="true">{t('Synchronize')}</MenuItem>
                <MenuItem value="false">{t('Do not synchronize')}</MenuItem>
              </TextField>
            </>
          )}
          <CodeBlock value={preview} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {t('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
