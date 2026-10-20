import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ListState } from '../../common/States';
import { useCiliumList, useEndpointSubjects } from '../../hooks/useClusterData';
import {
  CiliumCIDRGroup,
  CiliumClusterwideNetworkPolicy,
  CiliumNetworkPolicy,
} from '../../resources/networkPolicy';
import { crd } from '../../resources/registry';
import {
  policySelectsSubject,
  referencedCIDRGroups,
  ruleDefaultDeny,
} from '../../utils/policyMatch';
import { flowSummary, policyView } from '../../utils/policyView';
import { EndpointsTable } from '../common/EndpointsTable';
import { CiliumLink, ResourceRefList } from '../common/ResourceRefLink';
import { FeatureChips, HealthLabel, StringArray } from '../common/Shared';
import { CiliumDetailView } from '../common/Views';
import { policyFeatureChips } from './Lists';
import { PolicyVisualization } from './PolicyVisualization';

type Policy = CiliumNetworkPolicy | CiliumClusterwideNetworkPolicy;

/** Endpoints the policy currently selects. */
function SelectedEndpoints({ policy }: { policy: Policy }) {
  const { t } = useText();
  const endpoints = useEndpointSubjects(policy.metadata.namespace);
  const hostOnly = policy.rules.length > 0 && policy.rules.every(r => !!r.nodeSelector);
  if (hostOnly) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('This is a host policy: it applies to the nodes matched by its node selector.')}
      </Typography>
    );
  }
  return (
    <ListState items={endpoints.items} error={endpoints.error} what={t('Cilium endpoints')} dense>
      {items => {
        const selected = items
          .filter(e => policySelectsSubject(policy.jsonData, e.subject))
          .map(e => e.endpoint);
        return (
          <>
            {selected.length === 0 && (
              <Alert severity="info" sx={{ mb: 1 }}>
                {t(
                  'No endpoint currently matches the selector of this policy, so it has no effect yet.'
                )}
              </Alert>
            )}
            <EndpointsTable
              endpoints={selected}
              showNamespace={!policy.metadata.namespace}
              emptyMessage={t('No endpoints selected.')}
            />
          </>
        );
      }}
    </ListState>
  );
}

function RulesTable({ policy }: { policy: Policy }) {
  const { t } = useText();
  const flows = policyView(policy.rules).flatMap(view =>
    view.flows.map(flow => ({ flow, ruleSet: view.index + 1 }))
  );
  return (
    <SimpleTable
      emptyMessage={t('No ingress or egress rules.')}
      data={flows}
      columns={[
        ...(policy.rules.length > 1
          ? [{ label: t('Rule set'), getter: (r: (typeof flows)[number]) => `#${r.ruleSet}` }]
          : []),
        {
          label: t('Direction'),
          getter: (r: (typeof flows)[number]) =>
            r.flow.direction === 'ingress' ? t('Ingress') : t('Egress'),
        },
        {
          label: t('Action'),
          getter: (r: (typeof flows)[number]) => (
            <HealthLabel
              health={r.flow.action === 'allow' ? 'success' : 'error'}
              label={r.flow.action === 'allow' ? t('Allow') : t('Deny')}
            />
          ),
        },
        {
          label: t('Peers'),
          getter: (r: (typeof flows)[number]) => (
            <StringArray items={r.flow.peers.map(p => p.label)} max={6} monospace />
          ),
        },
        {
          label: t('Ports'),
          getter: (r: (typeof flows)[number]) =>
            r.flow.ports.length || r.flow.icmp.length ? (
              <StringArray
                items={[...r.flow.ports.map(p => p.label), ...r.flow.icmp.map(i => `ICMP ${i}`)]}
              />
            ) : (
              t('All')
            ),
        },
        {
          label: t('L7'),
          getter: (r: (typeof flows)[number]) =>
            r.flow.l7.length ? (
              <StringArray
                items={r.flow.l7.map(l => `${l.protocol} ${l.label}`)}
                max={4}
                monospace
              />
            ) : (
              '-'
            ),
        },
      ]}
    />
  );
}

function PolicyDetail({
  kind,
}: {
  kind: 'CiliumNetworkPolicy' | 'CiliumClusterwideNetworkPolicy';
}) {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd(kind)}
      conditions="positive"
      extraInfo={(policy: Policy) => {
        const validity = policy.validity;
        const deny = policy.rules.map(ruleDefaultDeny);
        const directions = [
          deny.some(d => d.ingress) ? t('Ingress') : '',
          deny.some(d => d.egress) ? t('Egress') : '',
        ].filter(Boolean);
        const groups = referencedCIDRGroups(policy.jsonData);
        return [
          {
            name: t('Status'),
            value: (
              <HealthLabel
                health={validity.health}
                label={t(validity.label)}
                tooltip={validity.message}
              />
            ),
          },
          {
            name: t('Description'),
            value: policy.rules
              .map(r => r.description)
              .filter(Boolean)
              .join(' · '),
            hide: !policy.rules.some(r => r.description),
          },
          {
            name: t('Default deny'),
            value: directions.length ? directions.join(', ') : t('None'),
          },
          {
            name: t('Features'),
            value: <FeatureChips features={policyFeatureChips(policy.features, t)} />,
          },
          {
            name: t('CIDR groups'),
            value: (
              <ResourceRefList
                refs={groups.map(name => ({ group: 'cilium.io', kind: 'CiliumCIDRGroup', name }))}
              />
            ),
            hide: groups.length === 0,
          },
        ];
      }}
      sections={(policy: Policy) => [
        {
          id: 'cilium-policy-visualization',
          section: (
            <SectionBox title={t('Allowed traffic')}>
              <PolicyVisualization rules={policy.rules} namespace={policy.metadata.namespace} />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-policy-rules',
          section: (
            <SectionBox title={t('Rules')}>
              <RulesTable policy={policy} />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-policy-endpoints',
          section: (
            <SectionBox title={t('Selected endpoints')}>
              <SelectedEndpoints policy={policy} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}

export function NetworkPolicyDetail() {
  return <PolicyDetail kind="CiliumNetworkPolicy" />;
}

export function ClusterwideNetworkPolicyDetail() {
  return <PolicyDetail kind="CiliumClusterwideNetworkPolicy" />;
}

/** Policies whose rules reference the CIDR group. */
function CIDRGroupUsedBy({ name }: { name: string }) {
  const { t } = useText();
  const cnps = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy');
  const ccnps = useCiliumList<CiliumClusterwideNetworkPolicy>('CiliumClusterwideNetworkPolicy');
  const loading = cnps.items === null || ccnps.items === null;
  const policies: Policy[] = [...(cnps.items || []), ...(ccnps.items || [])].filter(policy =>
    referencedCIDRGroups(policy.jsonData).includes(name)
  );
  return (
    <ListState
      items={loading ? null : policies}
      error={cnps.error || ccnps.error}
      what={t('Cilium network policies')}
      dense
    >
      {items => (
        <SimpleTable
          emptyMessage={t('No policy references this CIDR group.')}
          data={items}
          columns={[
            {
              label: t('Policy'),
              getter: (policy: Policy) => (
                <CiliumLink
                  kind={policy.kind}
                  name={policy.metadata.name}
                  namespace={policy.metadata.namespace}
                  showKind
                />
              ),
            },
            { label: t('Namespace'), getter: (policy: Policy) => policy.metadata.namespace || '-' },
            {
              label: t('Rules using the group'),
              getter: (policy: Policy) => (
                <Box>
                  {policyView(policy.rules)
                    .flatMap(view => view.flows)
                    .filter(flow => flow.peers.some(p => p.ref?.name === name))
                    .map(flow => (
                      <Typography key={flow.id} variant="body2">
                        {flowSummary(flow)}
                      </Typography>
                    ))}
                </Box>
              ),
            },
          ]}
        />
      )}
    </ListState>
  );
}

export function CIDRGroupDetail() {
  const { t } = useText();
  return (
    <CiliumDetailView
      crd={crd('CiliumCIDRGroup')}
      extraInfo={(group: CiliumCIDRGroup) => [{ name: t('CIDRs'), value: group.cidrs.length }]}
      sections={(group: CiliumCIDRGroup) => [
        {
          id: 'cilium-cidrgroup-cidrs',
          section: (
            <SectionBox title={t('External CIDRs')}>
              <StringArray items={group.cidrs} max={200} monospace />
            </SectionBox>
          ),
        },
        {
          id: 'cilium-cidrgroup-usedby',
          section: (
            <SectionBox title={t('Used by')}>
              <CIDRGroupUsedBy name={group.metadata.name} />
            </SectionBox>
          ),
        },
      ]}
    />
  );
}
