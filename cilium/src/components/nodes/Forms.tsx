import React from 'react';
import { FormSection } from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { KeyValueEditor, LabelSelectorEditor, MetadataFields } from '../common/form/SelectorEditor';

/** cilium-config keys that are commonly overridden per node. */
const CONFIG_KEYS = [
  'devices',
  'direct-routing-device',
  'tunnel-protocol',
  'routing-mode',
  'mtu',
  'enable-bgp-control-plane',
  'enable-l2-announcements',
  'bpf-lb-acceleration',
  'enable-wireguard',
  'ipv4-native-routing-cidr',
];

export const NODE_LABEL_KEYS = [
  'kubernetes.io/hostname',
  'kubernetes.io/os',
  'node-role.kubernetes.io/control-plane',
  'node-role.kubernetes.io/worker',
  'topology.kubernetes.io/zone',
];

export function NodeConfigForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Nodes')}
        description={t('The nodes whose Cilium agents use the overrides below.')}
        icon="mdi:server"
      >
        <LabelSelectorEditor
          label={t('Node selector')}
          keySuggestions={NODE_LABEL_KEYS}
          emptyText={t('An empty selector matches every node.')}
          value={value.spec?.nodeSelector || {}}
          onChange={v => onChange({ ...value, spec: { ...value.spec, nodeSelector: v || {} } })}
        />
      </FormSection>
      <FormSection
        title={t('Configuration overrides')}
        description={t(
          'Keys of the cilium-config ConfigMap and the values to use on the matching nodes. Agents read them at startup.'
        )}
        icon="mdi:cog-outline"
      >
        <KeyValueEditor
          keyLabel={t('Config key')}
          addLabel={t('Add override')}
          keySuggestions={CONFIG_KEYS}
          keepEmpty
          value={value.spec?.defaults}
          onChange={v => onChange({ ...value, spec: { ...value.spec, defaults: v || {} } })}
        />
      </FormSection>
    </>
  );
}
