import { Alert } from '@mui/material';
import React from 'react';
import {
  ArrayEditor,
  FieldGrid,
  FormSection,
  NumberListInput,
  StringListInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { YamlField } from '../../common/form/YamlField';
import { useText } from '../../common/i18n';
import { EnvoyBackendServiceRef, EnvoyServiceRef } from '../../resources/network';
import { KubeJson } from '../../resources/types';
import { LabelSelectorEditor, MetadataFields, NamespaceInput } from '../common/form/SelectorEditor';
import { NODE_LABEL_KEYS } from '../nodes/Forms';
import { withField } from '../policies/RuleEditor';

/** Form for CiliumEnvoyConfig and CiliumClusterwideEnvoyConfig. */
export function EnvoyConfigForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const services = bind<EnvoyServiceRef[]>(['spec', 'services']);
  const backends = bind<EnvoyBackendServiceRef[]>(['spec', 'backendServices']);
  const resources = bind<unknown>(['spec', 'resources']);
  const defaultNamespace = value.metadata?.namespace;

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Redirected services')}
        description={t('Traffic to these services is sent to the Envoy listener defined below.')}
        icon="mdi:lan"
      >
        <ArrayEditor<EnvoyServiceRef>
          items={services.value}
          onChange={services.onChange}
          newItem={() => ({ name: '', namespace: defaultNamespace || 'default' })}
          addLabel={t('Add service')}
          itemTitle={(service, i) => service.name || t('Service #{{index}}', { index: i + 1 })}
          emptyText={t('No service is redirected.')}
          renderItem={(service, update) => (
            <FieldGrid>
              <TextInput
                label={t('Service name')}
                required
                value={service.name}
                onChange={v => update({ ...service, name: v || '' })}
              />
              <NamespaceInput
                label={t('Namespace')}
                value={service.namespace}
                onChange={v => update(withField(service, 'namespace', v))}
              />
              <TextInput
                label={t('Listener')}
                help={t(
                  'Name of the listener resource to redirect to; the first listener when empty.'
                )}
                value={service.listener}
                onChange={v => update(withField(service, 'listener', v))}
              />
              <NumberListInput
                label={t('Ports')}
                helperText={t('Service ports to redirect; all ports when empty')}
                value={service.ports}
                onChange={v => update(withField(service, 'ports', v))}
              />
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection
        title={t('Backend services')}
        description={t(
          'Services whose endpoints are synced to Envoy as clusters, without redirecting their traffic.'
        )}
        icon="mdi:server-network"
      >
        <ArrayEditor<EnvoyBackendServiceRef>
          items={backends.value}
          onChange={backends.onChange}
          newItem={() => ({ name: '', namespace: defaultNamespace || 'default' })}
          addLabel={t('Add backend service')}
          itemTitle={(service, i) =>
            service.name || t('Backend service #{{index}}', { index: i + 1 })
          }
          renderItem={(service, update) => (
            <FieldGrid columns={3}>
              <TextInput
                label={t('Service name')}
                required
                value={service.name}
                onChange={v => update({ ...service, name: v || '' })}
              />
              <NamespaceInput
                label={t('Namespace')}
                value={service.namespace}
                onChange={v => update(withField(service, 'namespace', v))}
              />
              <StringListInput
                label={t('Ports')}
                helperText={t('Port numbers or names; all ports when empty')}
                value={service.number}
                onChange={v => update(withField(service, 'number', v))}
              />
            </FieldGrid>
          )}
        />
      </FormSection>
      <FormSection
        title={t('Envoy resources')}
        description={t(
          'Raw Envoy xDS resources (listeners, route configurations, clusters, endpoints, secrets). Each entry needs an "@type".'
        )}
        icon="mdi:code-json"
      >
        <Alert severity="info" sx={{ mb: 2 }}>
          {t(
            'Envoy resources are free-form and are edited as YAML here. They are passed to Envoy as-is; mistakes are reported in the Cilium agent or cilium-envoy logs, not by the API server.'
          )}
        </Alert>
        <YamlField
          label={t('Resources (YAML list)')}
          expect="array"
          minRows={14}
          value={resources.value}
          onChange={resources.onChange}
        />
      </FormSection>
      <FormSection title={t('Nodes')} icon="mdi:server">
        <LabelSelectorEditor
          label={t('Node selector')}
          optional
          nilText={t('Not set: the configuration applies to every node.')}
          emptyText={t('An empty selector matches every node.')}
          keySuggestions={NODE_LABEL_KEYS}
          {...bind(['spec', 'nodeSelector'])}
        />
      </FormSection>
    </>
  );
}
