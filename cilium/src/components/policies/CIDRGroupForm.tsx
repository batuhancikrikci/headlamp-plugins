import React from 'react';
import { FormSection, useBinder } from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { KubeJson } from '../../resources/types';
import { CIDRListInput, MetadataFields } from '../common/form/SelectorEditor';

export function CIDRGroupForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder<KubeJson>(value, onChange);
  return (
    <>
      <FormSection title={t('General')} icon="mdi:tag-outline">
        <MetadataFields value={value} onChange={onChange} mode={mode} />
      </FormSection>
      <FormSection
        title={t('External CIDRs')}
        description={t(
          'Policies reference this group by name (cidrGroupRef), so the list can change without touching the policies.'
        )}
        icon="mdi:format-list-group"
      >
        <CIDRListInput label={t('CIDRs')} {...bind(['spec', 'externalCIDRs'])} />
      </FormSection>
    </>
  );
}
