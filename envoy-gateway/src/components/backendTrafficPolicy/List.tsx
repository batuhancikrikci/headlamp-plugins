import React from 'react';
import { useText } from '../../common/i18n';
import { BackendTrafficPolicy } from '../../resources/backendTrafficPolicy';
import { crdByKind } from '../../resources/registry';
import { FeatureChips, TargetRefsList } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';
import { btpFeatures } from '../features';

export function BackendTrafficPolicyList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('BackendTrafficPolicy')!}
      editing={EDITING.BackendTrafficPolicy}
      columns={[
        {
          id: 'target',
          label: t('Targets'),
          render: (item: BackendTrafficPolicy) => (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
          getValue: (item: BackendTrafficPolicy) =>
            item.targetRefs.map(r => `${r.kind}/${r.name}`).join(', '),
        },
        {
          id: 'features',
          label: t('Features'),
          render: (item: BackendTrafficPolicy) => <FeatureChips features={btpFeatures(item, t)} />,
          getValue: (item: BackendTrafficPolicy) =>
            btpFeatures(item, t)
              .map(f => f.label)
              .join(', '),
        },
      ]}
    />
  );
}
