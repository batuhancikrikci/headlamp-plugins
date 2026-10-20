import React from 'react';
import {
  DurationInput,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { getIn, setIn } from '../../common/objects';
import { KubeJson } from '../../resources/types';
import { MetadataFields, ObjectRefField } from '../common/form/RefFields';

const K8S = ['spec', 'provider', 'kubernetes'];

export function EnvoyProxyForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  const namespace = value.metadata?.namespace;

  // Setting any Kubernetes provider field also sets provider.type, which the API requires.
  const setK8s = (path: string[], v: unknown) => {
    let next = setIn(value, [...K8S, ...path], v);
    if (!getIn(next, ['spec', 'provider', 'type'])) {
      next = setIn(next, ['spec', 'provider', 'type'], 'Kubernetes');
    }
    onChange(next);
  };
  const k8sValue = <V,>(path: string[]) => bind<V>([...K8S, ...path]).value;

  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>

      <FormSection
        title={t('Envoy Deployment')}
        description={t(
          'How the Envoy data plane pods are deployed for Gateways using this configuration.'
        )}
        icon="mdi:kubernetes"
      >
        <FieldGrid>
          <NumberInput
            label={t('Replicas')}
            min={0}
            value={k8sValue<number>(['envoyDeployment', 'replicas'])}
            onChange={v => setK8s(['envoyDeployment', 'replicas'], v)}
          />
          <TextInput
            label={t('Envoy image')}
            placeholder="docker.io/envoyproxy/envoy:distroless-v1.33.0"
            help={t('Leave empty to use the image bundled with Envoy Gateway.')}
            value={k8sValue<string>(['envoyDeployment', 'container', 'image'])}
            onChange={v => setK8s(['envoyDeployment', 'container', 'image'], v)}
          />
          <NumberInput
            label={t('HPA min replicas')}
            min={1}
            value={k8sValue<number>(['envoyHpa', 'minReplicas'])}
            onChange={v => setK8s(['envoyHpa', 'minReplicas'], v)}
          />
          <NumberInput
            label={t('HPA max replicas')}
            min={1}
            help={t(
              'Setting a maximum enables a HorizontalPodAutoscaler for the Envoy deployment.'
            )}
            value={k8sValue<number>(['envoyHpa', 'maxReplicas'])}
            onChange={v => setK8s(['envoyHpa', 'maxReplicas'], v)}
          />
        </FieldGrid>
      </FormSection>

      <FormSection title={t('Envoy Service')} icon="mdi:lan">
        <FieldGrid>
          <SelectInput
            label={t('Service type')}
            options={['LoadBalancer', 'NodePort', 'ClusterIP']}
            value={k8sValue<string>(['envoyService', 'type'])}
            onChange={v => setK8s(['envoyService', 'type'], v)}
          />
          <SelectInput
            label={t('External traffic policy')}
            options={['Cluster', 'Local']}
            help={t(
              '"Local" preserves the client source IP but only routes to nodes running Envoy.'
            )}
            value={k8sValue<string>(['envoyService', 'externalTrafficPolicy'])}
            onChange={v => setK8s(['envoyService', 'externalTrafficPolicy'], v)}
          />
        </FieldGrid>
      </FormSection>

      <FormSection title={t('Behaviour')} icon="mdi:tune-variant">
        <FieldGrid>
          <SwitchInput
            label={t('Merge Gateways')}
            help={t('Serve all Gateways of the GatewayClass with a single Envoy fleet.')}
            {...bind(['spec', 'mergeGateways'])}
          />
          <SelectInput
            label={t('Default log level')}
            options={['debug', 'info', 'warn', 'error']}
            {...bind(['spec', 'logging', 'level', 'default'])}
          />
          <DurationInput
            label={t('Drain timeout')}
            {...bind(['spec', 'shutdown', 'drainTimeout'])}
          />
          <DurationInput
            label={t('Minimum drain duration')}
            {...bind(['spec', 'shutdown', 'minDrainDuration'])}
          />
        </FieldGrid>
      </FormSection>

      <FormSection title={t('Telemetry')} icon="mdi:chart-line">
        <FieldGrid>
          <SwitchInput
            label={t('Disable Prometheus metrics')}
            {...bind(['spec', 'telemetry', 'metrics', 'prometheus', 'disable'])}
          />
          <SwitchInput
            label={t('Disable access logs')}
            {...bind(['spec', 'telemetry', 'accessLog', 'disable'])}
          />
        </FieldGrid>
      </FormSection>

      <FormSection
        title={t('Backend TLS')}
        description={t('Client certificate Envoy presents to backends that require mTLS.')}
        icon="mdi:certificate-outline"
      >
        <ObjectRefField
          kind="Secret"
          label={t('Client certificate Secret')}
          namespace={namespace}
          {...bind(['spec', 'backendTLS', 'clientCertificateRef'])}
        />
      </FormSection>
    </>
  );
}
