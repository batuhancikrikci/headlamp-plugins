/**
 * Configure GitOps: a GitOpsCluster that registers the clusters of a placement in an Argo CD
 * instance. The GitOps controller looks the placement up in the GitOpsCluster's namespace, so
 * the placement (and its bindings) are created there.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  SwitchInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName } from '../../common/objects';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import { KubeJson } from '../../resources/models/common';
import { emptyPlacementChoice, PlacementChoice, placementResources } from '../../utils/wizards';
import { useGitOpsPlacementApiVersion } from '../gitops/Forms';
import { placementChoiceErrors, PlacementChoiceStep, useApiVersion, useBoundSets } from './Common';

export function GitOpsWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const namespaces = useNamespaceNames();
  const gitopsVersion = useApiVersion('GitOpsCluster');
  // GitOpsCluster v1alpha1 is the argocd-agent API (argocd-pull-integration).
  const agent = gitopsVersion.endsWith('/v1alpha1');
  const placementVersion = useGitOpsPlacementApiVersion();
  const bindingVersion = useApiVersion('ManagedClusterSetBinding');
  const msas = useOcmList<KubeJson>('ManagedServiceAccount');
  const [argoNamespace, setArgoNamespace] = React.useState('');
  const [namespace, setNamespace] = React.useState('');
  const [name, setName] = React.useState('');
  const [msa, setMsa] = React.useState<string>();
  const [policyTemplate, setPolicyTemplate] = React.useState<boolean | undefined>();
  const [placement, setPlacement] = React.useState<PlacementChoice>(emptyPlacementChoice());
  const ns = namespace || argoNamespace;
  const bound = useBoundSets(ns);

  const resources = React.useMemo(() => {
    const gitops: KubeJson = {
      apiVersion: gitopsVersion,
      kind: 'GitOpsCluster',
      metadata: { name, namespace: ns },
      spec: agent
        ? {
            // argocd-agent API: the GitOpsCluster lives in the Argo CD namespace.
            placementRef: { kind: 'Placement', apiVersion: placementVersion, name: placement.name },
            argoCDAgentAddon: { mode: 'managed' },
          }
        : {
            argoServer: { argoNamespace },
            placementRef: { kind: 'Placement', apiVersion: placementVersion, name: placement.name },
            ...(msa ? { managedServiceAccountRef: msa } : {}),
            ...(policyTemplate ? { createPolicyTemplate: true } : {}),
          },
    };
    return [
      ...placementResources(placement, ns, bound, {
        placement: placementVersion,
        binding: bindingVersion,
      }),
      gitops,
    ];
  }, [
    gitopsVersion,
    agent,
    name,
    ns,
    argoNamespace,
    placementVersion,
    placement,
    msa,
    policyTemplate,
    bound,
    bindingVersion,
  ]);

  const basicErrors: ValidationError[] = [];
  if (!isValidDNSLabel(argoNamespace)) basicErrors.push({ key: 'Choose the Argo CD namespace' });
  if (!isValidDNSLabel(ns)) basicErrors.push({ key: 'Choose the namespace of the GitOpsCluster' });
  if (!isValidResourceName(name)) basicErrors.push({ key: 'Enter a valid name' });

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Configure GitOps (Argo CD)')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            { label: t('Argo CD namespace'), value: argoNamespace },
            { label: t('GitOpsCluster'), value: `${ns}/${name}` },
            { label: t('Placement'), value: `${ns}/${placement.name}` },
          ]}
        />
      }
      steps={[
        {
          id: 'argo',
          label: t('Argo CD'),
          description: t(
            'Where Argo CD runs. The GitOpsCluster is usually created in the same namespace.'
          ),
          errors: basicErrors,
          content: (
            <Box>
              <FormSection
                title={t('Argo CD')}
                icon="mdi:source-branch-sync"
                docsUrl="https://open-cluster-management.io/docs/scenarios/integration-with-argocd/"
              >
                <FieldGrid columns={3}>
                  <ComboInput
                    label={t('Argo CD namespace')}
                    value={argoNamespace}
                    onChange={v => setArgoNamespace(v || '')}
                    options={namespaces}
                    required
                  />
                  <ComboInput
                    label={t('GitOpsCluster namespace')}
                    value={namespace}
                    onChange={v => setNamespace(v || '')}
                    options={namespaces}
                    placeholder={argoNamespace || undefined}
                    help={t(
                      'Defaults to the Argo CD namespace. The placement must be in this namespace.'
                    )}
                  />
                  <TextInput
                    label={t('Name')}
                    value={name}
                    onChange={v => setName(v || '')}
                    required
                  />
                </FieldGrid>
              </FormSection>
              <Alert severity="info">
                {agent
                  ? t(
                      'This hub serves the argocd-agent GitOpsCluster API (argocd-pull-integration): the GitOpsCluster deploys the Argo CD agent add-on to the clusters of the placement. Create it in the Argo CD namespace.'
                    )
                  : t(
                      'This hub serves the cluster-secret GitOpsCluster API (multicloud-integrations): the clusters of the placement are registered as Argo CD cluster secrets. Argo CD must be running in the chosen namespace.'
                    )}
              </Alert>
            </Box>
          ),
        },
        {
          id: 'placement',
          label: t('Placement'),
          description: t(
            'Clusters selected by this placement are added to Argo CD as cluster secrets.'
          ),
          errors: ns ? placementChoiceErrors(placement) : [{ key: 'Choose the namespace first' }],
          content: ns ? (
            <PlacementChoiceStep namespace={ns} value={placement} onChange={setPlacement} />
          ) : null,
        },
        {
          id: 'credentials',
          label: t('Credentials'),
          optional: true,
          description: t(
            'Optional: use a ManagedServiceAccount token for the Argo CD cluster secrets instead of the default credentials.'
          ),
          content: (
            <FormSection title={t('Cluster credentials')} icon="mdi:account-key-outline">
              <FieldGrid columns={2}>
                <ComboInput
                  label={t('Managed service account')}
                  value={msa}
                  onChange={setMsa}
                  options={Array.from(new Set((msas.items || []).map(m => m.metadata.name))).sort()}
                  disabled={msas.missing}
                  helperText={
                    msas.missing ? t('The ManagedServiceAccount API is not installed.') : undefined
                  }
                />
                <SwitchInput
                  label={t('Create policy template')}
                  value={policyTemplate}
                  onChange={setPolicyTemplate}
                  disabled={!msa}
                />
              </FieldGrid>
            </FormSection>
          ),
        },
      ].filter(step => !agent || step.id !== 'credentials')}
    />
  );
}
