/**
 * Argo CD application actions: refresh, hard refresh and sync. Pull-model applications are
 * reconciled on the managed cluster, so the hub copy has no actions.
 */
import { Icon } from '@iconify/react';
import { AuthVisible } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { FieldGrid, SwitchInput, TextInput } from '../../common/form/Fields';
import { useText } from '../../common/i18n';
import { errorMessage } from '../../common/States';
import {
  appSources,
  ArgoApplicationJson,
  isPullModel,
  refreshPatch,
  syncPatch,
} from '../../resources/models/argo';
import { ActionButton } from '../common/ActionButton';

function SyncDialog({ item, onClose }: { item: KubeObject; onClose: () => void }) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const app = item.jsonData as ArgoApplicationJson;
  const multiSource = appSources(app.spec).length > 1;
  const [revision, setRevision] = React.useState<string | undefined>();
  const [prune, setPrune] = React.useState<boolean | undefined>(false);
  const [dryRun, setDryRun] = React.useState<boolean | undefined>(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const running = app.status?.operationState?.phase === 'Running';

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await item.patch(syncPatch({ revision, prune, dryRun }));
      enqueueSnackbar(t('Sync of {{name}} requested', { name: app.metadata.name }), {
        variant: 'success',
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Sync {{name}}', { name: app.metadata.name })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t(
            'Writes a sync operation to the Application, as "argocd app sync" does. The Argo CD application controller runs it and clears the operation when it finishes.'
          )}
        </Typography>
        {running && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('An operation is already running for this application.')}
          </Alert>
        )}
        <FieldGrid columns={1}>
          {!multiSource && (
            <TextInput
              label={t('Revision (optional)')}
              value={revision}
              onChange={setRevision}
              placeholder={appSources(app.spec)[0]?.targetRevision || 'HEAD'}
              help={t('Branch, tag or commit to sync to; empty uses the target revision.')}
            />
          )}
          <SwitchInput
            label={t('Prune resources that are no longer in Git')}
            value={prune}
            onChange={setPrune}
          />
          <SwitchInput label={t('Dry run')} value={dryRun} onChange={setDryRun} />
        </FieldGrid>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button
          variant="contained"
          onClick={start}
          disabled={busy || running}
          startIcon={busy ? <CircularProgress size={16} /> : <Icon icon="mdi:sync" />}
        >
          {t('Sync')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ArgoAppActions({ item }: { item: KubeObject }) {
  const { t } = useText();
  const [syncing, setSyncing] = React.useState(false);
  const app = item.jsonData as ArgoApplicationJson;
  if (isPullModel(app)) return null;
  const name = app.metadata.name;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <ActionButton
        label={t('Refresh')}
        icon="mdi:refresh"
        authItem={item}
        authVerb="patch"
        run={() => item.patch(refreshPatch('normal'))}
        successMessage={t('Refresh of {{name}} requested', { name })}
      />
      <ActionButton
        label={t('Hard refresh')}
        icon="mdi:refresh-circle"
        authItem={item}
        authVerb="patch"
        run={() => item.patch(refreshPatch('hard'))}
        successMessage={t('Hard refresh of {{name}} requested', { name })}
        confirm={{
          title: t('Hard refresh {{name}}?', { name }),
          description: t(
            'Argo CD invalidates its manifest cache for this application and regenerates the manifests from the source.'
          ),
        }}
      />
      <AuthVisible item={item} authVerb="patch">
        <Tooltip title={t('Sync')}>
          <IconButton aria-label={t('Sync')} color="primary" onClick={() => setSyncing(true)}>
            <Icon icon="mdi:sync" />
          </IconButton>
        </Tooltip>
      </AuthVisible>
      {syncing && <SyncDialog item={item} onClose={() => setSyncing(false)} />}
    </Box>
  );
}
