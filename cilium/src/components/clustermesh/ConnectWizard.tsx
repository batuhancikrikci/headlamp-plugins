import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
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
  EMPTY_MANUAL_CLUSTER,
  helmValues,
  invalidCidrs,
  ManualCluster,
  manualFacts,
  manualFromFacts,
  meshChecks,
  meshIdentity,
} from '../../api/clustermesh';
import { factsOf, loadMeshState } from '../../api/clustermeshData';
import { CodeBlock } from '../../common/CodeBlock';
import { useText } from '../../common/i18n';

const STATUS_ICON: Record<CheckStatus, { icon: string; color: string }> = {
  ok: { icon: 'mdi:check-circle', color: 'success.main' },
  warning: { icon: 'mdi:alert', color: 'warning.main' },
  error: { icon: 'mdi:close-circle', color: 'error.main' },
  unknown: { icon: 'mdi:help-circle-outline', color: 'text.secondary' },
};

/** The Cilium values of one cluster, as found in its cilium-config ConfigMap. */
function ClusterForm({
  title,
  value,
  onChange,
  action,
}: {
  title: string;
  value: ManualCluster;
  onChange: (value: ManualCluster) => void;
  action?: React.ReactNode;
}) {
  const { t } = useText();
  const set = (patch: Partial<ManualCluster>) => onChange({ ...value, ...patch });
  const badCidrs = invalidCidrs(value.podCidrs);
  const row = { display: 'flex', gap: 2, flexWrap: 'wrap' } as const;
  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
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
 * Checks the prerequisites of connecting two clusters from their Cilium values and gives the
 * cilium CLI commands or Helm values for it. The values are entered, so any two clusters can be
 * planned; the cluster on this page can fill in the first one. Nothing is applied: the clustermesh
 * certificates and the Cilium installation itself are managed by the CLI or Helm.
 */
export function ConnectWizard({ cluster, onClose }: { cluster?: string; onClose: () => void }) {
  const { t } = useText();
  const [first, setFirst] = React.useState<ManualCluster>(EMPTY_MANUAL_CLUSTER);
  const [second, setSecond] = React.useState<ManualCluster>(EMPTY_MANUAL_CLUSTER);
  const [step, setStep] = React.useState(0);
  const [filling, setFilling] = React.useState(false);
  const [fillError, setFillError] = React.useState<string | null>(null);
  const firstName = first.name.trim();
  const secondName = second.name.trim();
  const [firstContext, setFirstContext] = React.useState('');
  const [secondContext, setSecondContext] = React.useState('');
  const [serviceType, setServiceType] = React.useState<'LoadBalancer' | 'NodePort'>('LoadBalancer');

  React.useEffect(() => setFirstContext(firstName), [firstName]);
  React.useEffect(() => setSecondContext(secondName), [secondName]);

  const firstFacts = manualFacts(first, 'first cluster');
  const secondFacts = manualFacts(second, 'second cluster');
  const checks = meshChecks(firstFacts, secondFacts);
  const blocking = checks.filter(c => c.status === 'error').length;
  const valid = (c: ManualCluster) => c.name.trim() !== '' && invalidCidrs(c.podCidrs).length === 0;
  const canContinue = valid(first) && valid(second);

  const fillFromPage = async () => {
    setFilling(true);
    setFillError(null);
    try {
      const state = await loadMeshState(cluster || undefined);
      if (!state.config) throw new Error(t('cilium-config could not be read.'));
      setFirst(manualFromFacts(factsOf(cluster || '', state)));
    } catch (err) {
      setFillError((err as Error).message || String(err));
    } finally {
      setFilling(false);
    }
  };

  const steps = [t('Clusters'), t('Checks'), t('Commands')];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('Connect two clusters with Cluster Mesh')}</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {steps.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              {t(
                'Enter the Cilium values of both clusters, from the cilium-config ConfigMap of each (cluster-name, cluster-id, max-connected-clusters, routing-mode). Only the names are required; what is left empty is not checked.'
              )}
            </Typography>
            <ClusterForm
              title={t('First cluster')}
              value={first}
              onChange={setFirst}
              action={
                <Button
                  size="small"
                  disabled={filling}
                  startIcon={<Icon icon="mdi:download" />}
                  onClick={fillFromPage}
                >
                  {t('Fill in from the cluster on this page')}
                </Button>
              }
            />
            {fillError && <Alert severity="error">{fillError}</Alert>}
            <ClusterForm title={t('Second cluster')} value={second} onChange={setSecond} />
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1.5}>
            {checks.map(check => (
              <Box key={check.id} sx={{ display: 'flex', gap: 1.5 }}>
                <Box sx={{ color: STATUS_ICON[check.status].color, display: 'flex', mt: '2px' }}>
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
                'Checked from the entered values only. Not checked: the state of the clusters (Cilium and API server pods), and whether nodes (and with native routing, pods) of both clusters have IP connectivity to each other and can reach the Cluster Mesh API servers.'
              )}
            </Alert>
            {blocking > 0 && (
              <Alert severity="error">
                {t('{{n}} check(s) failed: fix them before connecting the clusters.', {
                  n: blocking,
                })}
              </Alert>
            )}
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label={t('kubectl context of {{c}}', { c: firstFacts.cluster })}
                value={firstContext}
                onChange={e => setFirstContext(e.target.value)}
              />
              <TextField
                size="small"
                label={t('kubectl context of {{c}}', { c: secondFacts.cluster })}
                value={secondContext}
                onChange={e => setSecondContext(e.target.value)}
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
            <Typography variant="body2" color="text.secondary">
              {t(
                'Run them where kubectl has a context for both clusters. Without such a machine, use the Helm values.'
              )}
            </Typography>
            <CodeBlock value={connectCommands(firstContext, secondContext, serviceType)} />
            <Typography variant="subtitle2">{t('Or with Helm values')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t(
                'Add these values to the Cilium release of each cluster. Share the certificate authority first (step 1 above), so both clusters trust each other.'
              )}
            </Typography>
            {[
              { self: firstFacts, peer: secondFacts },
              { self: secondFacts, peer: firstFacts },
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
                        address: peer.apiserver?.address,
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
            disabled={step === 0 && !canContinue}
            onClick={() => setStep(s => s + 1)}
          >
            {step === 1 && blocking > 0 ? t('Show the commands anyway') : t('Next')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
