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
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
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
  EMPTY_MANUAL_CLUSTER,
  helmValues,
  invalidCidrs,
  ManualCluster,
  manualFacts,
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

/** Fields of a cluster Headlamp does not know. */
function ManualClusterForm({
  value,
  onChange,
}: {
  value: ManualCluster;
  onChange: (value: ManualCluster) => void;
}) {
  const { t } = useText();
  const set = (patch: Partial<ManualCluster>) => onChange({ ...value, ...patch });
  const badCidrs = invalidCidrs(value.podCidrs);
  const row = { display: 'flex', gap: 2, flexWrap: 'wrap' } as const;
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t(
          'Take the values from the cilium-config ConfigMap of the other cluster (cluster-name, cluster-id, max-connected-clusters, routing-mode). Only the name is required; what is left empty is not checked.'
        )}
      </Typography>
      <Box sx={row}>
        <TextField
          size="small"
          required
          label={t('Cilium cluster name')}
          value={value.name}
          onChange={e => set({ name: e.target.value })}
        />
        <TextField
          size="small"
          label={t('Cluster ID')}
          value={value.id}
          onChange={e => set({ id: e.target.value })}
          sx={{ width: 120 }}
        />
        <TextField
          size="small"
          select
          label={t('Maximum of connected clusters')}
          value={value.maxConnected}
          onChange={e => set({ maxConnected: e.target.value })}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="255">255</MenuItem>
          <MenuItem value="511">511</MenuItem>
        </TextField>
      </Box>
      <Box sx={row}>
        <TextField
          size="small"
          select
          label={t('Routing mode')}
          value={value.routing}
          onChange={e => set({ routing: e.target.value as ManualCluster['routing'] })}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">{t('Unknown')}</MenuItem>
          <MenuItem value="tunnel">{t('Tunnel')}</MenuItem>
          <MenuItem value="native">{t('Native')}</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t('Cilium version')}
          placeholder="v1.20.4"
          value={value.version}
          onChange={e => set({ version: e.target.value })}
        />
      </Box>
      <TextField
        size="small"
        multiline
        minRows={2}
        label={t('Pod CIDRs')}
        placeholder="10.1.0.0/16"
        value={value.podCidrs}
        onChange={e => set({ podCidrs: e.target.value })}
        error={badCidrs.length > 0}
        helperText={
          badCidrs.length > 0
            ? t('Not a CIDR: {{list}}', { list: badCidrs.join(', ') })
            : t('Separated by commas or new lines.')
        }
      />
      <Box sx={row}>
        <TextField
          size="small"
          label={t('Address of its Cluster Mesh API server')}
          placeholder="192.0.2.10"
          value={value.address}
          onChange={e => set({ address: e.target.value })}
          sx={{ flexGrow: 1, minWidth: 240 }}
        />
        <TextField
          size="small"
          label={t('Port')}
          value={value.port}
          onChange={e => set({ port: e.target.value })}
          sx={{ width: 120 }}
        />
      </Box>
    </Stack>
  );
}

/**
 * Checks the prerequisites of connecting this cluster with another one, read from Headlamp's
 * clusters or entered by hand, and gives the cilium CLI commands or Helm values for it. Nothing is applied: the clustermesh
 * certificates and the Cilium installation itself are managed by the CLI or Helm.
 */
export function ConnectWizard({ cluster, onClose }: { cluster: string; onClose: () => void }) {
  const { t } = useText();
  const clusters = Object.keys(K8s.useClustersConf() || {}).filter(name => name !== cluster);
  const [source, setSource] = React.useState<'headlamp' | 'manual'>(
    clusters.length > 0 ? 'headlamp' : 'manual'
  );
  const [remote, setRemote] = React.useState(clusters[0] || '');
  const [manual, setManual] = React.useState<ManualCluster>(EMPTY_MANUAL_CLUSTER);
  const [step, setStep] = React.useState(0);
  const isManual = source === 'manual';
  const remoteName = isManual ? manual.name.trim() : remote;
  const [localContext, setLocalContext] = React.useState(cluster);
  const [remoteContext, setRemoteContext] = React.useState(remoteName);
  const [serviceType, setServiceType] = React.useState<'LoadBalancer' | 'NodePort'>('LoadBalancer');
  const local = useMeshState(cluster);
  const other = useMeshState(step > 0 && !isManual ? remote : undefined);

  React.useEffect(() => setRemoteContext(remoteName), [remoteName]);

  const ready = local?.status === 'ready' && (isManual || other?.status === 'ready');
  const localFacts = local?.status === 'ready' ? factsOf(cluster, local.state) : undefined;
  const remoteFacts = isManual
    ? manualFacts(manual)
    : other?.status === 'ready'
    ? factsOf(remote, other.state)
    : undefined;
  const canContinue = isManual
    ? remoteName !== '' && invalidCidrs(manual.podCidrs).length === 0
    : remote !== '';
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
            <RadioGroup
              row
              value={source}
              onChange={e => setSource(e.target.value as 'headlamp' | 'manual')}
            >
              <FormControlLabel
                value="headlamp"
                control={<Radio />}
                disabled={clusters.length === 0}
                label={t('A cluster configured in Headlamp')}
              />
              <FormControlLabel value="manual" control={<Radio />} label={t('Enter it by hand')} />
            </RadioGroup>
            {isManual ? (
              <ManualClusterForm value={manual} onChange={setManual} />
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  {t(
                    'Both clusters are read with your permissions (cilium-config, the Cilium pods, CiliumNodes and the clustermesh-apiserver Service); Secrets are not read.'
                  )}
                </Typography>
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
              </>
            )}
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1.5}>
            {!ready ? (
              local?.status === 'error' || other?.status === 'error' ? (
                <Alert severity="error">
                  {local?.status === 'error' ? `${cluster}: ${local.message}` : ''}
                  {other?.status === 'error' && !isManual ? ` ${remote}: ${other.message}` : ''}
                </Alert>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2">
                    {isManual ? t('Reading this cluster…') : t('Reading both clusters…')}
                  </Typography>
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
                {isManual && (
                  <Alert severity="info">
                    {t(
                      '{{c}} was entered by hand: its values are compared as entered, and its own state (pods, API server) is not checked.',
                      { c: remoteName }
                    )}
                  </Alert>
                )}
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
            {isManual && (
              <Typography variant="body2" color="text.secondary">
                {t(
                  'The cilium CLI needs a kubectl context for both clusters. Without access to {{c}} from one machine, use the Helm values.',
                  { c: remoteName }
                )}
              </Typography>
            )}
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
                          peer.manual || peer.apiserver?.type === 'LoadBalancer'
                            ? peer.apiserver?.address
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
            disabled={(step === 0 && !canContinue) || (step === 1 && !ready)}
            onClick={() => setStep(s => s + 1)}
          >
            {step === 1 && blocking > 0 ? t('Show the commands anyway') : t('Next')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
