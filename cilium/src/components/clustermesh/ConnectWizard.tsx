import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  CheckStatus,
  connectCommands,
  helmValues,
  meshChecks,
  meshIdentity,
} from '../../api/clustermesh';
import { factsOf, loadMeshState, MeshState } from '../../api/clustermeshData';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';

const STATUS_ICON: Record<CheckStatus, { icon: string; color: string }> = {
  ok: { icon: 'mdi:check-circle', color: 'success.main' },
  warning: { icon: 'mdi:alert', color: 'warning.main' },
  error: { icon: 'mdi:close-circle', color: 'error.main' },
  unknown: { icon: 'mdi:help-circle-outline', color: 'text.secondary' },
};

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; state: MeshState }
  | { status: 'error'; message: string };

function useMeshState(cluster: string | undefined): Loaded | undefined {
  const [loaded, setLoaded] = React.useState<Loaded>();
  React.useEffect(() => {
    if (!cluster) {
      setLoaded(undefined);
      return;
    }
    let cancelled = false;
    setLoaded({ status: 'loading' });
    loadMeshState(cluster)
      .then(state => !cancelled && setLoaded({ status: 'ready', state }))
      .catch(err => !cancelled && setLoaded({ status: 'error', message: (err as Error).message }));
    return () => {
      cancelled = true;
    };
  }, [cluster]);
  return loaded;
}

/**
 * Checks the prerequisites of connecting this cluster with another cluster configured in Headlamp
 * and gives the cilium CLI commands or Helm values for it. Nothing is applied: the clustermesh
 * certificates and the Cilium installation itself are managed by the CLI or Helm.
 */
export function ConnectWizard({ cluster, onClose }: { cluster: string; onClose: () => void }) {
  const { t } = useText();
  const clusters = Object.keys(K8s.useClustersConf() || {}).filter(name => name !== cluster);
  const [remote, setRemote] = React.useState(clusters[0] || '');
  const [step, setStep] = React.useState(0);
  const [localContext, setLocalContext] = React.useState(cluster);
  const [remoteContext, setRemoteContext] = React.useState(remote);
  const [serviceType, setServiceType] = React.useState<'LoadBalancer' | 'NodePort'>('LoadBalancer');
  const local = useMeshState(cluster);
  const other = useMeshState(step > 0 ? remote : undefined);

  React.useEffect(() => setRemoteContext(remote), [remote]);

  const ready = local?.status === 'ready' && other?.status === 'ready';
  const localFacts = local?.status === 'ready' ? factsOf(cluster, local.state) : undefined;
  const remoteFacts = other?.status === 'ready' ? factsOf(remote, other.state) : undefined;
  const checks = localFacts && remoteFacts ? meshChecks(localFacts, remoteFacts) : [];
  const blocking = checks.filter(c => c.status === 'error').length;
  const namespace = (local?.status === 'ready' && local.state.namespace) || 'kube-system';

  const steps = [t('Cluster'), t('Checks'), t('Commands')];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('Connect a cluster with Cluster Mesh')}</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {steps.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t(
                'Pick the other cluster from the clusters configured in Headlamp. Both are read with your permissions (cilium-config, the Cilium pods, CiliumNodes and the clustermesh-apiserver Service); Secrets are not read.'
              )}
            </Typography>
            {clusters.length === 0 ? (
              <Alert severity="info">
                {t('Headlamp knows no other cluster. Add the other cluster to Headlamp first.')}
              </Alert>
            ) : (
              <TextField
                select
                size="small"
                label={t('Other cluster')}
                value={remote}
                onChange={e => setRemote(e.target.value)}
              >
                {clusters.map(name => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1.5}>
            {!ready ? (
              local?.status === 'error' || other?.status === 'error' ? (
                <Alert severity="error">
                  {local?.status === 'error' ? `${cluster}: ${local.message}` : ''}
                  {other?.status === 'error' ? ` ${remote}: ${other.message}` : ''}
                </Alert>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">{t('Reading both clusters…')}</Typography>
                </Box>
              )
            ) : (
              <>
                {checks.map(check => (
                  <Box key={check.id} sx={{ display: 'flex', gap: 1.5 }}>
                    <Box
                      sx={{ color: STATUS_ICON[check.status].color, display: 'flex', mt: '2px' }}
                    >
                      <Icon icon={STATUS_ICON[check.status].icon} width={20} />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2">{check.label}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {check.detail}
                      </Typography>
                    </Box>
                  </Box>
                ))}
                <Alert severity="info">
                  {t(
                    'Not checked here: nodes (and with native routing, pods) of both clusters need IP connectivity to each other, and the firewall must let the clusters reach the Cluster Mesh API server.'
                  )}
                </Alert>
                {blocking > 0 && (
                  <Alert severity="error">
                    {t('{{n}} check(s) failed: fix them before connecting the clusters.', {
                      n: blocking,
                    })}
                  </Alert>
                )}
              </>
            )}
          </Stack>
        )}

        {step === 2 && localFacts && remoteFacts && (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label={t('kubectl context of {{c}}', { c: cluster })}
                value={localContext}
                onChange={e => setLocalContext(e.target.value)}
              />
              <TextField
                size="small"
                label={t('kubectl context of {{c}}', { c: remote })}
                value={remoteContext}
                onChange={e => setRemoteContext(e.target.value)}
              />
              <TextField
                select
                size="small"
                label={t('API server Service type')}
                value={serviceType}
                onChange={e => setServiceType(e.target.value as 'LoadBalancer' | 'NodePort')}
                sx={{ minWidth: 200 }}
              >
                <MenuItem value="LoadBalancer">LoadBalancer</MenuItem>
                <MenuItem value="NodePort">NodePort</MenuItem>
              </TextField>
            </Box>
            <Typography variant="subtitle2">{t('With the cilium CLI')}</Typography>
            <CodeBlock
              value={connectCommands(localContext, remoteContext, serviceType, namespace)}
            />
            <Typography variant="subtitle2">{t('Or with Helm values')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                'Add these values to the Cilium release of each cluster. Share the certificate authority first (step 1 above), so both clusters trust each other.'
              )}
            </Typography>
            {[
              { self: localFacts, peer: remoteFacts },
              { self: remoteFacts, peer: localFacts },
            ].map(({ self, peer }) => {
              const id = meshIdentity(self.config);
              const peerId = meshIdentity(peer.config);
              return (
                <Box key={self.cluster}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {self.cluster}
                  </Typography>
                  <CodeBlock
                    value={helmValues(
                      { name: id.name, id: id.id },
                      {
                        name: peerId.name,
                        address:
                          peer.apiserver?.type === 'LoadBalancer'
                            ? peer.apiserver.address
                            : undefined,
                        port: peer.apiserver?.port,
                      },
                      serviceType
                    )}
                  />
                </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Close')}</Button>
        {step > 0 && <Button onClick={() => setStep(s => s - 1)}>{t('Back')}</Button>}
        {step < 2 && (
          <Button
            variant="contained"
            disabled={(step === 0 && !remote) || (step === 1 && !ready)}
            onClick={() => setStep(s => s + 1)}
          >
            {step === 1 && blocking > 0 ? t('Show the commands anyway') : t('Next')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
