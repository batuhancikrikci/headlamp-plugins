import React from 'react';
import { useText } from '../../common/i18n';
import { EnvoyExtensionPolicy } from '../../resources/envoyExtensionPolicy';
import { crdByKind } from '../../resources/registry';
import { FeatureChips, TargetRefsList } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';
import { eepFeatures } from '../features';

export function EnvoyExtensionPolicyList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('EnvoyExtensionPolicy')!}
      editing={EDITING.EnvoyExtensionPolicy}
      columns={[
        {
          id: 'target',
          label: t('Targets'),
          render: (item: EnvoyExtensionPolicy) => (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
          getValue: (item: EnvoyExtensionPolicy) =>
            item.targetRefs.map(r => `${r.kind}/${r.name}`).join(', '),
        },
        {
          id: 'extensions',
          label: t('Extensions'),
          render: (item: EnvoyExtensionPolicy) => <FeatureChips features={eepFeatures(item, t)} />,
          getValue: (item: EnvoyExtensionPolicy) =>
            eepFeatures(item, t)
              .map(f => f.label)
              .join(', '),
        },
      ]}
    />
  );
}
