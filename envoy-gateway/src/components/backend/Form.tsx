import React from 'react';
import {
  ArrayEditor,
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
import { useText } from '../../common/i18n';
import { BackendEndpoint, EndpointType, endpointType } from '../../resources/backend';
import { KubeJson } from '../../resources/types';
import { MetadataFields } from '../common/form/RefFields';

const APP_PROTOCOLS = [
  'gateway.envoyproxy.io/h2c',
  'gateway.envoyproxy.io/ws',
  'gateway.envoyproxy.io/wss',
];

function emptyEndpoint(type: EndpointType): BackendEndpoint {
  if (type === 'IP') return { ip: { address: '', port: 80 } };
  if (type === 'Unix') return { unix: { path: '' } };
  return { fqdn: { hostname: '', port: 443 } };
}

function EndpointEditor({
  endpoint,
  onChange,
}: {
  endpoint: BackendEndpoint;
  onChange: (next: BackendEndpoint) => void;
}) {
  const { t } = useText();
  const type = endpointType(endpoint) || 'FQDN';
  return (
    <FieldGrid columns={3}>
      <SelectInput
        label={t('Type')}
        allowEmpty={false}
        options={[
          { value: 'FQDN', label: t('Hostname (FQDN)') },
          { value: 'IP', label: t('IP address') },
          { value: 'Unix', label: t('Unix socket') },
        ]}
        value={type}
        onChange={v => onChange(emptyEndpoint((v as EndpointType) || 'FQDN'))}
      />
      {type === 'FQDN' && (
        <>
          <TextInput
            label={t('Hostname')}
            required
            placeholder="api.example.com"
            value={endpoint.fqdn?.hostname}
            onChange={v =>
              onChange({ fqdn: { port: endpoint.fqdn?.port ?? 443, hostname: v || '' } })
            }
          />
          <NumberInput
            label={t('Port')}
            required
            min={1}
            max={65535}
            value={endpoint.fqdn?.port}
            onChange={v =>
              onChange({ fqdn: { hostname: endpoint.fqdn?.hostname || '', port: v as number } })
            }
          />
        </>
      )}
      {type === 'IP' && (
        <>
          <TextInput
            label={t('Address')}
            required
            placeholder="10.0.0.12"
            value={endpoint.ip?.address}
            onChange={v => onChange({ ip: { port: endpoint.ip?.port ?? 80, address: v || '' } })}
          />
          <NumberInput
            label={t('Port')}
            required
            min={1}
            max={65535}
            value={endpoint.ip?.port}
            onChange={v =>
              onChange({ ip: { address: endpoint.ip?.address || '', port: v as number } })
            }
          />
        </>
      )}
      {type === 'Unix' && (
        <TextInput
          label={t('Socket path')}
          required
          placeholder="/var/run/app.sock"
          value={endpoint.unix?.path}
          onChange={v => onChange({ unix: { path: v || '' } })}
        />
      )}
    </FieldGrid>
  );
}

export function BackendForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const endpoints = bind<BackendEndpoint[]>(['spec', 'endpoints']);

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Endpoints')}
        description={t(
          'Destinations traffic is sent to. All endpoints of a Backend must be of the same type.'
        )}
        icon="mdi:server-network"
      >
        <ArrayEditor<BackendEndpoint>
          items={endpoints.value}
          onChange={endpoints.onChange}
          newItem={() => emptyEndpoint(endpointType(endpoints.value?.[0] || {}) || 'FQDN')}
          addLabel={t('Add endpoint')}
          itemTitle={(_, i) => t('Endpoint #{{index}}', { index: i + 1 })}
          emptyText={t('No endpoints yet.')}
          renderItem={(ep, update) => <EndpointEditor endpoint={ep} onChange={update} />}
        />
      </FormSection>
      <FormSection title={t('Protocol')} icon="mdi:swap-horizontal">
        <FieldGrid>
          <StringListInput
            label={t('Application protocols')}
            suggestions={APP_PROTOCOLS}
            help={t(
              'Protocols spoken by the backend, e.g. h2c for cleartext HTTP/2 or ws for WebSockets.'
            )}
            {...bind(['spec', 'appProtocols'])}
          />
          <SwitchInput
            label={t('Fallback backend')}
            help={t('Only receives traffic when the other backends of a route are unhealthy.')}
            {...bind(['spec', 'fallback'])}
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}
