import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { useText } from '../../common/i18n';
import { Backend, endpointAddress, endpointType } from '../../resources/backend';
import { crdByKind } from '../../resources/registry';
import { ResourceRefList } from '../common/ResourceRefLink';
import { StringArray, useYesNo } from '../common/SharedComponents';
import { EGDetailView } from '../common/Views';
import { EDITING } from '../editing';
import { BackendUsedBy } from '../relations/UsedBy';

export function BackendDetail() {
  const { t } = useText();
  const yesNo = useYesNo();

  return (
    <EGDetailView
      crd={crdByKind('Backend')!}
      editing={EDITING.Backend}
      extraInfo={(item: Backend) => [
        { name: t('Endpoints'), value: item.endpointCount },
        { name: t('Type'), value: item.endpointTypes.join(', ') || '-' },
        { name: t('Application protocols'), value: <StringArray items={item.spec.appProtocols} /> },
        { name: t('Fallback backend'), value: yesNo(item.spec.fallback, true) },
      ]}
      sections={(item: Backend) => [
        {
          id: 'eg-backend-endpoints',
          section: !!item.spec.endpoints?.length && (
            <SectionBox title={t('Endpoints')}>
              <NameValueTable
                rows={item.spec.endpoints.map((ep, i) => ({
                  name: `#${i + 1} (${endpointType(ep) || '?'})`,
                  value: endpointAddress(ep),
                }))}
              />
            </SectionBox>
          ),
        },
        {
          id: 'eg-backend-tls',
          section: item.spec.tls && (
            <SectionBox title={t('TLS')}>
              <NameValueTable
                rows={[
                  { name: t('SNI'), value: item.spec.tls.sni || '-' },
                  {
                    name: t('Skip verification'),
                    value: yesNo(item.spec.tls.insecureSkipVerify, true),
                  },
                  {
                    name: t('CA certificates'),
                    value: (
                      <ResourceRefList
                        refs={(item.spec.tls.caCertificateRefs || []).map(r => ({
                          group: r.group || '',
                          kind: r.kind || 'ConfigMap',
                          name: r.name,
                          namespace: item.metadata.namespace,
                        }))}
                      />
                    ),
                  },
                ]}
              />
            </SectionBox>
          ),
        },
        {
          id: 'eg-backend-usedby',
          section: <BackendUsedBy name={item.metadata.name} namespace={item.metadata.namespace} />,
        },
      ]}
    />
  );
}
