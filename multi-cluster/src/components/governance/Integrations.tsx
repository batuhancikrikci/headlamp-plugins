/**
 * Governance on the managed cluster page: the policy copies the propagator created in the
 * cluster namespace, with their compliance.
 */
import { Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { useOcmList } from '../../hooks/useOcmList';
import {
  compliance,
  isReplicatedPolicy,
  latestMessages,
  PolicyJson,
  rootPolicyOf,
} from '../../resources/models/policy';
import { RelatedTable } from '../common/Related';
import { ResourceRefLink } from '../common/ResourceRefLink';
import { ComplianceLabel } from './Views';

export function ClusterPoliciesSection({ cluster }: { cluster: string }) {
  const { t } = useText();
  const policies = useOcmList<PolicyJson>('Policy', { namespace: cluster });
  if (policies.missing) return null;
  const rows = policies.items ? policies.items.filter(isReplicatedPolicy) : null;
  return (
    <RelatedTable
      title={t('Policies')}
      items={rows}
      error={policies.error}
      what={t('policies')}
      emptyMessage={t('No policy is placed on this cluster.')}
      columns={[
        {
          label: t('Policy'),
          getter: (p: PolicyJson) => {
            const root = rootPolicyOf(p);
            return root ? (
              <ResourceRefLink
                kind="Policy"
                name={root.name}
                namespace={root.namespace}
                qualified
              />
            ) : (
              p.metadata.name
            );
          },
        },
        {
          label: t('Compliance'),
          getter: (p: PolicyJson) => <ComplianceLabel value={compliance(p)} />,
        },
        { label: t('Remediation'), getter: (p: PolicyJson) => p.spec?.remediationAction || '-' },
        {
          label: t('Latest message'),
          getter: (p: PolicyJson) => (
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {latestMessages(p)
                .map(m => m.message)
                .filter(Boolean)
                .join(' · ') || '-'}
            </Typography>
          ),
        },
        {
          label: t('Cluster copy'),
          getter: (p: PolicyJson) => (
            <ResourceRefLink
              kind="Policy"
              name={p.metadata.name}
              namespace={p.metadata.namespace}
            />
          ),
        },
      ]}
    />
  );
}
