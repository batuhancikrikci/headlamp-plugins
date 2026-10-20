import React from 'react';
import { useText } from '../../common/i18n';
import { EnvoyPatchPolicy } from '../../resources/envoyPatchPolicy';
import { crdByKind } from '../../resources/registry';
import { TargetRefsList } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';

export function EnvoyPatchPolicyList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('EnvoyPatchPolicy')!}
      editing={EDITING.EnvoyPatchPolicy}
      columns={[
        {
          id: 'target',
          label: t('Target'),
          render: (item: EnvoyPatchPolicy) => (
            <TargetRefsList
              targetRefs={item.targetRefs}
              defaultNamespace={item.metadata.namespace}
            />
          ),
          getValue: (item: EnvoyPatchPolicy) =>
            item.targetRefs.map(r => `${r.kind}/${r.name}`).join(', '),
        },
        {
          id: 'patchCount',
          label: t('Patches'),
          getValue: (item: EnvoyPatchPolicy) => item.patchCount,
        },
        {
          id: 'priority',
          label: t('Priority'),
          getValue: (item: EnvoyPatchPolicy) => item.spec.priority ?? 0,
        },
      ]}
    />
  );
}
