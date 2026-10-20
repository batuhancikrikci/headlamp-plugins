import React from 'react';
import { FormSection, FormTabs, useBinder } from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { AUTH_METHODS } from '../../resources/securityPolicy';
import { KubeJson } from '../../resources/types';
import { MetadataFields, TARGET_KINDS, TargetRefsEditor } from '../common/form/RefFields';
import { ManagedSecretsProvider } from './ManagedSecretsProvider';
import { AUTH_SECTIONS, AuthorizationSection, CORSSection } from './sections';

export function SPGeneralSection({
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
        description={t('Protect a whole Gateway, a listener, or individual routes.')}
        icon="mdi:target"
      >
        <TargetRefsEditor
          kinds={TARGET_KINDS.gatewayAndHttp}
          namespace={value.metadata?.namespace}
          withSection
          {...bind(['spec', 'targetRefs'])}
        />
      </FormSection>
    </>
  );
}

export function SecurityPolicyForm(props: ResourceFormProps) {
  const { t } = useText();
  const section = { value: props.value, onChange: props.onChange };
  return (
    <ManagedSecretsProvider {...props}>
      <FormTabs
        tabs={[
          { id: 'general', label: t('General'), content: <SPGeneralSection {...props} /> },
          {
            id: 'authn',
            label: t('Authentication'),
            content: (
              <>
                {AUTH_METHODS.map(m => {
                  const Section = AUTH_SECTIONS[m];
                  return <Section key={m} {...section} />;
                })}
              </>
            ),
          },
          { id: 'cors', label: t('CORS'), content: <CORSSection {...section} /> },
          {
            id: 'authz',
            label: t('Authorization'),
            content: <AuthorizationSection {...section} />,
          },
        ]}
      />
    </ManagedSecretsProvider>
  );
}
