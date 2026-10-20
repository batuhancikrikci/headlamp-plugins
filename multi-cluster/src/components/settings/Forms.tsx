/**
 * ClusterManager form: the settings hub administrators change most often (registration
 * auto-approval, feature gates, work driver). Everything else stays editable in YAML.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  SelectInput,
  StringListInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { FeatureGate } from '../../resources/models/operator';
import { MetadataFields } from '../common/form/MetadataFields';

function FeatureGatesEditor({
  value,
  onChange,
}: {
  value: FeatureGate[] | undefined;
  onChange: (v: FeatureGate[] | undefined) => void;
}) {
  const { t } = useText();
  return (
    <ArrayEditor<FeatureGate>
      items={value}
      onChange={onChange}
      newItem={() => ({ feature: '', mode: 'Enable' })}
      addLabel={t('Add feature gate')}
      itemTitle={(g, i) => g.feature || t('Feature gate {{n}}', { n: i + 1 })}
      renderItem={(g, update) => (
        <FieldGrid columns={2}>
          <TextInput
            label={t('Feature')}
            value={g.feature}
            onChange={v => update({ ...g, feature: v || '' })}
            required
          />
          <SelectInput
            label={t('Mode')}
            value={g.mode}
            onChange={v => update({ ...g, mode: v })}
            options={['Enable', 'Disable']}
            emptyLabel="Enable"
          />
        </FieldGrid>
      )}
    />
  );
}

export function ClusterManagerForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const components: Array<{ key: string; label: string }> = [
    { key: 'registrationConfiguration', label: t('Registration') },
    { key: 'workConfiguration', label: t('Work') },
    { key: 'addOnManagerConfiguration', label: t('Add-on manager') },
    { key: 'placementConfiguration', label: t('Placement (OCM v1.3.0+)') },
  ];
  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t(
          'The cluster manager configures the hub control plane. Changes roll out the hub components.'
        )}
      </Alert>
      <MetadataFields value={value} onChange={onChange} mode={mode} showLabels={false} />
      <FormSection
        title={t('Registration')}
        icon="mdi:account-check-outline"
        docsUrl="https://open-cluster-management.io/docs/getting-started/administration/featuregates/"
      >
        <StringListInput
          {...bind<string[]>(['spec', 'registrationConfiguration', 'autoApproveUsers'])}
          label={t('Auto-approved users')}
          help={t(
            'Users whose registration CSRs are approved and clusters accepted automatically (requires the ManagedClusterAutoApproval feature gate).'
          )}
        />
      </FormSection>
      <FormSection title={t('Work')} icon="mdi:package-variant-closed">
        <Box sx={{ maxWidth: 320 }}>
          <SelectInput
            {...bind<string>(['spec', 'workConfiguration', 'workDriver'])}
            label={t('Work driver')}
            options={['kube', 'mqtt', 'grpc']}
            emptyLabel="kube"
          />
        </Box>
      </FormSection>
      {components.map(c => (
        <FormSection
          key={c.key}
          title={t('{{component}} feature gates', { component: c.label })}
          icon="mdi:toggle-switch-outline"
        >
          <FeatureGatesEditor
            value={value.spec?.[c.key]?.featureGates}
            onChange={v => onChange(setIn(value, ['spec', c.key, 'featureGates'], v))}
          />
        </FormSection>
      ))}
    </Box>
  );
}
