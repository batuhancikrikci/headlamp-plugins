/**
 * ApplicationSet and AppProject forms. The ApplicationSet form edits the OCM placement generator
 * and a single-source template; other generators and multi-source templates stay editable in
 * the YAML tab (and in the generators YAML field here).
 */
import { Alert, Box, FormControlLabel, Radio, RadioGroup } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  ComboInput,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { YamlField } from '../../common/form/YamlField';
import { useText } from '../../common/i18n';
import { getIn, Path, setIn } from '../../common/objects';
import { useOcmList } from '../../hooks/useOcmList';
import {
  appSetIsPull,
  appSetPlacements,
  ArgoApplicationSetJson,
  ArgoSource,
  OCM_ARGO,
  withAppSetModel,
} from '../../resources/models/argo';
import { KubeJson } from '../../resources/models/common';
import { PLACEMENT_LABEL, PlacementJson } from '../../resources/models/placement';
import { MetadataFields } from '../common/form/MetadataFields';

const OCM_DOCS = 'https://open-cluster-management.io/docs/scenarios/integration-with-argocd/';

/** Argo CD project names of a namespace (plus "default"). */
export function useProjectNames(namespace?: string): string[] {
  const projects = useOcmList<KubeJson>('AppProject', { namespace, enabled: !!namespace });
  return Array.from(
    new Set(['default', ...(projects.items || []).map(p => p.metadata.name)])
  ).sort();
}

/** Source, destination namespace and sync policy of an application template at `path`. */
export function AppTemplateSections({
  value,
  onChange,
  path,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  /** Path of the Application spec (e.g. ['spec', 'template', 'spec']). */
  path: Path;
}) {
  const { t } = useText();
  const spec = getIn<KubeJson['spec']>(value, path) || {};
  const set = (sub: Path, v: unknown) => onChange(setIn(value, [...path, ...sub], v));
  const projects = useProjectNames(value.metadata?.namespace);
  const multi = (spec.sources || []).length > 0;
  const source: ArgoSource = spec.source || { repoURL: '' };
  const isChart = source.chart !== undefined;
  const automated = !!spec.syncPolicy?.automated;
  const syncOptions: string[] = spec.syncPolicy?.syncOptions || [];
  const createNs = syncOptions.includes('CreateNamespace=true');
  return (
    <>
      <FormSection
        title={t('Source')}
        icon="mdi:source-repository"
        docsUrl="https://argo-cd.readthedocs.io/en/stable/user-guide/application-specification/"
      >
        {multi ? (
          <Alert severity="info">
            {t('This template has several sources; edit them in the YAML tab.')}
          </Alert>
        ) : (
          <>
            <RadioGroup
              row
              value={isChart ? 'helm' : 'git'}
              onChange={e =>
                set(
                  ['source'],
                  e.target.value === 'helm'
                    ? { repoURL: source.repoURL, chart: '', targetRevision: source.targetRevision }
                    : { repoURL: source.repoURL, path: '', targetRevision: source.targetRevision }
                )
              }
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
                value={source.repoURL}
                onChange={v => set(['source', 'repoURL'], v || '')}
                required
              />
              {isChart ? (
                <TextInput
                  label={t('Chart')}
                  value={source.chart}
                  onChange={v => set(['source', 'chart'], v || '')}
                  required
                />
              ) : (
                <TextInput
                  label={t('Path')}
                  value={source.path}
                  onChange={v => set(['source', 'path'], v)}
                  placeholder="."
                />
              )}
              <TextInput
                label={isChart ? t('Chart version') : t('Revision')}
                value={source.targetRevision}
                onChange={v => set(['source', 'targetRevision'], v)}
                placeholder={isChart ? '1.2.3' : 'HEAD'}
              />
            </FieldGrid>
          </>
        )}
      </FormSection>
      <FormSection title={t('Project and destination')} icon="mdi:target-account">
        <FieldGrid columns={2}>
          <ComboInput
            label={t('Argo CD project')}
            value={spec.project}
            onChange={v => set(['project'], v || '')}
            options={projects}
            required
          />
          <TextInput
            label={t('Destination namespace')}
            value={spec.destination?.namespace}
            onChange={v => set(['destination', 'namespace'], v)}
            help={t(
              'Namespace on the managed cluster for namespaced resources without their own namespace.'
            )}
          />
        </FieldGrid>
      </FormSection>
      <FormSection title={t('Sync policy')} icon="mdi:sync">
        <FieldGrid columns={2}>
          <SwitchInput
            label={t('Automated sync')}
            value={automated}
            onChange={v =>
              set(['syncPolicy', 'automated'], v ? spec.syncPolicy?.automated || {} : undefined)
            }
          />
          <SwitchInput
            label={t('Create the destination namespace')}
            value={createNs}
            onChange={v =>
              set(
                ['syncPolicy', 'syncOptions'],
                v
                  ? [
                      ...syncOptions.filter(o => o !== 'CreateNamespace=true'),
                      'CreateNamespace=true',
                    ]
                  : syncOptions.filter(o => o !== 'CreateNamespace=true')
              )
            }
          />
          {automated && (
            <>
              <SwitchInput
                label={t('Prune')}
                value={spec.syncPolicy?.automated?.prune}
                onChange={v => set(['syncPolicy', 'automated', 'prune'], v)}
                help={t('Delete resources that were removed from the source.')}
              />
              <SwitchInput
                label={t('Self-heal')}
                value={spec.syncPolicy?.automated?.selfHeal}
                onChange={v => set(['syncPolicy', 'automated', 'selfHeal'], v)}
                help={t('Revert changes made on the cluster.')}
              />
            </>
          )}
        </FieldGrid>
      </FormSection>
    </>
  );
}

/** Push / pull model choice for an ApplicationSet. */
export function ModelSection({
  value,
  onChange,
}: {
  value: ArgoApplicationSetJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const pull = appSetIsPull(value);
  return (
    <FormSection
      title={t('Deployment model')}
      icon="mdi:swap-vertical"
      description={t(
        'Push: this Argo CD deploys to the managed clusters through the cluster secrets of a GitOpsCluster. Pull: each generated application is wrapped in a ManifestWork and run by the Argo CD on the managed cluster.'
      )}
      docsUrl={OCM_DOCS}
    >
      <RadioGroup
        row
        value={pull ? 'pull' : 'push'}
        onChange={e => onChange(withAppSetModel(value, e.target.value as 'push' | 'pull'))}
      >
        <FormControlLabel value="push" control={<Radio />} label={t('Push')} />
        <FormControlLabel value="pull" control={<Radio />} label={t('Pull')} />
      </RadioGroup>
      {pull && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {t(
            'Pull model: the managed clusters need Argo CD and the application propagation must be enabled on the hub; the GitOpsCluster needs createBlankClusterSecrets: true so that the generator finds the clusters.'
          )}
        </Alert>
      )}
    </FormSection>
  );
}

export function ApplicationSetForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const appset = value as ArgoApplicationSetJson;
  const ns = value.metadata?.namespace;
  const placements = useOcmList<PlacementJson>('Placement', { namespace: ns, enabled: !!ns });
  const generators = appset.spec?.generators || [];
  const cdrIndex = generators.findIndex(g => g.clusterDecisionResource);
  const cdr = cdrIndex >= 0 ? generators[cdrIndex].clusterDecisionResource : undefined;
  const current = appSetPlacements(appset)[0]?.name;
  const setGen = (sub: string[], v: unknown) =>
    onChange(setIn(value, ['spec', 'generators', cdrIndex, 'clusterDecisionResource', ...sub], v));
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        namespaceHelp={t('The Argo CD namespace (where the ApplicationSet controller runs).')}
      />
      <FormSection title={t('Clusters from an OCM placement')} icon="mdi:target" docsUrl={OCM_DOCS}>
        {cdr ? (
          <FieldGrid columns={3}>
            <SelectInput
              label={t('Placement')}
              value={current}
              onChange={v =>
                setGen(['labelSelector'], v ? { matchLabels: { [PLACEMENT_LABEL]: v } } : undefined)
              }
              options={(placements.items || []).map(p => p.metadata.name).sort()}
              allowEmpty={false}
              required
              helperText={t('Placements in the ApplicationSet namespace.')}
            />
            <ComboInput
              label={t('Generator ConfigMap')}
              value={cdr.configMapRef}
              onChange={v => setGen(['configMapRef'], v || '')}
              options={[OCM_ARGO.placementConfigMap, OCM_ARGO.pullIntegrationConfigMap]}
              required
              help={t(
                'acm-placement is created by the GitOpsCluster (v1beta1) controller; ocm-placement-generator by argocd-pull-integration.'
              )}
            />
            <NumberInput
              label={t('Re-check every (seconds)')}
              value={cdr.requeueAfterSeconds}
              onChange={v => setGen(['requeueAfterSeconds'], v)}
              min={0}
              placeholder="180"
            />
          </FieldGrid>
        ) : (
          <Alert severity="info">
            {t(
              'No clusterDecisionResource generator: this ApplicationSet does not select clusters through OCM. Generators can be edited below.'
            )}
          </Alert>
        )}
        <Box sx={{ mt: 2 }}>
          <YamlField
            label={t('All generators (YAML)')}
            value={appset.spec?.generators}
            onChange={v => onChange(setIn(value, ['spec', 'generators'], v))}
            expect="array"
            minRows={5}
          />
        </Box>
      </FormSection>
      <ModelSection value={appset} onChange={onChange} />
      <FormSection title={t('Application template')} icon="mdi:application-brackets-outline">
        <TextInput
          label={t('Application name')}
          value={appset.spec?.template?.metadata?.name}
          onChange={v => onChange(setIn(value, ['spec', 'template', 'metadata', 'name'], v || ''))}
          required
          help={t(
            '{{name}} is the managed cluster (Argo CD cluster) name; {{server}} its API server.'
          )}
        />
      </FormSection>
      <AppTemplateSections value={value} onChange={onChange} path={['spec', 'template', 'spec']} />
    </Box>
  );
}

interface Destination {
  server?: string;
  name?: string;
  namespace?: string;
}

export function AppProjectForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection
        title={t('Project')}
        icon="mdi:folder-key-outline"
        docsUrl="https://argo-cd.readthedocs.io/en/stable/user-guide/projects/"
      >
        <TextInput {...bind<string>(['spec', 'description'])} label={t('Description')} />
        <Box sx={{ mt: 2 }}>
          <StringListInput
            {...bind<string[]>(['spec', 'sourceRepos'])}
            label={t('Allowed source repositories')}
            placeholder="*"
          />
        </Box>
      </FormSection>
      <FormSection
        title={t('Allowed destinations')}
        icon="mdi:target-account"
        description={t(
          'Clusters (by name or server, "*" for any) and namespaces applications of this project may deploy to.'
        )}
      >
        <ArrayEditor<Destination>
          items={value.spec?.destinations}
          onChange={v => onChange(setIn(value, ['spec', 'destinations'], v))}
          newItem={() => ({ name: '*', namespace: '*' })}
          addLabel={t('Add destination')}
          itemTitle={(d, i) =>
            `${d.name || d.server || t('Destination {{n}}', { n: i + 1 })} / ${d.namespace || '*'}`
          }
          renderItem={(d, update) => (
            <FieldGrid columns={3}>
              <TextInput
                label={t('Cluster name')}
                value={d.name}
                onChange={v => update({ ...d, name: v })}
              />
              <TextInput
                label={t('Server')}
                value={d.server}
                onChange={v => update({ ...d, server: v })}
              />
              <TextInput
                label={t('Namespace')}
                value={d.namespace}
                onChange={v => update({ ...d, namespace: v })}
              />
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection title={t('Cluster-scoped resources allowed')} icon="mdi:shield-check-outline">
        <YamlField
          label={t('clusterResourceWhitelist')}
          value={value.spec?.clusterResourceWhitelist}
          onChange={v => onChange(setIn(value, ['spec', 'clusterResourceWhitelist'], v))}
          expect="array"
          minRows={4}
          helperText={t('List of {group, kind}, e.g. - group: "*"\\n  kind: "*"')}
        />
      </FormSection>
    </Box>
  );
}
