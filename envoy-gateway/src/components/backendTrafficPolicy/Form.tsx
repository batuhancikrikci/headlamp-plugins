import React from 'react';
import { FormSection, FormTabs, useBinder } from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { KubeJson } from '../../resources/types';
import { MetadataFields, TARGET_KINDS, TargetRefsEditor } from '../common/form/RefFields';
import {
  CircuitBreakerSection,
  CompressionSection,
  FaultInjectionSection,
  HealthCheckSection,
  LoadBalancerSection,
  RateLimitSection,
  RetrySection,
  TimeoutSection,
} from './sections';

export function BTPGeneralSection({
  value,
  onChange,
  mode,
}: Pick<ResourceFormProps, 'value' | 'onChange' | 'mode'>) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('Targets')}
        description={t(
          'Policies on a Gateway apply to all of its routes; a policy on a route overrides it.'
        )}
        icon="mdi:target"
      >
        <TargetRefsEditor
          kinds={TARGET_KINDS.gatewayAndRoutes}
          namespace={value.metadata?.namespace}
          withSection
          {...bind(['spec', 'targetRefs'])}
        />
      </FormSection>
    </>
  );
}

export function BackendTrafficPolicyForm(props: ResourceFormProps) {
  const { t } = useText();
  const section = { value: props.value, onChange: props.onChange };
  return (
    <FormTabs
      tabs={[
        { id: 'general', label: t('General'), content: <BTPGeneralSection {...props} /> },
        {
          id: 'traffic',
          label: t('Traffic'),
          content: (
            <>
              <LoadBalancerSection {...section} />
              <RateLimitSection {...section} />
            </>
          ),
        },
        {
          id: 'resilience',
          label: t('Resilience'),
          content: (
            <>
              <TimeoutSection {...section} />
              <RetrySection {...section} />
              <CircuitBreakerSection {...section} />
              <HealthCheckSection {...section} />
            </>
          ),
        },
        {
          id: 'advanced',
          label: t('Advanced'),
          content: (
            <>
              <CompressionSection {...section} />
              <FaultInjectionSection {...section} />
            </>
          ),
        },
      ]}
    />
  );
}
