/**
 * Deploy with Argo CD: Placement (new or existing) in the Argo CD namespace → GitOpsCluster that
 * registers its clusters in Argo CD (reused when one already exists) → ApplicationSet with the
 * OCM placement generator, in the push or the pull model.
 */
import { Alert, Box, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
import React from 'react';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  NumberInput,
  SwitchInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName } from '../../common/objects';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import { gitOpsArgoNamespace, GitOpsClusterJson } from '../../resources/models/apps';
import { ArgoDeployState, buildApplicationSet, OCM_ARGO } from '../../resources/models/argo';
import { KubeJson } from '../../resources/models/common';
import { emptyPlacementChoice, PlacementChoice, placementResources } from '../../utils/wizards';
import { useProjectNames } from '../argocd/Forms';
import { useGitOpsPlacementApiVersion } from '../gitops/Forms';
import { placementChoiceErrors, PlacementChoiceStep, useApiVersion, useBoundSets } from './Common';

export function ArgoDeployWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const namespaces = useNamespaceNames();
  const appsetVersion = useApiVersion('ApplicationSet');
  const gitopsVersion = useApiVersion('GitOpsCluster');
  const placementVersion = useGitOpsPlacementApiVersion();
  const bindingVersion = useApiVersion('ManagedClusterSetBinding');
  const [state, setState] = React.useState<ArgoDeployState>({
    name: '',
    namespace: '',
    placement: '',
    project: 'default',
    repoURL: '',
    path: '',
    targetRevision: 'HEAD',
    destinationNamespace: '',
    model: 'push',
    automated: true,
    prune: false,
    selfHeal: false,
    createNamespace: true,
    requeueAfterSeconds: 180,
  });
  const set = (patch: Partial<ArgoDeployState>) => setState(s => ({ ...s, ...patch }));
  const [sourceKind, setSourceKind] = React.useState<'git' | 'helm'>('git');
  const [placement, setPlacement] = React.useState<PlacementChoice>(emptyPlacementChoice());
  const [gitopsName, setGitopsName] = React.useState<string>();
  const ns = state.namespace;
  const bound = useBoundSets(ns);
  const projects = useProjectNames(ns);
  const gitops = useOcmList<GitOpsClusterJson>('GitOpsCluster', { namespace: ns, enabled: !!ns });
  // Which integration the hub has: the GitOpsCluster version decides between cluster secrets
  // (v1beta1, multicloud-integrations) and argocd-agent (v1alpha1, argocd-pull-integration); the
  // "argocd" add-on is the basic pull model of argocd-pull-integration.
  const agentApi = gitopsVersion.endsWith('/v1alpha1');
  const cmas = useOcmList<KubeJson>('ClusterManagementAddOn');
  const pullIntegration = (cmas.items || []).some(c => c.metadata.name === 'argocd');
  const existingGitOps = (gitops.items || []).find(
    g => g.spec?.placementRef?.name === placement.name && gitOpsArgoNamespace(g) === ns
  );
  const pull = state.model === 'pull';
  const agent = state.model === 'agent';
  // Basic pull without the secret-based GitOpsCluster: argocd-pull-integration, no GitOpsCluster.
  const pullViaIntegration = pull && agentApi;
  const needsGitOpsCluster = !pullViaIntegration;
  const configMapRef =
    agent || pullViaIntegration ? OCM_ARGO.pullIntegrationConfigMap : OCM_ARGO.placementConfigMap;
  React.useEffect(() => {
    // Default to the model the hub supports.
    if (agentApi && state.model === 'push') setState(s => ({ ...s, model: 'agent' }));
    if (!agentApi && state.model === 'agent') setState(s => ({ ...s, model: 'push' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentApi]);

  const resources = React.useMemo(() => {
    const out: KubeJson[] = [
      ...placementResources(placement, ns, bound, {
        placement: placementVersion,
        binding: bindingVersion,
      }),
    ];
    if (needsGitOpsCluster && !existingGitOps) {
      out.push({
        apiVersion: gitopsVersion,
        kind: 'GitOpsCluster',
        metadata: { name: gitopsName || `${placement.name}-gitops`, namespace: ns },
        spec: agentApi
          ? {
              placementRef: {
                kind: 'Placement',
                apiVersion: placementVersion,
                name: placement.name,
              },
              argoCDAgentAddon: { mode: 'managed' },
            }
          : {
              argoServer: { argoNamespace: ns },
              placementRef: {
                kind: 'Placement',
                apiVersion: placementVersion,
                name: placement.name,
              },
              // Pull model: register the clusters without credentials, only for the generator.
              ...(pull ? { createBlankClusterSecrets: true } : {}),
            },
      });
    }
    const appState: ArgoDeployState = {
      ...state,
      configMapRef,
      placement: placement.name,
      path: sourceKind === 'git' ? state.path : undefined,
      chart: sourceKind === 'helm' ? state.chart : undefined,
    };
    out.push(buildApplicationSet(appState, appsetVersion));
    return out;
  }, [
    placement,
    ns,
    bound,
    placementVersion,
    bindingVersion,
    existingGitOps,
    needsGitOpsCluster,
    agentApi,
    configMapRef,
    gitopsVersion,
    gitopsName,
    pull,
    state,
    sourceKind,
    appsetVersion,
  ]);

  const basicErrors: ValidationError[] = [];
  if (!isValidDNSLabel(ns)) basicErrors.push({ key: 'Choose the Argo CD namespace' });
  if (!isValidResourceName(state.name))
    basicErrors.push({ key: 'Enter a valid ApplicationSet name' });
  const appErrors: ValidationError[] = [];
  if (!/^(https?|ssh|git):\/\/|^git@/.test(state.repoURL))
    appErrors.push({ key: 'Enter the repository URL' });
  if (sourceKind === 'helm' && !state.chart) appErrors.push({ key: 'Enter the chart name' });

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Deploy with Argo CD')}
      resources={resources}
      summary={
        <SummaryList
          rows={[
            { label: t('Argo CD namespace'), value: ns },
            {
              label: t('Model'),
              value: pull
                ? t('Pull (ManifestWork to the Argo CD on each cluster)')
                : t('Push (this Argo CD deploys)'),
            },
            {
              label: t('Placement'),
              value: `${placement.name} (${placement.mode === 'new' ? t('new') : t('existing')})`,
            },
            {
              label: t('GitOpsCluster'),
              value: !needsGitOpsCluster
                ? t('none (basic pull via argocd-pull-integration)')
                : existingGitOps
                ? `${existingGitOps.metadata.name} (${t('existing')})`
                : `${gitopsName || `${placement.name}-gitops`} (${t('new')})`,
            },
            { label: t('ApplicationSet'), value: `${ns}/${state.name}` },
          ]}
        />
      }
      steps={[
        {
          id: 'argo',
          label: t('Argo CD'),
          errors: basicErrors,
          description: t(
            'The ApplicationSet, its placement and the GitOpsCluster are created in the Argo CD namespace.'
          ),
          content: (
            <Box>
              <FormSection
                title={t('Argo CD')}
                icon="mdi:source-branch-sync"
                docsUrl="https://open-cluster-management.io/docs/scenarios/integration-with-argocd/"
              >
                <FieldGrid columns={2}>
                  <ComboInput
                    label={t('Argo CD namespace')}
                    value={ns}
                    onChange={v => set({ namespace: v || '' })}
                    options={namespaces}
                    required
                  />
                  <TextInput
                    label={t('ApplicationSet name')}
                    value={state.name}
                    onChange={v => set({ name: v || '' })}
                    required
                  />
                </FieldGrid>
              </FormSection>
              <FormSection title={t('Deployment model')} icon="mdi:swap-vertical">
                <RadioGroup
                  value={state.model}
                  onChange={e => set({ model: e.target.value as 'push' | 'pull' | 'agent' })}
                >
                  <FormControlLabel
                    value="push"
                    control={<Radio />}
                    disabled={agentApi}
                    label={t(
                      'Push: the hub Argo CD deploys to each cluster through its cluster secret (GitOpsCluster v1beta1)'
                    )}
                  />
                  <FormControlLabel
                    value="pull"
                    control={<Radio />}
                    label={t(
                      'Basic pull: each application is sent with a ManifestWork to the Argo CD on the managed cluster'
                    )}
                  />
                  <FormControlLabel
                    value="agent"
                    control={<Radio />}
                    disabled={!agentApi}
                    label={t(
                      'Argo CD agent (advanced pull): applications are routed to the argocd-agent on each cluster (GitOpsCluster v1alpha1)'
                    )}
                  />
                </RadioGroup>
                {pull && (
                  <Alert
                    severity={agentApi && !pullIntegration ? 'warning' : 'info'}
                    sx={{ mt: 1 }}
                  >
                    {agentApi
                      ? t(
                          'The basic pull model of argocd-pull-integration (add-on "argocd", ConfigMap ocm-placement-generator) is used{{missing}}. The generator only yields clusters registered in Argo CD, so the clusters need cluster secrets (blank ones are enough).',
                          {
                            missing: pullIntegration
                              ? ''
                              : t(' — but the "argocd" add-on is not installed on this hub'),
                          }
                        )
                      : t(
                          'The managed clusters need Argo CD, and the application propagation controller (multicloud-integrations) must run on the hub.'
                        )}
                  </Alert>
                )}
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                  {t('Generator ConfigMap: {{cm}}', { cm: configMapRef })}
                </Typography>
              </FormSection>
            </Box>
          ),
        },
        {
          id: 'placement',
          label: t('Placement'),
          description: t(
            'The clusters that get the application. The generator follows placement changes.'
          ),
          errors: ns
            ? placementChoiceErrors(placement)
            : [{ key: 'Choose the Argo CD namespace first' }],
          content: ns ? (
            <PlacementChoiceStep namespace={ns} value={placement} onChange={setPlacement} />
          ) : null,
        },
        {
          id: 'gitops',
          label: t('Register clusters'),
          description: t(
            'A GitOpsCluster registers the clusters of the placement in Argo CD (cluster secrets, or the argocd-agent add-on).'
          ),
          content: !needsGitOpsCluster ? (
            <Alert severity="info">
              {t(
                'No GitOpsCluster is created for the basic pull model of argocd-pull-integration; make sure the selected clusters are registered in Argo CD.'
              )}
            </Alert>
          ) : existingGitOps ? (
            <Alert
              severity={
                pull &&
                !existingGitOps.spec?.createBlankClusterSecrets &&
                !existingGitOps.spec?.managedServiceAccountRef
                  ? 'warning'
                  : 'success'
              }
            >
              {t(
                'GitOpsCluster {{name}} already registers the clusters of placement {{placement}} in {{ns}}; it is reused.',
                {
                  name: existingGitOps.metadata.name,
                  placement: placement.name,
                  ns,
                }
              )}
              {pull && !existingGitOps.spec?.createBlankClusterSecrets
                ? ` ${t(
                    'For the pull model it should have createBlankClusterSecrets: true unless the clusters have credentials.'
                  )}`
                : ''}
            </Alert>
          ) : (
            <FormSection title={t('New GitOpsCluster')} icon="mdi:source-branch-sync">
              <TextInput
                label={t('GitOpsCluster name')}
                value={gitopsName}
                onChange={setGitopsName}
                placeholder={`${placement.name || '<placement>'}-gitops`}
              />
              {pull && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  {t(
                    'createBlankClusterSecrets: true is set: the clusters are registered without credentials, which is all the pull model needs.'
                  )}
                </Alert>
              )}
            </FormSection>
          ),
        },
        {
          id: 'app',
          label: t('Application'),
          errors: appErrors,
          content: (
            <Box>
              <FormSection title={t('Source')} icon="mdi:source-repository">
                <RadioGroup
                  row
                  value={sourceKind}
                  onChange={e => setSourceKind(e.target.value as 'git' | 'helm')}
                  sx={{ mb: 1 }}
                >
                  <FormControlLabel value="git" control={<Radio />} label={t('Git directory')} />
                  <FormControlLabel
                    value="helm"
                    control={<Radio />}
                    label={t('Helm chart repository')}
                  />
                </RadioGroup>
                <FieldGrid columns={3}>
                  <TextInput
                    label={t('Repository URL')}
                    value={state.repoURL}
                    onChange={v => set({ repoURL: v || '' })}
                    required
                  />
                  {sourceKind === 'git' ? (
                    <TextInput
                      label={t('Path')}
                      value={state.path}
                      onChange={v => set({ path: v })}
                      placeholder="."
                    />
                  ) : (
                    <TextInput
                      label={t('Chart')}
                      value={state.chart}
                      onChange={v => set({ chart: v })}
                      required
                    />
                  )}
                  <TextInput
                    label={sourceKind === 'git' ? t('Revision') : t('Chart version')}
                    value={state.targetRevision}
                    onChange={v => set({ targetRevision: v })}
                  />
                </FieldGrid>
              </FormSection>
              <FormSection title={t('Project and destination')} icon="mdi:target-account">
                <FieldGrid columns={3}>
                  <ComboInput
                    label={t('Argo CD project')}
                    value={state.project}
                    onChange={v => set({ project: v || 'default' })}
                    options={projects}
                  />
                  <TextInput
                    label={t('Destination namespace')}
                    value={state.destinationNamespace}
                    onChange={v => set({ destinationNamespace: v || '' })}
                  />
                  <NumberInput
                    label={t('Re-check placement every (s)')}
                    value={state.requeueAfterSeconds}
                    onChange={v => set({ requeueAfterSeconds: v })}
                    min={0}
                  />
                </FieldGrid>
              </FormSection>
              <FormSection title={t('Sync policy')} icon="mdi:sync">
                <FieldGrid columns={2}>
                  <SwitchInput
                    label={t('Automated sync')}
                    value={state.automated}
                    onChange={v => set({ automated: !!v })}
                  />
                  <SwitchInput
                    label={t('Create the destination namespace')}
                    value={state.createNamespace}
                    onChange={v => set({ createNamespace: !!v })}
                  />
                  {state.automated && (
                    <>
                      <SwitchInput
                        label={t('Prune')}
                        value={state.prune}
                        onChange={v => set({ prune: !!v })}
                      />
                      <SwitchInput
                        label={t('Self-heal')}
                        value={state.selfHeal}
                        onChange={v => set({ selfHeal: !!v })}
                      />
                    </>
                  )}
                </FieldGrid>
              </FormSection>
            </Box>
          ),
        },
      ]}
    />
  );
}
