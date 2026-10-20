/**
 * Policy actions: switch between inform and enforce, and enable / disable. Replicated copies are
 * managed by the propagator, so only root policies get actions.
 */
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import {
  disabledPatch,
  isReplicatedPolicy,
  PolicyJson,
  remediationOf,
  remediationPatch,
} from '../../resources/models/policy';
import { ActionButton } from '../common/ActionButton';

export function PolicyActions({ item }: { item: KubeObject }) {
  const { t } = useText();
  const policy = item.jsonData as PolicyJson;
  if (isReplicatedPolicy(policy)) return null;
  const name = policy.metadata.name;
  const enforcing = remediationOf(policy) === 'enforce';
  const disabled = !!policy.spec?.disabled;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
      {enforcing ? (
        <ActionButton
          label={t('Switch to inform')}
          icon="mdi:eye-outline"
          authItem={item}
          authVerb="patch"
          run={() => item.patch(remediationPatch('inform'))}
          successMessage={t('Policy {{name}} now only informs', { name })}
          confirm={{
            title: t('Switch {{name}} to inform?', { name }),
            description: t(
              'The policy reports violations but no longer changes the managed clusters. This overrides the remediation of every template.'
            ),
            confirmLabel: t('Inform'),
          }}
        />
      ) : (
        <ActionButton
          label={t('Enforce')}
          icon="mdi:shield-lock-outline"
          color="warning"
          authItem={item}
          authVerb="patch"
          run={() => item.patch(remediationPatch('enforce'))}
          successMessage={t('Policy {{name}} is now enforced', { name })}
          confirm={{
            title: t('Enforce {{name}}?', { name }),
            description: t(
              'The policy controllers on every selected cluster create, change or delete objects to make them compliant (as each template describes). This overrides the remediation of every template.'
            ),
            confirmLabel: t('Enforce'),
          }}
        />
      )}
      {disabled ? (
        <ActionButton
          label={t('Enable policy')}
          icon="mdi:play-circle-outline"
          color="success"
          authItem={item}
          authVerb="patch"
          run={() => item.patch(disabledPatch(false))}
          successMessage={t('Policy {{name}} enabled', { name })}
        />
      ) : (
        <ActionButton
          label={t('Disable policy')}
          icon="mdi:pause-circle-outline"
          authItem={item}
          authVerb="patch"
          run={() => item.patch(disabledPatch(true))}
          successMessage={t('Policy {{name}} disabled', { name })}
          confirm={{
            title: t('Disable {{name}}?', { name }),
            description: t(
              'The policy is removed from the managed clusters until it is enabled again.'
            ),
            confirmLabel: t('Disable'),
          }}
        />
      )}
    </Box>
  );
}
