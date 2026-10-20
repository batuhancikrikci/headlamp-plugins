import React from 'react';
import { useText } from '../../common/i18n';
import { Backend, endpointAddress } from '../../resources/backend';
import { crdByKind } from '../../resources/registry';
import { StringArray } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';

export function BackendList() {
  const { t } = useText();
  return (
    <EGListView
      crd={crdByKind('Backend')!}
      editing={EDITING.Backend}
      columns={[
        {
          id: 'endpoints',
          label: t('Endpoints'),
          render: (item: Backend) => (
            <StringArray items={(item.spec.endpoints || []).map(endpointAddress)} />
          ),
          getValue: (item: Backend) => (item.spec.endpoints || []).map(endpointAddress).join(', '),
        },
        {
          id: 'types',
          label: t('Type'),
          getValue: (item: Backend) => item.endpointTypes.join(', ') || '-',
        },
        {
          id: 'appProtocols',
          label: t('Protocols'),
          render: (item: Backend) => (
            <StringArray items={(item.spec.appProtocols || []).map(p => p.split('/').pop() || p)} />
          ),
          getValue: (item: Backend) => (item.spec.appProtocols || []).join(', '),
        },
      ]}
    />
  );
}
