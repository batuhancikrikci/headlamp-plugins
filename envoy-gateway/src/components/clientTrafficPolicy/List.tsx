import React from 'react';
import { useText } from '../../common/i18n';
import { ClientTrafficPolicy } from '../../resources/clientTrafficPolicy';
import { crdByKind } from '../../resources/registry';
import { FeatureChips, StringArray, TargetRefsList } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';
import { ctpFeatures } from '../features';

export function ClientTrafficPolicyList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('ClientTrafficPolicy')!}
      editing={EDITING.ClientTrafficPolicy}
      columns={[
        {
          id: 'target',
          label: t('Targets'),
          render: (item: ClientTrafficPolicy) => (
            <TargetRefsList
              targetRefs={item.targetRefs}
              targetSelectors={item.targetSelectors}
              defaultNamespace={item.metadata.namespace}
            />
          ),
          getValue: (item: ClientTrafficPolicy) =>
            item.targetRefs.map(r => `${r.kind}/${r.name}`).join(', '),
        },
        {
          id: 'http',
          label: t('HTTP Versions'),
          render: (item: ClientTrafficPolicy) => <StringArray items={item.httpVersions} />,
          getValue: (item: ClientTrafficPolicy) => item.httpVersions.join(', '),
        },
        {
          id: 'features',
          label: t('Features'),
          render: (item: ClientTrafficPolicy) => <FeatureChips features={ctpFeatures(item, t)} />,
          getValue: (item: ClientTrafficPolicy) =>
            ctpFeatures(item, t)
              .map(f => f.label)
              .join(', '),
        },
      ]}
    />
  );
}
