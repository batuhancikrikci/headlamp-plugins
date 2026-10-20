import {
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useCiliumList } from '../../hooks/useClusterData';
import { CiliumClusterwideNetworkPolicy, CiliumNetworkPolicy } from '../../resources/networkPolicy';
import { crd } from '../../resources/registry';
import {
  addressList,
  CiliumEndpoint,
  CiliumEndpointSlice,
  CiliumIdentity,
  CoreEndpoint,
  NamedPort,
} from '../../resources/runtime';
import {
  EndpointSubject,
  selectingRules,
  subjectFromIdentityLabels,
} from '../../utils/policyMatch';
import { policyView } from '../../utils/policyView';
import { EndpointsTable, EndpointState, EnforcementChips } from '../common/EndpointsTable';
import { CiliumLink, ResourceRefLink } from '../common/ResourceRefLink';
import { HealthLabel, StringArray } from '../common/Shared';
import { CiliumDetailView } from '../common/Views';

/**
 * Policies that select an endpoint, with the directions each of them restricts. Shared by the
 * endpoint detail page and the section added to Headlamp's Pod page.
 */
export function PoliciesForSubject({
  subject,
  emptyMessage,
}: {
  subject: EndpointSubject;
  emptyMessage?: string;
}) {
  const { t } = useText();
  const cnps = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy', subject.namespace);
  const ccnps = useCiliumList<CiliumClusterwideNetworkPolicy>('CiliumClusterwideNetworkPolicy');
  const loading = cnps.items === null || ccnps.items === null;
  const rows = [...(cnps.items || []), ...(ccnps.items || [])]
    .map(policy => ({ policy, rules: selectingRules(policy.jsonData, subject) }))
    .filter(row => row.rules.length > 0);

  return (
    <ListState
      items={loading ? null : rows}
      error={cnps.error || ccnps.error}
      what={t('Cilium network policies')}
      dense
    >
      {items => (
        <SimpleTable
          emptyMessage={
            emptyMessage || t('No Cilium policy selects this endpoint: all traffic is allowed.')
          }
          data={items}
          columns={[
            {
              label: t('Policy'),
              getter: (row: (typeof rows)[number]) => (
                <CiliumLink
                  kind={row.policy.kind}
                  name={row.policy.metadata.name}
                  namespace={row.policy.metadata.namespace}
                />
              ),
            },
            {
              label: t('Scope'),
              getter: (row: (typeof rows)[number]) =>
                row.policy.metadata.namespace ? t('Namespace') : t('Clusterwide'),
            },
            {
              label: t('Ingress'),
              getter: (row: (typeof rows)[number]) => {
                const flows = policyView(row.rules).flatMap(v => v.flows);
                const n = flows.filter(f => f.direction === 'ingress').length;
                return n ? t('{{n}} rule(s)', { n }) : '-';
              },
            },
            {
              label: t('Egress'),
              getter: (row: (typeof rows)[number]) => {
                const flows = policyView(row.rules).flatMap(v => v.flows);
                const n = flows.filter(f => f.direction === 'egress').length;
                return n ? t('{{n}} rule(s)', { n }) : '-';
              },
            },
            {
              label: t('Status'),
              getter: (row: (typeof rows)[number]) => {
                const validity = row.policy.validity;
                return (
                  <HealthLabel
                    health={validity.health}
                    label={t(validity.label)}
                    tooltip={validity.message}
                  />
                );
              },
            },
          ]}
        />
      )}
    </ListState>
  );
}

function NamedPorts({ ports }: { ports?: NamedPort[] }) {
  return (
    <StringArray
      items={(ports || []).map(p => `${p.name || '?'}: ${p.port}/${p.protocol || 'TCP'}`)}
    />
  );
}

export function EndpointDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumEndpoint')}
      extraInfo={(e: CiliumEndpoint) => [
        { name: t('State'), value: <EndpointState state={e.state} /> },
        {
          name: t('Pod'),
          value: (
            <ResourceRefLink kind="Pod" name={e.metadata.name} namespace={e.metadata.namespace} />
          ),
        },
        {
          name: t('Identity'),
          value:
            e.identityId !== undefined ? (
              <CiliumLink kind="CiliumIdentity" name={String(e.identityId)} />
            ) : (
              '-'
            ),
        },
        { name: t('Endpoint ID'), value: e.status.id ?? '-' },
        { name: t('IP addresses'), value: <StringArray items={e.addresses} monospace /> },
        { name: t('Node IP'), value: e.nodeIP || '-' },
        {
          name: t('Policy enforcement'),
          value: <EnforcementChips ingress={e.ingressEnforcing} egress={e.egressEnforcing} />,
        },
        {
          name: t('Encryption key'),
          value: e.status.encryption?.mesh,
          hide: !e.status.encryption?.mesh,
        },
        {
          name: t('Named ports'),
          value: <NamedPorts ports={e.status['named-ports']} />,
          hide: !e.status['named-ports']?.length,
        },
      ]}
      sections={(e: CiliumEndpoint) => {
        const labels = e.status.identity?.labels || [];
        const health = e.status.health;
        return [
          {
            id: 'cilium-endpoint-policies',
            section: (
              <SectionBox title={t('Policies selecting this endpoint')}>
                <PoliciesForSubject
                  subject={subjectFromIdentityLabels(e.metadata.namespace || '', labels)}
                />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-endpoint-labels',
            section: (
              <SectionBox title={t('Identity labels')}>
                <StringArray items={labels} max={100} monospace />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-endpoint-health',
            section: health && (
              <SectionBox title={t('Health')}>
                <NameValueTable
                  rows={[
                    { name: t('Overall'), value: health.overallHealth || '-' },
                    { name: t('Datapath (BPF)'), value: health.bpf || '-' },
                    { name: t('Policy'), value: health.policy || '-' },
                    {
                      name: t('Connected'),
                      value:
                        health.connected === undefined
                          ? '-'
                          : health.connected
                          ? t('Yes')
                          : t('No'),
                    },
                  ]}
                />
              </SectionBox>
            ),
          },
          {
            id: 'cilium-endpoint-log',
            section: !!e.status.log?.length && (
              <SectionBox title={t('State log')}>
                <SimpleTable
                  data={e.status.log}
                  columns={[
                    { label: t('Time'), getter: (l: { timestamp?: string }) => l.timestamp || '-' },
                    { label: t('State'), getter: (l: { state?: string }) => l.state || '-' },
                    { label: t('Code'), getter: (l: { code?: string }) => l.code || '-' },
                    { label: t('Message'), getter: (l: { message?: string }) => l.message || '-' },
                  ]}
                />
              </SectionBox>
            ),
          },
        ];
      }}
    />
  );
}

export function EndpointSliceDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumEndpointSlice')}
      extraInfo={(slice: CiliumEndpointSlice) => [
        {
          name: t('Namespace'),
          value: slice.targetNamespace ? (
            <ResourceRefLink kind="Namespace" name={slice.targetNamespace} />
          ) : (
            '-'
          ),
        },
        { name: t('Endpoints'), value: slice.endpoints.length },
      ]}
      sections={(slice: CiliumEndpointSlice) => [
        {
          id: 'cilium-slice-endpoints',
          section: (
            <SectionBox title={t('Endpoints')}>
              <SimpleTable
                emptyMessage={t('This slice is empty.')}
                data={slice.endpoints}
                columns={[
                  {
                    label: t('Endpoint'),
                    getter: (e: CoreEndpoint) =>
                      e.name ? (
                        <CiliumLink
                          kind="CiliumEndpoint"
                          name={e.name}
                          namespace={slice.targetNamespace}
                        />
                      ) : (
                        '-'
                      ),
                  },
                  {
                    label: t('Identity'),
                    getter: (e: CoreEndpoint) =>
                      e.id !== undefined ? (
                        <CiliumLink kind="CiliumIdentity" name={String(e.id)} />
                      ) : (
                        '-'
                      ),
                  },
                  {
                    label: t('IPs'),
                    getter: (e: CoreEndpoint) => addressList(e.networking).join(', ') || '-',
                  },
                  { label: t('Node IP'), getter: (e: CoreEndpoint) => e.networking?.node || '-' },
                  {
                    label: t('Named ports'),
                    getter: (e: CoreEndpoint) => <NamedPorts ports={e['named-ports']} />,
                  },
                ]}
              />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

function IdentityEndpoints({ identity }: { identity: CiliumIdentity }) {
  const { t } = useText();
  const endpoints = useCiliumList<CiliumEndpoint>(
    'CiliumEndpoint',
    identity.identityNamespace || undefined
  );
  return (
    <ListState items={endpoints.items} error={endpoints.error} what={t('Cilium endpoints')} dense>
      {items => (
        <EndpointsTable
          endpoints={items.filter(e => String(e.identityId) === identity.metadata.name)}
          emptyMessage={t(
            'No endpoint uses this identity. Unused identities are garbage collected by the operator.'
          )}
        />
      )}
    </ListState>
  );
}

export function IdentityDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumIdentity')}
      extraInfo={(identity: CiliumIdentity) => [
        { name: t('Identity'), value: identity.metadata.name },
        {
          name: t('Namespace'),
          value: identity.identityNamespace ? (
            <ResourceRefLink kind="Namespace" name={identity.identityNamespace} />
          ) : (
            '-'
          ),
        },
      ]}
      sections={(identity: CiliumIdentity) => [
        {
          id: 'cilium-identity-labels',
          section: (
            <SectionBox title={t('Security labels')}>
              {Object.keys(identity.securityLabels).length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('No security labels.')}
                </Typography>
              ) : (
                <NameValueTable
                  rows={Object.entries(identity.securityLabels).map(([name, value]) => ({
                    name,
                    value: value || '-',
                  }))}
                />
              )}
            </SectionBox>
          ),
        },
        {
          id: 'cilium-identity-endpoints',
          section: (
            <SectionBox title={t('Endpoints with this identity')}>
              <IdentityEndpoints identity={identity} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
