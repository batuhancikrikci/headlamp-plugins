/**
 * Create a policy: basics and standards → policy templates (ConfigurationPolicy, OperatorPolicy
 * or YAML) → placement (new or existing) → PlacementBinding. The review step also shows the
 * equivalent PolicyGenerator configuration for Git-based workflows.
 */
import { Box, Typography } from '@mui/material';
import React from 'react';
import { CodeBlock } from '../../common/CodeBlock';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  SelectInput,
  TextInput,
} from '../../common/form/Fields';
import { SetupWizardDialog } from '../../common/form/SetupWizardDialog';
import { ValidationError } from '../../common/form/types';
import { SummaryList } from '../../common/form/Wizard';
import { useText } from '../../common/i18n';
import { isValidDNSLabel, isValidResourceName, setIn } from '../../common/objects';
import { dumpAllYaml, dumpYaml } from '../../common/yaml';
import { useNamespaceNames } from '../../hooks/useOcmList';
import { KubeJson } from '../../resources/models/common';
import { placementBinding, PolicyJson, toPolicyGenerator } from '../../resources/models/policy';
import { validateResource } from '../../utils/validation';
import { emptyPlacementChoice, PlacementChoice, placementResources } from '../../utils/wizards';
import { PolicyMetadataSection, PolicyTemplatesEditor } from '../governance/Forms';
import { placementChoiceErrors, PlacementChoiceStep, useApiVersion, useBoundSets } from './Common';

export function PolicyWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useText();
  const namespaces = useNamespaceNames();
  const policyVersion = useApiVersion('Policy');
  const bindingKindVersion = useApiVersion('PlacementBinding');
  const placementVersion = useApiVersion('Placement');
  const setBindingVersion = useApiVersion('ManagedClusterSetBinding');
  const [policy, setPolicy] = React.useState<PolicyJson>({
    apiVersion: policyVersion,
    kind: 'Policy',
    metadata: { name: '', namespace: '' },
    spec: { remediationAction: 'inform', disabled: false, 'policy-templates': [] },
  });
  const [placement, setPlacement] = React.useState<PlacementChoice>(emptyPlacementChoice());
  const ns = policy.metadata.namespace || '';
  const bound = useBoundSets(ns);
  const name = policy.metadata.name;

  const resources = React.useMemo(() => {
    const out: KubeJson[] = [
      ...placementResources(placement, ns, bound, {
        placement: placementVersion,
        binding: setBindingVersion,
      }),
      { ...policy, apiVersion: policyVersion },
    ];
    if (placement.name && name) {
      out.push(
        placementBinding(
          `${name}-binding`,
          ns,
          placement.name,
          [{ kind: 'Policy', name }],
          bindingKindVersion
        )
      );
    }
    return out;
  }, [
    placement,
    ns,
    bound,
    placementVersion,
    setBindingVersion,
    policy,
    policyVersion,
    name,
    bindingKindVersion,
  ]);

  const generator = React.useMemo(
    () => toPolicyGenerator(policy, placement.name || '<placement>'),
    [policy, placement.name]
  );

  const basicErrors: ValidationError[] = [];
  if (!isValidDNSLabel(ns)) basicErrors.push({ key: 'Choose the namespace of the policy' });
  if (!isValidResourceName(name)) basicErrors.push({ key: 'Enter a valid policy name' });
  if (name && ns && name.length + ns.length > 62) {
    basicErrors.push({ key: 'The policy namespace and name together cannot exceed 62 characters' });
  }
  const templateErrors = validateResource({
    ...policy,
    metadata: { name: 'x', namespace: 'x' },
  }).filter(e => !e.key.startsWith('Name') && !e.key.startsWith('Namespace'));

  return (
    <SetupWizardDialog
      open={open}
      onClose={onClose}
      title={t('Create a policy')}
      resources={resources}
      summary={
        <Box>
          <SummaryList
            rows={[
              { label: t('Policy'), value: `${ns}/${name}` },
              {
                label: t('Remediation'),
                value: policy.spec?.remediationAction || t('per template'),
              },
              {
                label: t('Templates'),
                value: (policy.spec?.['policy-templates'] || [])
                  .map(x => `${x.objectDefinition?.kind} ${x.objectDefinition?.metadata?.name}`)
                  .join(', '),
              },
              {
                label: t('Placement'),
                value: `${placement.name} (${placement.mode === 'new' ? t('new') : t('existing')})`,
              },
            ]}
          />
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5 }}>
            {t('Equivalent PolicyGenerator (for kustomize / GitOps, not applied)')}
          </Typography>
          <CodeBlock
            value={[
              '# policy-generator.yaml',
              dumpYaml(generator.generator),
              ...generator.manifests.map(m => `# ${m.path}\n${dumpAllYaml(m.objects)}`),
            ].join('---\n')}
            maxHeight={260}
          />
        </Box>
      }
      steps={[
        {
          id: 'basics',
          label: t('Policy'),
          errors: basicErrors,
          description: t(
            'The policy, its placement and the binding are created in the same namespace (often a dedicated policies namespace).'
          ),
          content: (
            <Box>
              <FormSection
                title={t('Policy')}
                icon="mdi:shield-check-outline"
                docsUrl="https://open-cluster-management.io/docs/getting-started/integration/policy-controllers/policy/"
              >
                <FieldGrid columns={3}>
                  <ComboInput
                    label={t('Namespace')}
                    value={ns}
                    onChange={v => setPolicy(setIn(policy, ['metadata', 'namespace'], v || ''))}
                    options={namespaces}
                    required
                  />
                  <TextInput
                    label={t('Name')}
                    value={name}
                    onChange={v => setPolicy(setIn(policy, ['metadata', 'name'], v || ''))}
                    required
                  />
                  <SelectInput
                    label={t('Remediation')}
                    value={policy.spec?.remediationAction}
                    onChange={v => setPolicy(setIn(policy, ['spec', 'remediationAction'], v))}
                    options={[
                      { value: 'inform', description: t('Report violations only') },
                      {
                        value: 'enforce',
                        description: t('Change the clusters to make them compliant'),
                      },
                    ]}
                    emptyLabel={t('Per template')}
                  />
                </FieldGrid>
              </FormSection>
              <PolicyMetadataSection value={policy} onChange={v => setPolicy(v as PolicyJson)} />
            </Box>
          ),
        },
        {
          id: 'templates',
          label: t('Templates'),
          errors: templateErrors,
          description: t('What the policy checks or enforces on each cluster.'),
          content: (
            <PolicyTemplatesEditor
              value={policy.spec?.['policy-templates']}
              onChange={v => setPolicy(setIn(policy, ['spec', 'policy-templates'], v || []))}
            />
          ),
        },
        {
          id: 'placement',
          label: t('Placement'),
          description: t(
            'The clusters the policy applies to. A PlacementBinding named "<policy>-binding" connects the policy to it.'
          ),
          errors: ns ? placementChoiceErrors(placement) : [{ key: 'Choose the namespace first' }],
          content: ns ? (
            <PlacementChoiceStep namespace={ns} value={placement} onChange={setPlacement} />
          ) : null,
        },
      ]}
    />
  );
}
