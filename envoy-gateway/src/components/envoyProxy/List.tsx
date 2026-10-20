import React from 'react';
import { useText } from '../../common/i18n';
import { EnvoyProxy } from '../../resources/envoyProxy';
import { crdByKind } from '../../resources/registry';
import { useYesNo } from '../common/SharedComponents';
import { EGListView } from '../common/Views';
import { EDITING } from '../editing';
import {
  EnvoyProxyStatusLabel,
  envoyProxyStatusSortValue,
  useEnvoyProxyReferences,
} from './status';

export function EnvoyProxyList() {
  const { t } = useText();
  const yesNo = useYesNo();
  const { loading, referencesOf } = useEnvoyProxyReferences();
  return (
    <EGListView
      crd={crdByKind('EnvoyProxy')!}
      editing={EDITING.EnvoyProxy}
      statusColumn={{
        id: 'status',
        label: t('Status'),
        gridTemplate: 'min-content',
        render: (item: EnvoyProxy) => (
          <EnvoyProxyStatusLabel
            loading={loading}
            refs={referencesOf(item.metadata.name, item.metadata.namespace)}
          />
        ),
        getValue: (item: EnvoyProxy) =>
          envoyProxyStatusSortValue(referencesOf(item.metadata.name, item.metadata.namespace)),
      }}
      columns={[
        {
          id: 'provider',
          label: t('Provider'),
          getValue: (item: EnvoyProxy) => item.providerType,
        },
        {
          id: 'replicas',
          label: t('Replicas'),
          getValue: (item: EnvoyProxy) => item.replicas ?? '-',
        },
        {
          id: 'serviceType',
          label: t('Service Type'),
          getValue: (item: EnvoyProxy) => item.serviceType || '-',
        },
        {
          id: 'mergeGateways',
          label: t('Merge Gateways'),
          getValue: (item: EnvoyProxy) => yesNo(item.mergeGateways, true),
        },
      ]}
    />
  );
}
