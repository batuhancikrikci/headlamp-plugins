import React from 'react';
import { useText } from '../../common/i18n';
import { crdByKind } from '../../resources/registry';
import { SecurityPolicy } from '../../resources/securityPolicy';
import { FeatureChips, TargetRefsList } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';
import { spFeatures } from '../features';

export function SecurityPolicyList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('SecurityPolicy')!}
      editing={EDITING.SecurityPolicy}
      columns={[
        {
          id: 'target',
          label: t('Targets'),
          render: (item: SecurityPolicy) => (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
          getValue: (item: SecurityPolicy) =>
            item.targetRefs.map(r => `${r.kind}/${r.name}`).join(', '),
        },
        {
          id: 'features',
          label: t('Features'),
          render: (item: SecurityPolicy) => <FeatureChips features={spFeatures(item, t)} />,
          getValue: (item: SecurityPolicy) =>
            spFeatures(item, t)
              .map(f => f.label)
              .join(', '),
        },
      ]}
    />
  );
}
