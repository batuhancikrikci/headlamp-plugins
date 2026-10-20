import React from 'react';
import {
  DurationInput,
  FieldGrid,
  FormSection,
  FormTabs,
  NumberInput,
  SelectInput,
  StringListInput,
  SwitchInput,
  TextInput,
  ToggleSection,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { KubeJson } from '../../resources/types';
import { MetadataFields, TARGET_KINDS, TargetRefsEditor } from '../common/form/RefFields';

const TLS_VERSIONS = ['Auto', '1.0', '1.1', '1.2', '1.3'];
const ALPN = ['h2', 'http/1.1', 'http/1.0'];
const CIPHERS = [
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
];

export function ClientTrafficPolicyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const spec = value.spec || {};
  const namespace = value.metadata?.namespace;
  const toggle = (key: string, defaults: unknown) => (on: boolean) =>
    bind([`spec`, key]).onChange(on ? defaults : undefined);

  return (
    <FormTabs
      tabs={[
        {
          id: 'general',
          label: t('General'),
          content: (
            <>
              <FormSection title={t('General')} icon="mdi:tag-outline">
                <MetadataFields value={value} onChange={onChange} mode={mode} />
              </FormSection>
              <FormSection
                title={t('Targets')}
                description={t(
                  'ClientTrafficPolicies attach to Gateways; set a listener name to target one listener only.'
                )}
                icon="mdi:target"
              >
                <TargetRefsEditor
                  kinds={TARGET_KINDS.gatewayOnly}
                  namespace={namespace}
                  withSection
                  {...bind(['spec', 'targetRefs'])}
                />
              </FormSection>
            </>
          ),
        },
        {
          id: 'tls',
          label: t('TLS'),
          content: (
            <ToggleSection
              title={t('TLS settings')}
              description={t(
                'Protocol versions, ciphers and ALPN negotiated with clients on HTTPS listeners.'
              )}
              icon="mdi:lock-outline"
              enabled={!!spec.tls}
              onToggle={toggle('tls', { minVersion: '1.2' })}
            >
              <FieldGrid>
                <SelectInput
                  label={t('Minimum TLS version')}
                  options={TLS_VERSIONS}
                  {...bind(['spec', 'tls', 'minVersion'])}
                />
                <SelectInput
                  label={t('Maximum TLS version')}
                  options={TLS_VERSIONS}
                  {...bind(['spec', 'tls', 'maxVersion'])}
                />
                <StringListInput
                  label={t('Cipher suites')}
                  suggestions={CIPHERS}
                  {...bind(['spec', 'tls', 'ciphers'])}
                />
                <StringListInput
                  label={t('ALPN protocols')}
                  suggestions={ALPN}
                  {...bind(['spec', 'tls', 'alpnProtocols'])}
                />
                <StringListInput
                  label={t('ECDH curves')}
                  suggestions={['X25519', 'P-256']}
                  {...bind(['spec', 'tls', 'ecdhCurves'])}
                />
                <SwitchInput
                  label={t('Client certificate optional')}
                  help={t(
                    'Only relevant when client certificate validation (mTLS) is configured in YAML.'
                  )}
                  {...bind(['spec', 'tls', 'clientValidation', 'optional'])}
                />
              </FieldGrid>
            </ToggleSection>
          ),
        },
        {
          id: 'http',
          label: t('HTTP'),
          content: (
            <>
              <ToggleSection
                title={t('HTTP/1.1')}
                icon="mdi:web"
                enabled={!!spec.http1}
                onToggle={toggle('http1', {})}
              >
                <FieldGrid>
                  <SwitchInput
                    label={t('Enable trailers')}
                    {...bind(['spec', 'http1', 'enableTrailers'])}
                  />
                  <SwitchInput
                    label={t('Preserve header case')}
                    {...bind(['spec', 'http1', 'preserveHeaderCase'])}
                  />
                  <SwitchInput
                    label={t('Accept HTTP/1.0 (use default host)')}
                    {...bind(['spec', 'http1', 'http10', 'useDefaultHost'])}
                  />
                </FieldGrid>
              </ToggleSection>
              <ToggleSection
                title={t('HTTP/2')}
                icon="mdi:web"
                enabled={!!spec.http2}
                onToggle={toggle('http2', {})}
              >
                <FieldGrid columns={3}>
                  <NumberInput
                    label={t('Max concurrent streams')}
                    min={1}
                    {...bind(['spec', 'http2', 'maxConcurrentStreams'])}
                  />
                  <TextInput
                    label={t('Initial stream window')}
                    placeholder="64Ki"
                    {...bind(['spec', 'http2', 'initialStreamWindowSize'])}
                  />
                  <TextInput
                    label={t('Initial connection window')}
                    placeholder="1Mi"
                    {...bind(['spec', 'http2', 'initialConnectionWindowSize'])}
                  />
                </FieldGrid>
              </ToggleSection>
              <FormSection title={t('HTTP/3')} icon="mdi:rocket-launch-outline">
                <SwitchInput
                  label={t('Enable HTTP/3 (QUIC)')}
                  help={t(
                    'Adds a UDP listener next to HTTPS listeners; requires a LoadBalancer that supports UDP.'
                  )}
                  value={!!spec.http3}
                  onChange={on => bind(['spec', 'http3']).onChange(on ? {} : undefined)}
                />
              </FormSection>
            </>
          ),
        },
        {
          id: 'connection',
          label: t('Connection'),
          content: (
            <>
              <FormSection title={t('Timeouts')} icon="mdi:timer-outline">
                <FieldGrid>
                  <DurationInput
                    label={t('Request received timeout')}
                    help={t('Maximum time to receive the full request from the client.')}
                    {...bind(['spec', 'timeout', 'http', 'requestReceivedTimeout'])}
                  />
                  <DurationInput
                    label={t('Idle timeout')}
                    placeholder="1h"
                    {...bind(['spec', 'timeout', 'http', 'idleTimeout'])}
                  />
                </FieldGrid>
              </FormSection>
              <FormSection title={t('Limits')} icon="mdi:speedometer">
                <FieldGrid columns={3}>
                  <NumberInput
                    label={t('Connection limit')}
                    min={1}
                    {...bind(['spec', 'connection', 'connectionLimit', 'value'])}
                  />
                  <DurationInput
                    label={t('Close delay')}
                    {...bind(['spec', 'connection', 'connectionLimit', 'closeDelay'])}
                  />
                  <TextInput
                    label={t('Buffer limit')}
                    placeholder="32Ki"
                    {...bind(['spec', 'connection', 'bufferLimit'])}
                  />
                </FieldGrid>
              </FormSection>
              <ToggleSection
                title={t('TCP keepalive')}
                icon="mdi:heart-pulse"
                enabled={!!spec.tcpKeepalive}
                onToggle={toggle('tcpKeepalive', {})}
              >
                <FieldGrid columns={3}>
                  <NumberInput
                    label={t('Probes')}
                    min={1}
                    {...bind(['spec', 'tcpKeepalive', 'probes'])}
                  />
                  <DurationInput
                    label={t('Idle time')}
                    {...bind(['spec', 'tcpKeepalive', 'idleTime'])}
                  />
                  <DurationInput
                    label={t('Interval')}
                    {...bind(['spec', 'tcpKeepalive', 'interval'])}
                  />
                </FieldGrid>
              </ToggleSection>
              <FormSection title={t('Other')} icon="mdi:dots-horizontal">
                <FieldGrid>
                  <SwitchInput
                    label={t('Enable PROXY protocol')}
                    help={t('Expect the HAProxy PROXY protocol header, e.g. behind an AWS NLB.')}
                    {...bind(['spec', 'enableProxyProtocol'])}
                  />
                  <TextInput
                    label={t('Health check path')}
                    placeholder="/ready"
                    help={t(
                      'Envoy answers this path itself, useful for load balancer health checks.'
                    )}
                    {...bind(['spec', 'healthCheck', 'path'])}
                  />
                  <SelectInput
                    label={t('Escaped slashes action')}
                    options={[
                      'KeepUnchanged',
                      'RejectRequest',
                      'UnescapeAndForward',
                      'UnescapeAndRedirect',
                    ]}
                    {...bind(['spec', 'path', 'escapedSlashesAction'])}
                  />
                  <SwitchInput
                    label={t('Disable merge slashes')}
                    {...bind(['spec', 'path', 'disableMergeSlashes'])}
                  />
                </FieldGrid>
              </FormSection>
            </>
          ),
        },
        {
          id: 'client',
          label: t('Client IP & Headers'),
          content: (
            <>
              <FormSection
                title={t('Client IP detection')}
                description={t('How the original client address is determined behind proxies.')}
                icon="mdi:ip-network-outline"
              >
                <FieldGrid>
                  <NumberInput
                    label={t('Trusted X-Forwarded-For hops')}
                    min={0}
                    {...bind(['spec', 'clientIPDetection', 'xForwardedFor', 'numTrustedHops'])}
                  />
                  <TextInput
                    label={t('Custom client IP header')}
                    placeholder="x-real-ip"
                    {...bind(['spec', 'clientIPDetection', 'customHeader', 'name'])}
                  />
                </FieldGrid>
              </FormSection>
              <FormSection title={t('Headers')} icon="mdi:format-list-bulleted">
                <FieldGrid>
                  <SwitchInput
                    label={t('Add Envoy headers (x-envoy-*)')}
                    {...bind(['spec', 'headers', 'enableEnvoyHeaders'])}
                  />
                  <SwitchInput
                    label={t('Preserve X-Request-ID')}
                    {...bind(['spec', 'headers', 'preserveXRequestID'])}
                  />
                  <SwitchInput
                    label={t('Disable rate limit headers')}
                    {...bind(['spec', 'headers', 'disableRateLimitHeaders'])}
                  />
                  <SelectInput
                    label={t('Headers with underscores')}
                    options={['Allow', 'RejectRequest', 'DropHeader']}
                    {...bind(['spec', 'headers', 'withUnderscoresAction'])}
                  />
                  <SelectInput
                    label={t('X-Forwarded-Client-Cert mode')}
                    options={[
                      'Sanitize',
                      'ForwardOnly',
                      'AppendForward',
                      'SanitizeSet',
                      'AlwaysForwardOnly',
                    ]}
                    {...bind(['spec', 'headers', 'xForwardedClientCert', 'mode'])}
                  />
                </FieldGrid>
              </FormSection>
            </>
          ),
        },
      ]}
    />
  );
}
