import React from 'react';
import { useText } from '../../common/i18n';
import { useCiliumList } from '../../hooks/useClusterData';
import { crd } from '../../resources/registry';
import {
  addressList,
  CiliumEndpoint,
  CiliumEndpointSlice,
  CiliumIdentity,
} from '../../resources/runtime';
import { EndpointState, EnforcementChips } from '../common/EndpointsTable';
import { CiliumLink } from '../common/ResourceRefLink';
import { StringArray } from '../common/Shared';
import { CiliumListView } from '../common/Views';

function labelChips(labels: Record<string, string>): string[] {
  return Object.entries(labels).map(([k, v]) => (v === '' ? k : `${k}=${v}`));
}

export function EndpointList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumEndpoint')}
      columns={[
        {
          id: 'identity',
          label: t('Identity'),
          gridTemplate: 'min-content',
          render: (e: CiliumEndpoint) =>
            e.identityId !== undefined ? (
              <CiliumLink kind="CiliumIdentity" name={String(e.identityId)} />
            ) : (
              '-'
            ),
          getValue: (e: CiliumEndpoint) => e.identityId ?? -1,
        },
        {
          id: 'endpointId',
          label: t('Endpoint ID'),
          gridTemplate: 'min-content',
          getValue: (e: CiliumEndpoint) => e.status.id ?? '-',
          show: false,
        },
        {
          id: 'ips',
          label: t('IPs'),
          getValue: (e: CiliumEndpoint) => e.addresses.join(', ') || '-',
        },
        {
          id: 'node',
          label: t('Node IP'),
          getValue: (e: CiliumEndpoint) => e.nodeIP || '-',
        },
        {
          id: 'enforcement',
          label: t('Policy enforcement'),
          render: (e: CiliumEndpoint) => (
            <EnforcementChips ingress={e.ingressEnforcing} egress={e.egressEnforcing} />
          ),
          getValue: (e: CiliumEndpoint) =>
            [e.ingressEnforcing ? 'ingress' : '', e.egressEnforcing ? 'egress' : '']
              .filter(Boolean)
              .join(' ') || 'none',
        },
        {
          id: 'state',
          label: t('State'),
          gridTemplate: 'min-content',
          render: (e: CiliumEndpoint) => <EndpointState state={e.state} />,
          getValue: (e: CiliumEndpoint) => e.state,
        },
      ]}
    />
  );
}

export function EndpointSliceList() {
  const { t } = useText();
  return (
    <CiliumListView
      crd={crd('CiliumEndpointSlice')}
      columns={[
        {
          id: 'targetNamespace',
          label: t('Namespace'),
          getValue: (slice: CiliumEndpointSlice) => slice.targetNamespace || '-',
        },
        {
          id: 'endpoints',
          label: t('Endpoints'),
          gridTemplate: 'min-content',
          getValue: (slice: CiliumEndpointSlice) => slice.endpoints.length,
        },
        {
          id: 'identities',
          label: t('Identities'),
          render: (slice: CiliumEndpointSlice) => (
            <StringArray
              items={
                Array.from(new Set(slice.endpoints.map(e => e.id).filter(Boolean))) as number[]
              }
              max={6}
            />
          ),
          getValue: (slice: CiliumEndpointSlice) =>
            Array.from(new Set(slice.endpoints.map(e => e.id))).join(', '),
        },
        {
          id: 'ips',
          label: t('IPs'),
          render: (slice: CiliumEndpointSlice) => (
            <StringArray items={slice.endpoints.flatMap(e => addressList(e.networking))} max={4} />
          ),
          getValue: (slice: CiliumEndpointSlice) =>
            slice.endpoints.flatMap(e => addressList(e.networking)).join(', '),
          show: false,
        },
      ]}
    />
  );
}

export function IdentityList() {
  const { t } = useText();
  const endpoints = useCiliumList<CiliumEndpoint>('CiliumEndpoint');
  const counts = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of endpoints.items || []) {
      if (e.identityId !== undefined) out[e.identityId] = (out[e.identityId] || 0) + 1;
    }
    return out;
  }, [endpoints.items]);

  return (
    <CiliumListView
      crd={crd('CiliumIdentity')}
      columns={[
        {
          id: 'identityNamespace',
          label: t('Namespace'),
          getValue: (identity: CiliumIdentity) => identity.identityNamespace || '-',
        },
        {
          id: 'labels',
          label: t('Security labels'),
          render: (identity: CiliumIdentity) => (
            <StringArray items={labelChips(identity.workloadLabels)} max={5} monospace />
          ),
          getValue: (identity: CiliumIdentity) => labelChips(identity.workloadLabels).join(', '),
        },
        {
          id: 'endpoints',
          label: t('Endpoints'),
          gridTemplate: 'min-content',
          getValue: (identity: CiliumIdentity) =>
            endpoints.items ? counts[identity.metadata.name] || 0 : '…',
        },
      ]}
    />
  );
}
