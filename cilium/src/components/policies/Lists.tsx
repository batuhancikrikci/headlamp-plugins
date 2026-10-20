import { Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useCiliumList, useEndpointSubjects } from '../../hooks/useClusterData';
import {
  CiliumCIDRGroup,
  CiliumClusterwideNetworkPolicy,
  CiliumNetworkPolicy,
  PolicyFeatures,
} from '../../resources/networkPolicy';
import { crd } from '../../resources/registry';
import { policySelectsSubject, referencedCIDRGroups } from '../../utils/policyMatch';
import { selectorToString } from '../../utils/selectors';
import { Feature, FeatureChips, HealthLabel, SelectorView, StringArray } from '../common/Shared';
import { CiliumListView, Column } from '../common/Views';

type Policy = CiliumNetworkPolicy | CiliumClusterwideNetworkPolicy;
type T = (key: string, params?: Record<string, unknown>) => string;

/** Feature chips shown in policy lists and detail headers. */
export function policyFeatureChips(features: PolicyFeatures, t: T): Feature[] {
  const chips: Feature[] = [];
  if (features.hostPolicy) chips.push({ id: 'host', label: t('Host'), icon: 'mdi:server' });
  if (features.l7) chips.push({ id: 'l7', label: 'L7', icon: 'mdi:layers-triple-outline' });
  if (features.fqdn) chips.push({ id: 'fqdn', label: 'FQDN', icon: 'mdi:web' });
  if (features.entities) chips.push({ id: 'entities', label: t('Entities'), icon: 'mdi:earth' });
  if (features.cidr) chips.push({ id: 'cidr', label: 'CIDR', icon: 'mdi:ip-network-outline' });
  if (features.icmp) chips.push({ id: 'icmp', label: 'ICMP', icon: 'mdi:access-point' });
  if (features.auth) {
    chips.push({ id: 'auth', label: t('Mutual auth'), icon: 'mdi:account-lock-outline' });
  }
  if (features.ingressDenyRules + features.egressDenyRules > 0) {
    chips.push({ id: 'deny', label: t('Deny'), icon: 'mdi:cancel', color: 'error' });
  }
  return chips;
}

function ruleCount(allow: number, deny: number, t: T): string {
  if (allow === 0 && deny === 0) return '-';
  return [allow ? t('{{n}} allow', { n: allow }) : '', deny ? t('{{n}} deny', { n: deny }) : '']
    .filter(Boolean)
    .join(' · ');
}

function subjectSortValue(policy: Policy): string {
  const rule = policy.rules[0];
  return selectorToString(rule?.nodeSelector || rule?.endpointSelector);
}

function usePolicyColumns(): Array<Column<Policy>> {
  const { t } = useText();
  const endpoints = useEndpointSubjects();
  const selectedCount = (policy: Policy): number | undefined =>
    endpoints.items
      ? endpoints.items.filter(e => policySelectsSubject(policy.jsonData, e.subject)).length
      : undefined;

  return [
    {
      id: 'subject',
      label: t('Applies to'),
      render: (policy: Policy) => {
        const rule = policy.rules[0];
        if (!rule) return '-';
        const isNode = !!rule.nodeSelector;
        return (
          <>
            <SelectorView
              selector={rule.nodeSelector || rule.endpointSelector}
              emptyLabel={isNode ? t('All nodes') : t('All endpoints')}
            />
            {policy.rules.length > 1 && (
              <Typography variant="caption" color="text.secondary">
                {t('+{{n}} more rule sets', { n: policy.rules.length - 1 })}
              </Typography>
            )}
          </>
        );
      },
      getValue: subjectSortValue,
    },
    {
      id: 'ingress',
      label: t('Ingress'),
      getValue: (policy: Policy) =>
        ruleCount(policy.features.ingressRules, policy.features.ingressDenyRules, t),
    },
    {
      id: 'egress',
      label: t('Egress'),
      getValue: (policy: Policy) =>
        ruleCount(policy.features.egressRules, policy.features.egressDenyRules, t),
    },
    {
      id: 'features',
      label: t('Features'),
      render: (policy: Policy) => (
        <FeatureChips features={policyFeatureChips(policy.features, t)} />
      ),
      getValue: (policy: Policy) =>
        policyFeatureChips(policy.features, t)
          .map(f => f.label)
          .join(', '),
    },
    {
      id: 'endpoints',
      label: t('Endpoints'),
      gridTemplate: 'min-content',
      render: (policy: Policy) => {
        if (policy.features.hostPolicy && policy.rules.every(r => !!r.nodeSelector)) {
          return (
            <Tooltip title={t('Host policy: applies to nodes')}>
              <span>-</span>
            </Tooltip>
          );
        }
        const count = selectedCount(policy);
        if (count === undefined) return endpoints.error ? '?' : '…';
        return count === 0 ? (
          <Tooltip title={t('No endpoint currently matches this policy')}>
            <Typography variant="body2" color="warning.main" component="span">
              0
            </Typography>
          </Tooltip>
        ) : (
          count
        );
      },
      getValue: (policy: Policy) => selectedCount(policy) ?? -1,
    },
    {
      id: 'status',
      label: t('Status'),
      gridTemplate: 'min-content',
      render: (policy: Policy) => {
        const validity = policy.validity;
        return (
          <HealthLabel
            health={validity.health}
            label={t(validity.label)}
            tooltip={validity.message}
          />
        );
      },
      getValue: (policy: Policy) => policy.validity.label,
    },
  ];
}

export function NetworkPolicyList() {
  return <CiliumListView crd={crd('CiliumNetworkPolicy')} columns={usePolicyColumns()} />;
}

export function ClusterwideNetworkPolicyList() {
  return (
    <CiliumListView crd={crd('CiliumClusterwideNetworkPolicy')} columns={usePolicyColumns()} />
  );
}

export function CIDRGroupList() {
  const { t } = useText();
  const cnps = useCiliumList<CiliumNetworkPolicy>('CiliumNetworkPolicy');
  const ccnps = useCiliumList<CiliumClusterwideNetworkPolicy>('CiliumClusterwideNetworkPolicy');
  const usage = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const policy of [...(cnps.items || []), ...(ccnps.items || [])]) {
      for (const name of referencedCIDRGroups(policy.jsonData)) {
        counts[name] = (counts[name] || 0) + 1;
      }
    }
    return counts;
  }, [cnps.items, ccnps.items]);

  return (
    <CiliumListView
      crd={crd('CiliumCIDRGroup')}
      columns={[
        {
          id: 'count',
          label: t('CIDRs'),
          gridTemplate: 'min-content',
          getValue: (group: CiliumCIDRGroup) => group.cidrs.length,
        },
        {
          id: 'cidrs',
          label: t('External CIDRs'),
          render: (group: CiliumCIDRGroup) => <StringArray items={group.cidrs} max={5} monospace />,
          getValue: (group: CiliumCIDRGroup) => group.cidrs.join(', '),
        },
        {
          id: 'usedBy',
          label: t('Used by policies'),
          gridTemplate: 'min-content',
          getValue: (group: CiliumCIDRGroup) => usage[group.metadata.name] || 0,
        },
      ]}
    />
  );
}
