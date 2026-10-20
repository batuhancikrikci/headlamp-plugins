/**
 * Cluster lifecycle actions: accept / revoke acceptance, assign to a cluster set, detach,
 * approve or deny registration CSRs, and enable / disable add-ons on a cluster.
 */
import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { AuthVisible, DateLabel, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { chosenApiVersion } from '../../api/discovery';
import { createResource } from '../../common/form/apply';
import { SelectInput, TextInput } from '../../common/form/Fields';
import { useText } from '../../common/i18n';
import { errorMessage } from '../../common/States';
import { useAvailability } from '../../hooks/useDiscovery';
import { useOcmList } from '../../hooks/useOcmList';
import {
  addonDisplayName,
  ClusterManagementAddOnJson,
  isV1beta1,
  ManagedClusterAddOnJson,
  newManagedClusterAddOn,
} from '../../resources/models/addon';
import {
  clusterSetOf,
  clusterSetPatch,
  csrCluster,
  csrDecisionBody,
  CSRJson,
  csrState,
  ManagedClusterJson,
  ManagedClusterSetJson,
  setSelectorType,
} from '../../resources/models/cluster';
import { crd } from '../../resources/registry';
import { ActionButton } from '../common/ActionButton';
import { makeRefObject, ResourceRefLink } from '../common/ResourceRefLink';

const CSR_API = '/apis/certificates.k8s.io/v1/certificatesigningrequests';

function decideCSR(csr: CSRJson, decision: 'Approved' | 'Denied') {
  const message =
    decision === 'Approved'
      ? 'Approved in Headlamp (Multicluster Hub)'
      : 'Denied in Headlamp (Multicluster Hub)';
  const body = csrDecisionBody(csr, decision, message, new Date().toISOString());
  // The body is the live CSR read from the API (it has every server field Headlamp's type marks
  // as required); only the conditions are added.
  return ApiProxy.put(`${CSR_API}/${csr.metadata.name}/approval`, body as KubeObjectInterface);
}

/** Approve / deny buttons for a pending registration CSR. */
export function CSRActions({ csr }: { csr: CSRJson }) {
  const { t } = useText();
  if (csrState(csr) !== 'pending') return null;
  const authItem = makeRefObject('CertificateSigningRequest', csr.metadata.name);
  const cluster = csrCluster(csr) || '?';
  return (
    <Box sx={{ display: 'inline-flex' }}>
      <ActionButton
        label={t('Approve')}
        icon="mdi:check-decagram"
        color="success"
        authItem={authItem}
        authVerb="update"
        subresource="approval"
        run={() => decideCSR(csr, 'Approved')}
        successMessage={t('CSR {{name}} approved', { name: csr.metadata.name })}
        confirm={{
          title: t('Approve certificate request?'),
          description: t(
            'The agent of cluster "{{cluster}}" (requested by {{user}}) receives a client certificate for this hub. Approve only requests you expect.',
            { cluster, user: csr.spec?.username || '?' }
          ),
        }}
      />
      <ActionButton
        label={t('Deny')}
        icon="mdi:close-octagon-outline"
        color="error"
        authItem={authItem}
        authVerb="update"
        subresource="approval"
        run={() => decideCSR(csr, 'Denied')}
        successMessage={t('CSR {{name}} denied', { name: csr.metadata.name })}
        confirm={{
          title: t('Deny certificate request?'),
          description: t(
            'The agent of cluster "{{cluster}}" will not receive credentials from this request.',
            {
              cluster,
            }
          ),
        }}
      />
    </Box>
  );
}

/** Pending registration CSRs of one cluster, shown on its detail page. */
export function PendingCSRs({ cluster }: { cluster: string }) {
  const { t } = useText();
  const csrs = useOcmList<CSRJson>('CertificateSigningRequest', {
    labelSelector: `open-cluster-management.io/cluster-name=${cluster}`,
  });
  const pending = (csrs.items || []).filter(c => csrState(c) === 'pending');
  if (csrs.missing || pending.length === 0) return null;
  return (
    <SectionBox title={t('Pending registration requests')}>
      <Alert severity="warning" sx={{ mb: 1 }}>
        {t(
          'The cluster agent is waiting for its certificate signing request to be approved before it can join.'
        )}
      </Alert>
      {pending.map(csr => (
        <Box
          key={csr.metadata.name}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
        >
          <ResourceRefLink kind="CertificateSigningRequest" name={csr.metadata.name} />
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {csr.spec?.username}
            {csr.metadata.creationTimestamp && (
              <>
                {' · '}
                <DateLabel date={csr.metadata.creationTimestamp} format="mini" />
              </>
            )}
          </Typography>
          <CSRActions csr={csr} />
        </Box>
      ))}
    </SectionBox>
  );
}

function AssignSetDialog({ item, onClose }: { item: KubeObject; onClose: () => void }) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const json = item.jsonData as ManagedClusterJson;
  const [value, setValue] = React.useState<string | undefined>(clusterSetOf(json));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Only sets that select by the cluster set label can be joined by labelling the cluster.
  const options = (sets.items || [])
    .filter(s => setSelectorType(s) === 'ExclusiveClusterSetLabel')
    .map(s => s.metadata.name)
    .sort();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await item.patch(clusterSetPatch(value || null));
      enqueueSnackbar(
        value
          ? t('Cluster {{name}} assigned to {{set}}', { name: json.metadata.name, set: value })
          : t('Cluster {{name}} removed from its set', { name: json.metadata.name }),
        { variant: 'success' }
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t('Assign {{name}} to a cluster set', { name: json.metadata.name })}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t(
            'Sets with the ExclusiveClusterSetLabel selector contain the clusters labelled cluster.open-cluster-management.io/clusterset=<set>. Changing the label requires the managedclustersets/join permission for both sets.'
          )}
        </Typography>
        <SelectInput
          label={t('Cluster set')}
          value={value}
          onChange={setValue}
          options={options}
          emptyLabel={t('No cluster set')}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          {t('Save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Enables (creates) and disables (deletes) ManagedClusterAddOns of one cluster. */
export function ManageAddonsDialog({ cluster, onClose }: { cluster: string; onClose: () => void }) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const availability = useAvailability();
  const cmas = useOcmList<ClusterManagementAddOnJson>('ClusterManagementAddOn');
  const mcas = useOcmList<ManagedClusterAddOnJson>('ManagedClusterAddOn', { namespace: cluster });
  const installed = React.useMemo(
    () => new Set((mcas.items || []).map(m => m.metadata.name)),
    [mcas.items]
  );
  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const [installNamespace, setInstallNamespace] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const apiVersion = chosenApiVersion(availability, crd('ManagedClusterAddOn')) || '';
  const current = selected || installed;

  const toggle = (name: string) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelected(next);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    const toAdd = Array.from(current).filter(n => !installed.has(n));
    const toRemove = Array.from(installed).filter(n => !current.has(n));
    try {
      for (const name of toAdd) {
        const body = newManagedClusterAddOn(apiVersion, name, cluster, installNamespace);
        await createResource(body);
      }
      const plural = `/apis/${apiVersion}/namespaces/${cluster}/managedclusteraddons`;
      for (const name of toRemove) {
        await ApiProxy.remove(`${plural}/${name}`);
      }
      enqueueSnackbar(
        t('Add-ons updated on {{cluster}}: {{added}} enabled, {{removed}} disabled', {
          cluster,
          added: toAdd.length,
          removed: toRemove.length,
        }),
        { variant: 'success' }
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const list = [...(cmas.items || [])].sort((a, b) =>
    a.metadata.name.localeCompare(b.metadata.name)
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Add-ons on {{cluster}}', { cluster })}</DialogTitle>
      <DialogContent>
        {cmas.items === null || mcas.items === null ? (
          <CircularProgress size={24} />
        ) : list.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('No add-ons are registered on the hub (ClusterManagementAddOn).')}
          </Typography>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t(
                'Checked add-ons get a ManagedClusterAddOn in the cluster namespace; unchecking one deletes it and uninstalls the add-on agent.'
              )}
            </Typography>
            {list.map(cma => (
              <Box key={cma.metadata.name}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={current.has(cma.metadata.name)}
                      onChange={() => toggle(cma.metadata.name)}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{addonDisplayName(cma)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {cma.metadata.name}
                        {cma.spec?.installStrategy?.type === 'Placements'
                          ? ` · ${t('also installed by placement')}`
                          : ''}
                      </Typography>
                    </Box>
                  }
                />
              </Box>
            ))}
            {!isV1beta1(apiVersion) && (
              <Box sx={{ mt: 2 }}>
                <TextInput
                  label={t('Install namespace (optional, deprecated)')}
                  value={installNamespace}
                  onChange={setInstallNamespace}
                  helperText={t(
                    'Only used by addon v1alpha1; prefer AddOnDeploymentConfig.spec.agentInstallNamespace.'
                  )}
                />
              </Box>
            )}
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button variant="contained" onClick={apply} disabled={busy || !selected}>
          {t('Apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Header actions of the ManagedCluster detail page. */
export function ClusterActions({ item }: { item: KubeObject }) {
  const { t } = useText();
  const [dialog, setDialog] = React.useState<'set' | 'addons' | null>(null);
  const json = item.jsonData as ManagedClusterJson;
  const name = json.metadata.name;
  const accepted = !!json.spec?.hubAcceptsClient;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {!accepted ? (
        <ActionButton
          label={t('Accept cluster')}
          icon="mdi:handshake-outline"
          color="success"
          authItem={item}
          authVerb="patch"
          run={() => item.patch({ spec: { hubAcceptsClient: true } })}
          successMessage={t('Cluster {{name}} accepted', { name })}
          confirm={{
            title: t('Accept cluster {{name}}?', { name }),
            description: t(
              'The hub creates the cluster namespace and lets the agent register. Its certificate signing request still has to be approved (unless auto-approval is configured).'
            ),
          }}
        />
      ) : (
        <ActionButton
          label={t('Revoke acceptance')}
          icon="mdi:handshake-outline"
          color="warning"
          authItem={item}
          authVerb="patch"
          run={() => item.patch({ spec: { hubAcceptsClient: false } })}
          successMessage={t('Acceptance of {{name}} revoked', { name })}
          confirm={{
            title: t('Revoke acceptance of {{name}}?', { name }),
            description: t(
              'The hub stops accepting the agent of this cluster: its hub credentials are revoked and the cluster becomes unavailable. Workloads already on the cluster are not removed.'
            ),
          }}
        />
      )}
      <AuthVisible item={item} authVerb="patch">
        <Tooltip title={t('Assign to cluster set')}>
          <IconButton aria-label={t('Assign to cluster set')} onClick={() => setDialog('set')}>
            <Icon icon="mdi:select-group" />
          </IconButton>
        </Tooltip>
      </AuthVisible>
      <AuthVisible item={crd('ManagedClusterAddOn').cls} authVerb="create" namespace={name}>
        <Tooltip title={t('Enable or disable add-ons')}>
          <IconButton
            aria-label={t('Enable or disable add-ons')}
            onClick={() => setDialog('addons')}
          >
            <Icon icon="mdi:puzzle-edit-outline" />
          </IconButton>
        </Tooltip>
      </AuthVisible>
      <ActionButton
        label={t('Detach cluster')}
        icon="mdi:link-variant-off"
        color="error"
        authItem={item}
        authVerb="delete"
        run={() => item.delete()}
        successMessage={t('Cluster {{name}} is being detached', { name })}
        confirm={{
          title: t('Detach cluster {{name}}?', { name }),
          description: t(
            'Deleting the ManagedCluster removes the cluster from the hub: ManifestWorks and add-ons in its namespace are cleaned up and the agent loses access. The cluster itself is not deleted.'
          ),
          confirmLabel: t('Detach'),
        }}
      />
      {dialog === 'set' && <AssignSetDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'addons' && <ManageAddonsDialog cluster={name} onClose={() => setDialog(null)} />}
    </Box>
  );
}

/** Delete action for one installed add-on (used in add-on tables). */
export function DisableAddonAction({ addon }: { addon: ManagedClusterAddOnJson }) {
  const { t } = useText();
  const item = makeRefObject('ManagedClusterAddOn', addon.metadata.name, addon.metadata.namespace);
  if (!item) return null;
  return (
    <ActionButton
      label={t('Disable add-on')}
      icon="mdi:puzzle-remove-outline"
      color="error"
      authItem={item}
      authVerb="delete"
      run={() => item.delete()}
      successMessage={t('Add-on {{name}} disabled on {{cluster}}', {
        name: addon.metadata.name,
        cluster: addon.metadata.namespace,
      })}
      confirm={{
        title: t('Disable {{name}} on {{cluster}}?', {
          name: addon.metadata.name,
          cluster: addon.metadata.namespace,
        }),
        description: t(
          'The ManagedClusterAddOn is deleted and the add-on agent is uninstalled from the cluster. If the add-on is installed by placement, it may be re-created.'
        ),
        confirmLabel: t('Disable'),
      }}
    />
  );
}
