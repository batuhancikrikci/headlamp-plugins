/**
 * Governance forms. The policy form edits the policy templates with builders for
 * ConfigurationPolicy and OperatorPolicy, or as raw YAML for any other policy kind (Gatekeeper,
 * Kyverno, ...).
 */
import { Alert, Box, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material';
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
import { getIn, setIn } from '../../common/objects';
import { useOcmList } from '../../hooks/useOcmList';
import { KubeJson } from '../../resources/models/common';
import { PlacementJson } from '../../resources/models/placement';
import {
  annotationList,
  configurationPolicyTemplate,
  isReplicatedPolicy,
  operatorPolicyTemplate,
  POLICY_ANNOTATIONS,
  PolicyJson,
  PolicyTemplate,
  PRUNE_BEHAVIORS,
  SEVERITIES,
} from '../../resources/models/policy';
import { MetadataFields } from '../common/form/MetadataFields';

const DOCS =
  'https://open-cluster-management.io/docs/getting-started/integration/policy-controllers/';

type TemplateKind = 'ConfigurationPolicy' | 'OperatorPolicy' | 'other';

function templateKind(t: PolicyTemplate): TemplateKind {
  const kind = t.objectDefinition?.kind;
  return kind === 'ConfigurationPolicy' || kind === 'OperatorPolicy' ? kind : 'other';
}

/** ConfigurationPolicy: objects (as YAML), compliance type, severity, namespaces, prune. */
function ConfigurationPolicyEditor({
  value,
  onChange,
}: {
  value: PolicyTemplate;
  onChange: (v: PolicyTemplate) => void;
}) {
  const { t } = useText();
  const def = value.objectDefinition;
  const set = (path: string[], v: unknown) =>
    onChange({ ...value, objectDefinition: setIn(def, path, v) });
  const templates: Array<{ complianceType?: string; objectDefinition: KubeJson }> =
    def.spec?.['object-templates'] || [];
  const types = Array.from(new Set(templates.map(x => (x.complianceType || '').toLowerCase())));
  const complianceType = types.length === 1 ? types[0] : undefined;
  const raw = def.spec?.['object-templates-raw'] !== undefined;
  return (
    <Box>
      <FieldGrid columns={3}>
        <TextInput
          label={t('Name')}
          value={def.metadata?.name}
          onChange={v => set(['metadata', 'name'], v || '')}
          required
        />
        <SelectInput
          label={t('Remediation')}
          value={(def.spec?.remediationAction || '').toLowerCase() || undefined}
          onChange={v => set(['spec', 'remediationAction'], v || 'inform')}
          options={['inform', 'enforce']}
          allowEmpty={false}
          help={t('Overridden by the policy remediation when the policy sets one.')}
        />
        <SelectInput
          label={t('Severity')}
          value={def.spec?.severity}
          onChange={v => set(['spec', 'severity'], v)}
          options={[...SEVERITIES]}
        />
        <SelectInput
          label={t('Compliance type')}
          value={complianceType}
          onChange={v =>
            set(
              ['spec', 'object-templates'],
              templates.map(x => ({ ...x, complianceType: v || 'musthave' }))
            )
          }
          options={[
            {
              value: 'musthave',
              description: t('The objects must exist with at least these fields'),
            },
            {
              value: 'mustonlyhave',
              description: t('The objects must exist with exactly these fields'),
            },
            { value: 'mustnothave', description: t('The objects must not exist') },
          ]}
          emptyLabel={t('mixed (see YAML)')}
        />
        <SelectInput
          label={t('Prune when the policy is removed')}
          value={def.spec?.pruneObjectBehavior}
          onChange={v => set(['spec', 'pruneObjectBehavior'], v)}
          options={PRUNE_BEHAVIORS.map(p => ({ value: p }))}
          emptyLabel="None"
        />
      </FieldGrid>
      <Box sx={{ mt: 2 }}>
        <FieldGrid columns={2}>
          <StringListInput
            label={t('Namespaces to include')}
            value={def.spec?.namespaceSelector?.include}
            onChange={v => set(['spec', 'namespaceSelector', 'include'], v)}
            help={t(
              'For namespaced objects without a namespace; file path patterns such as "app-*" are allowed.'
            )}
          />
          <StringListInput
            label={t('Namespaces to exclude')}
            value={def.spec?.namespaceSelector?.exclude}
            onChange={v => set(['spec', 'namespaceSelector', 'exclude'], v)}
            suggestions={['kube-*', 'openshift-*']}
          />
        </FieldGrid>
      </Box>
      <Box sx={{ mt: 2 }}>
        {raw ? (
          <Alert severity="info">
            {t('This template uses object-templates-raw (Go templates); edit it in the YAML tab.')}
          </Alert>
        ) : (
          <YamlField
            label={t('Objects (YAML documents separated by ---)')}
            value={templates.map(x => x.objectDefinition)}
            onChange={v =>
              set(
                ['spec', 'object-templates'],
                ((v as KubeJson[]) || []).map((o, i) => ({
                  ...(templates[i] || {}),
                  complianceType: templates[i]?.complianceType || complianceType || 'musthave',
                  objectDefinition: o,
                }))
              )
            }
            expect="manifests"
            minRows={10}
            helperText={t(
              'Only the fields you write are compared (musthave) or enforced. Templates like {{hub ... hub}} and {{ ... }} are kept as text.'
            )}
          />
        )}
      </Box>
    </Box>
  );
}

/** OperatorPolicy (OLM): operator package, channel, catalog, upgrade approval. */
function OperatorPolicyEditor({
  value,
  onChange,
}: {
  value: PolicyTemplate;
  onChange: (v: PolicyTemplate) => void;
}) {
  const { t } = useText();
  const def = value.objectDefinition;
  const bind = (path: string[]) => ({
    value: getIn<string>(def, path),
    onChange: (v: string | undefined) =>
      onChange({ ...value, objectDefinition: setIn(def, path, v) }),
  });
  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        {t(
          'Operator policies manage OLM subscriptions; the managed clusters need the Operator Lifecycle Manager.'
        )}
      </Alert>
      <FieldGrid columns={3}>
        <TextInput {...bind(['metadata', 'name'])} label={t('Name')} required />
        <SelectInput
          {...bind(['spec', 'remediationAction'])}
          label={t('Remediation')}
          options={['inform', 'enforce']}
          allowEmpty={false}
        />
        <SelectInput
          {...bind(['spec', 'severity'])}
          label={t('Severity')}
          options={[...SEVERITIES]}
        />
        <SelectInput
          {...bind(['spec', 'complianceType'])}
          label={t('Compliance type')}
          options={['musthave', 'mustnothave']}
          allowEmpty={false}
        />
        <TextInput
          {...bind(['spec', 'subscription', 'name'])}
          label={t('Operator package')}
          required
        />
        <TextInput
          {...bind(['spec', 'subscription', 'namespace'])}
          label={t('Install namespace')}
        />
        <TextInput {...bind(['spec', 'subscription', 'channel'])} label={t('Channel')} />
        <TextInput {...bind(['spec', 'subscription', 'source'])} label={t('Catalog source')} />
        <TextInput
          {...bind(['spec', 'subscription', 'sourceNamespace'])}
          label={t('Catalog namespace')}
        />
        <SelectInput
          {...bind(['spec', 'upgradeApproval'])}
          label={t('Upgrade approval')}
          options={[
            { value: 'None', description: t('Upgrades are not approved by the policy') },
            {
              value: 'Automatic',
              description: t('Upgrades within the allowed versions are approved'),
            },
          ]}
          allowEmpty={false}
        />
      </FieldGrid>
      <Box sx={{ mt: 2 }}>
        <StringListInput
          label={t('Allowed versions (CSV names)')}
          value={def.spec?.versions}
          onChange={v =>
            onChange({ ...value, objectDefinition: setIn(def, ['spec', 'versions'], v) })
          }
        />
      </Box>
    </Box>
  );
}

function newTemplate(kind: TemplateKind, index: number): PolicyTemplate {
  if (kind === 'OperatorPolicy') {
    return operatorPolicyTemplate({
      name: `operator-${index + 1}`,
      remediationAction: 'inform',
      complianceType: 'musthave',
      packageName: '',
      upgradeApproval: 'None',
    });
  }
  if (kind === 'ConfigurationPolicy') {
    return configurationPolicyTemplate({
      name: `config-${index + 1}`,
      remediationAction: 'inform',
      severity: 'low',
      complianceType: 'musthave',
      objects: [],
    });
  }
  return { objectDefinition: { apiVersion: '', kind: '', metadata: { name: '' } } };
}

/** Editor for `spec.policy-templates`. */
export function PolicyTemplatesEditor({
  value,
  onChange,
}: {
  value: PolicyTemplate[] | undefined;
  onChange: (v: PolicyTemplate[] | undefined) => void;
}) {
  const { t } = useText();
  const [kind, setKind] = React.useState<TemplateKind>('ConfigurationPolicy');
  return (
    <Box>
      <RadioGroup
        row
        value={kind}
        onChange={e => setKind(e.target.value as TemplateKind)}
        sx={{ mb: 1 }}
      >
        <Typography variant="body2" sx={{ alignSelf: 'center', mr: 1 }}>
          {t('New template:')}
        </Typography>
        <FormControlLabel
          value="ConfigurationPolicy"
          control={<Radio size="small" />}
          label="ConfigurationPolicy"
        />
        <FormControlLabel
          value="OperatorPolicy"
          control={<Radio size="small" />}
          label="OperatorPolicy"
        />
        <FormControlLabel
          value="other"
          control={<Radio size="small" />}
          label={t('Other (YAML)')}
        />
      </RadioGroup>
      <ArrayEditor<PolicyTemplate>
        items={value}
        onChange={onChange}
        newItem={() => newTemplate(kind, (value || []).length)}
        addLabel={t('Add {{kind}} template', { kind: kind === 'other' ? t('YAML') : kind })}
        itemTitle={(tpl, i) =>
          `${tpl.objectDefinition?.kind || t('Template')} ${
            tpl.objectDefinition?.metadata?.name || i + 1
          }`
        }
        emptyText={t('A policy delivers one or more policy templates to every selected cluster.')}
        renderItem={(tpl, update) => {
          const k = templateKind(tpl);
          if (k === 'ConfigurationPolicy')
            return <ConfigurationPolicyEditor value={tpl} onChange={update} />;
          if (k === 'OperatorPolicy') return <OperatorPolicyEditor value={tpl} onChange={update} />;
          return (
            <YamlField
              label={t('Policy object (objectDefinition)')}
              value={tpl.objectDefinition}
              onChange={v =>
                update({ ...tpl, objectDefinition: (v as KubeJson) || ({} as KubeJson) })
              }
              expect="object"
              minRows={8}
            />
          );
        }}
      />
    </Box>
  );
}

/** Standards, categories and controls annotations (comma separated). */
export function PolicyMetadataSection({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const field = (key: keyof typeof POLICY_ANNOTATIONS, label: string, suggestions: string[]) => (
    <StringListInput
      label={label}
      value={annotationList(value, POLICY_ANNOTATIONS[key])}
      onChange={v =>
        onChange(setIn(value, ['metadata', 'annotations', POLICY_ANNOTATIONS[key]], v?.join(', ')))
      }
      suggestions={suggestions}
    />
  );
  return (
    <FormSection
      title={t('Standards and controls')}
      icon="mdi:certificate-outline"
      description={t('Annotations used to group policies in compliance reports.')}
    >
      <FieldGrid columns={3}>
        {field('standards', t('Standards'), ['NIST SP 800-53', 'NIST-CSF', 'PCI-DSS', 'CIS'])}
        {field('categories', t('Categories'), [
          'CM Configuration Management',
          'AC Access Control',
          'SC System and Communications Protection',
        ])}
        {field('controls', t('Controls'), [
          'CM-2 Baseline Configuration',
          'AC-3 Access Enforcement',
        ])}
      </FieldGrid>
    </FormSection>
  );
}

export function PolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value as PolicyJson, onChange);
  return (
    <Box>
      {isReplicatedPolicy(value) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('This is a cluster copy managed by the propagator; edit the root policy instead.')}
        </Alert>
      )}
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        namespaceHelp={t('Policies, their placements and bindings live in the same namespace.')}
      />
      <FormSection
        title={t('Behaviour')}
        icon="mdi:shield-check-outline"
        docsUrl={`${DOCS}policy/`}
      >
        <FieldGrid columns={3}>
          <SelectInput
            {...bind<string>(['spec', 'remediationAction'])}
            label={t('Remediation')}
            options={[
              { value: 'inform', description: t('Report violations only') },
              { value: 'enforce', description: t('Change the clusters to make them compliant') },
            ]}
            emptyLabel={t('Per template')}
            help={t('When set, overrides the remediation of every template.')}
          />
          <SwitchInput {...bind<boolean>(['spec', 'disabled'])} label={t('Disabled')} keepFalse />
          <SwitchInput
            {...bind<boolean>(['spec', 'copyPolicyMetadata'])}
            label={t('Copy labels and annotations to clusters')}
          />
        </FieldGrid>
      </FormSection>
      <PolicyMetadataSection value={value} onChange={onChange} />
      <FormSection
        title={t('Policy templates')}
        icon="mdi:file-cog-outline"
        docsUrl={`${DOCS}configuration-policy/`}
      >
        <PolicyTemplatesEditor
          value={value.spec?.['policy-templates']}
          onChange={v => onChange(setIn(value, ['spec', 'policy-templates'], v || []))}
        />
      </FormSection>
      <FormSection
        title={t('Dependencies')}
        icon="mdi:source-branch"
        description={t(
          'Other objects (usually policies) that must reach a compliance state before this policy is applied.'
        )}
      >
        <YamlField
          label={t('dependencies')}
          value={value.spec?.dependencies}
          onChange={v => onChange(setIn(value, ['spec', 'dependencies'], v))}
          expect="array"
          minRows={4}
        />
      </FormSection>
    </Box>
  );
}

export function PlacementBindingForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const ns = value.metadata?.namespace;
  const placements = useOcmList<PlacementJson>('Placement', { namespace: ns, enabled: !!ns });
  const policies = useOcmList<PolicyJson>('Policy', { namespace: ns, enabled: !!ns });
  const sets = useOcmList<KubeJson>('PolicySet', { namespace: ns, enabled: !!ns });
  const subjects: Array<{ kind?: string; name?: string; apiGroup?: string }> = value.subjects || [];
  const subjectOptions = [
    ...(policies.items || [])
      .filter(p => !isReplicatedPolicy(p))
      .map(p => `Policy/${p.metadata.name}`),
    ...(sets.items || []).map(s => `PolicySet/${s.metadata.name}`),
  ];
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection title={t('Placement')} icon="mdi:target" docsUrl={`${DOCS}policy/`}>
        <SelectInput
          label={t('Placement')}
          value={value.placementRef?.name || undefined}
          onChange={v =>
            onChange(
              setIn(value, ['placementRef'], {
                apiGroup: 'cluster.open-cluster-management.io',
                kind: 'Placement',
                name: v || '',
              })
            )
          }
          options={(placements.items || []).map(p => p.metadata.name).sort()}
          allowEmpty={false}
          required
        />
      </FormSection>
      <FormSection
        title={t('Subjects')}
        icon="mdi:shield-check-outline"
        description={t('Policies and policy sets of the same namespace to place.')}
      >
        <StringListInput
          label={t('Policies and policy sets')}
          value={subjects.map(s => `${s.kind}/${s.name}`)}
          onChange={v =>
            onChange(
              setIn(
                value,
                ['subjects'],
                (v || []).map(entry => {
                  const [kind, ...rest] = entry.includes('/')
                    ? entry.split('/')
                    : ['Policy', entry];
                  return {
                    apiGroup: 'policy.open-cluster-management.io',
                    kind,
                    name: rest.join('/'),
                  };
                })
              )
            )
          }
          suggestions={subjectOptions}
          helperText={t('Write Policy/<name> or PolicySet/<name>.')}
        />
        <Box sx={{ mt: 2, maxWidth: 360 }}>
          <SelectInput
            label={t('Remediation override')}
            value={value.bindingOverrides?.remediationAction}
            onChange={v => onChange(setIn(value, ['bindingOverrides', 'remediationAction'], v))}
            options={['enforce']}
            emptyLabel={t('None')}
            help={t('Enforce the bound policies on these clusters even if they inform.')}
          />
        </Box>
      </FormSection>
    </Box>
  );
}

export function PolicySetForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const ns = value.metadata?.namespace;
  const policies = useOcmList<PolicyJson>('Policy', { namespace: ns, enabled: !!ns });
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection title={t('Policies')} icon="mdi:shield-star-outline" docsUrl={`${DOCS}policy/`}>
        <TextInput {...bind<string>(['spec', 'description'])} label={t('Description')} />
        <Box sx={{ mt: 2 }}>
          <StringListInput
            {...bind<string[]>(['spec', 'policies'])}
            label={t('Policies')}
            suggestions={(policies.items || [])
              .filter(p => !isReplicatedPolicy(p))
              .map(p => p.metadata.name)}
          />
        </Box>
      </FormSection>
    </Box>
  );
}

export function PolicyAutomationForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const ns = value.metadata?.namespace;
  const policies = useOcmList<PolicyJson>('Policy', { namespace: ns, enabled: !!ns });
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      <FormSection
        title={t('Trigger')}
        icon="mdi:robot-industrial-outline"
        description={t(
          'Runs an Ansible Automation Platform job template when the policy becomes non-compliant (requires the Ansible Automation Platform resource operator on the hub).'
        )}
      >
        <FieldGrid columns={3}>
          <ComboInput
            {...bind<string>(['spec', 'policyRef'])}
            label={t('Policy')}
            options={(policies.items || [])
              .filter(p => !isReplicatedPolicy(p))
              .map(p => p.metadata.name)}
            required
          />
          <SelectInput
            {...bind<string>(['spec', 'mode'])}
            label={t('Mode')}
            options={[
              { value: 'once', description: t('Run once, then switch to disabled') },
              { value: 'everyEvent', description: t('Run for every new non-compliant cluster') },
              { value: 'disabled', description: t('Do not run') },
            ]}
            allowEmpty={false}
          />
          <NumberInput
            {...bind<number>(['spec', 'delayAfterRunSeconds'])}
            label={t('Delay after run (seconds)')}
            min={0}
          />
        </FieldGrid>
      </FormSection>
      <FormSection title={t('Ansible job')} icon="mdi:ansible">
        <FieldGrid columns={3}>
          <TextInput
            {...bind<string>(['spec', 'automationDef', 'name'])}
            label={t('Job template name')}
            required
          />
          <TextInput
            {...bind<string>(['spec', 'automationDef', 'secret'])}
            label={t('Credential secret')}
            required
          />
          <NumberInput
            {...bind<number>(['spec', 'automationDef', 'policyViolationsLimit'])}
            label={t('Max violations passed')}
            min={0}
          />
        </FieldGrid>
        <Box sx={{ mt: 2 }}>
          <YamlField
            label={t('Extra variables (YAML mapping)')}
            value={value.spec?.automationDef?.extra_vars}
            onChange={v => onChange(setIn(value, ['spec', 'automationDef', 'extra_vars'], v))}
            expect="object"
            minRows={4}
          />
        </Box>
      </FormSection>
    </Box>
  );
}
