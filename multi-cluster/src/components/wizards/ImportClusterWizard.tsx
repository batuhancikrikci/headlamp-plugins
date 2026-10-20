/**
 * Import / register a cluster: create the ManagedCluster (accepted), assign it to a cluster set,
 * enable add-ons, show the join command, then hand over to the cluster page where the agent's
 * certificate signing request is approved.
 */
import { Alert, Box, Checkbox, FormControlLabel, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { CodeBlock } from '../../common/CodeBlock';
import { FieldGrid, FormSection, SelectInput, TextInput } from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel } from '../../common/objects';
import { useOcmList } from '../../hooks/useOcmList';
import {
  addonDisplayName,
  ClusterManagementAddOnJson,
  isV1beta1,
} from '../../resources/models/addon';
import {
  ManagedClusterJson,
  ManagedClusterSetJson,
  setSelectorType,
} from '../../resources/models/cluster';
import { importClusterResources, ImportClusterState, joinCommand } from '../../utils/wizards';
import { KeyValueEditor } from '../common/form/SelectorEditor';
import { makeRefObject } from '../common/ResourceRefLink';
import { StringArray } from '../common/Shared';
import { useApiVersion } from './Common';

export function ImportClusterWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const history = useHistory();
  const clusterVersion = useApiVersion('ManagedCluster');
  const addonVersion = useApiVersion('ManagedClusterAddOn');
  const clusters = useOcmList<ManagedClusterJson>('ManagedCluster');
  const sets = useOcmList<ManagedClusterSetJson>('ManagedClusterSet');
  const cmas = useOcmList<ClusterManagementAddOnJson>('ClusterManagementAddOn');
  const [state, setState] = React.useState<ImportClusterState>({
    name: '',
    labels: {},
    addons: [],
  });
  const set = (patch: Partial<ImportClusterState>) => setState(s => ({ ...s, ...patch }));

  const existing = (clusters.items || []).some(c => c.metadata.name === state.name);
  const nameErrors: ValidationError[] = [];
  if (!isValidDNSLabel(state.name)) {
    nameErrors.push({
      key: 'Cluster name must be a DNS label (lowercase letters, digits and "-", at most 63 characters)',
    });
  }
  if (existing)
    nameErrors.push({
      key: 'A managed cluster named "{{name}}" already exists',
      params: { name: state.name },
    });

  const resources = React.useMemo(
    () =>
      importClusterResources(state, {
        cluster: clusterVersion,
        addon: cmas.missing ? undefined : addonVersion,
      }),
    [state, clusterVersion, addonVersion, cmas.missing]
  );
  const setOptions = (sets.items || [])
    .filter(s => setSelectorType(s) === 'ExclusiveClusterSetLabel')
    .map(s => s.metadata.name)
    .sort();
  const addonList = [...(cmas.items || [])].sort((a, b) =>
    a.metadata.name.localeCompare(b.metadata.name)
  );

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Import a cluster')}
      resources={resources}
      onApplied={() => {
        const obj = makeRefObject('ManagedCluster', state.name);
        if (obj) history.push(obj.getDetailsLink());
      }}
      summary={
        <Alert severity="info">
          {t(
            'After applying, run the join command on the managed cluster. The cluster page then shows its certificate signing request with an Approve button.'
          )}
        </Alert>
      }
      steps={[
        {
          id: 'cluster',
          label: t('Cluster'),
          description: t(
            'The ManagedCluster represents the cluster on the hub. It is created already accepted (hubAcceptsClient: true).'
          ),
          errors: nameErrors,
          content: (
            <Box>
              <FormSection title={t('Cluster')} icon="mdi:server-network">
                <FieldGrid columns={2}>
                  <TextInput
                    label={t('Cluster name')}
                    value={state.name}
                    onChange={v => set({ name: v || '' })}
                    required
                    help={t(
                      'Must match --cluster-name of the join command. The hub creates a namespace with this name.'
                    )}
                  />
                  <TextInput
                    label={t('API server URL (optional)')}
                    value={state.url}
                    onChange={v => set({ url: v })}
                    placeholder="https://api.cluster.example.com:6443"
                  />
                </FieldGrid>
              </FormSection>
              <FormSection
                title={t('Labels')}
                icon="mdi:tag-outline"
                description={t('Placements select clusters by these labels.')}
              >
                <KeyValueEditor
                  value={state.labels}
                  onChange={v => set({ labels: v || {} })}
                  addLabel={t('Add label')}
                />
              </FormSection>
            </Box>
          ),
        },
        {
          id: 'set',
          label: t('Cluster set'),
          optional: true,
          description: t(
            'Assign the cluster to a set with the cluster set label (sets using a label selector pick clusters by their labels instead).'
          ),
          content: (
            <FormSection title={t('Cluster set')} icon="mdi:select-group">
              <SelectInput
                label={t('Cluster set')}
                value={state.clusterSet}
                onChange={v => set({ clusterSet: v })}
                options={setOptions}
                emptyLabel={t('No cluster set')}
              />
            </FormSection>
          ),
        },
        {
          id: 'addons',
          label: t('Add-ons'),
          optional: true,
          description: t('Add-ons to enable on the cluster once its agent has joined.'),
          content: cmas.missing ? (
            <Alert severity="info">{t('The add-on APIs are not installed on this hub.')}</Alert>
          ) : (
            <FormSection title={t('Add-ons')} icon="mdi:puzzle-outline">
              {addonList.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('No add-ons are registered on the hub.')}
                </Typography>
              )}
              {addonList.map(cma => (
                <Box key={cma.metadata.name}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={state.addons.includes(cma.metadata.name)}
                        onChange={e =>
                          set({
                            addons: e.target.checked
                              ? [...state.addons, cma.metadata.name]
                              : state.addons.filter(a => a !== cma.metadata.name),
                          })
                        }
                      />
                    }
                    label={`${addonDisplayName(cma)} (${cma.metadata.name})`}
                  />
                </Box>
              ))}
              {!isV1beta1(addonVersion) && state.addons.length > 0 && (
                <Box sx={{ mt: 2, maxWidth: 420 }}>
                  <TextInput
                    label={t('Install namespace (optional, addon v1alpha1)')}
                    value={state.installNamespace}
                    onChange={v => set({ installNamespace: v })}
                  />
                </Box>
              )}
            </FormSection>
          ),
        },
        {
          id: 'join',
          label: t('Join'),
          description: t(
            'Install the klusterlet on the managed cluster with clusteradm (with its kubeconfig context selected).'
          ),
          content: (
            <Box>
              <CodeBlock value={joinCommand(state.name)} />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t(
                  'The klusterlet then creates a certificate signing request on the hub. Approve it on the cluster page (or with "clusteradm accept --clusters {{name}}"); unless auto-approval is configured, the cluster stays "Pending join" until then.',
                  {
                    name: state.name || '<cluster>',
                  }
                )}
              </Typography>
              <Box sx={{ mt: 2 }}>
                <SummaryList
                  rows={[
                    { label: t('Cluster'), value: state.name || '-' },
                    { label: t('Cluster set'), value: state.clusterSet || '-' },
                    { label: t('Add-ons'), value: <StringArray items={state.addons} /> },
                  ]}
                />
              </Box>
            </Box>
          ),
        },
      ]}
    />
  );
}
