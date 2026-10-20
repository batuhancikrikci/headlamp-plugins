/**
 * GitOpsCluster and ManagedServiceAccount forms.
 */
import { Alert, Box } from '@mui/material';
import React from 'react';
import { chosenApiVersion } from '../../api/discovery';
import {
  ComboInput,
  FieldGrid,
  FormSection,
  NumberInput,
  SelectInput,
  SwitchInput,
  TextInput,
  useBinder,
} from '../../common/form/Fields';
import { ResourceFormProps } from '../../common/form/ResourceEditor';
import { useText } from '../../common/i18n';
import { setIn } from '../../common/objects';
import { useAvailability } from '../../hooks/useDiscovery';
import { useNamespaceNames, useOcmList } from '../../hooks/useOcmList';
import { isAgentGitOpsCluster } from '../../resources/models/apps';
import { KubeJson } from '../../resources/models/common';
import { PlacementJson } from '../../resources/models/placement';
import { crd } from '../../resources/registry';
import { GITOPS_PLACEMENT_VERSIONS } from '../../utils/validation';
import { MetadataFields } from '../common/form/MetadataFields';

const DOCS = 'https://open-cluster-management.io/docs/scenarios/integration-with-argocd/';

/**
 * apiVersion written into GitOpsCluster placement references: the served Placement version when
 * the GitOps controller accepts it, otherwise v1beta1 (the only GA-track version it accepts).
 */
export function useGitOpsPlacementApiVersion(): string {
  const availability = useAvailability();
  const served = chosenApiVersion(availability, crd('Placement'));
  return served && GITOPS_PLACEMENT_VERSIONS.includes(served)
    ? served
    : GITOPS_PLACEMENT_VERSIONS[0];
}

/** Argo CD namespace, placement and secret options of a GitOpsCluster. */
export function GitOpsSpecSection({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const namespaces = useNamespaceNames();
  const ns = value.metadata?.namespace;
  const placements = useOcmList<PlacementJson>('Placement', { namespace: ns, enabled: !!ns });
  const apiVersion = useGitOpsPlacementApiVersion();
  const msas = useOcmList<KubeJson>('ManagedServiceAccount');
  return (
    <>
      <FormSection
        title={t('Argo CD')}
        icon="mdi:source-branch-sync"
        description={t(
          'The managed clusters selected by the placement are registered as Argo CD cluster secrets in this namespace.'
        )}
        docsUrl={DOCS}
      >
        <ComboInput
          {...bind<string>(['spec', 'argoServer', 'argoNamespace'])}
          label={t('Argo CD namespace')}
          options={namespaces}
          required
        />
      </FormSection>
      <FormSection
        title={t('Placement')}
        icon="mdi:target"
        description={t(
          'A Placement in the same namespace as this GitOpsCluster (PlacementRules are not supported by the GitOps controller).'
        )}
      >
        <SelectInput
          label={t('Placement')}
          value={value.spec?.placementRef?.name || undefined}
          onChange={name =>
            onChange(
              setIn(value, ['spec', 'placementRef'], {
                kind: 'Placement',
                apiVersion,
                name: name || '',
              })
            )
          }
          options={(placements.items || []).map(p => p.metadata.name).sort()}
          allowEmpty={false}
          required
          helperText={!ns ? t('Choose the namespace first.') : undefined}
        />
      </FormSection>
      <FormSection title={t('Cluster credentials')} icon="mdi:account-key-outline">
        <FieldGrid columns={2}>
          <ComboInput
            {...bind<string>(['spec', 'managedServiceAccountRef'])}
            label={t('Managed service account (optional)')}
            options={Array.from(new Set((msas.items || []).map(m => m.metadata.name))).sort()}
            help={t(
              'Name of a ManagedServiceAccount present in every cluster namespace; its token is used for the Argo CD cluster secret.'
            )}
          />
          <SwitchInput
            {...bind<boolean>(['spec', 'createPolicyTemplate'])}
            label={t('Create policy template')}
            help={t(
              'Creates a policy template for the managed service account permissions (requires a managed service account).'
            )}
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}

/** argocd-agent GitOpsCluster (v1alpha1): placement and agent add-on settings. */
export function AgentGitOpsSection({
  value,
  onChange,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
}) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const ns = value.metadata?.namespace;
  const placements = useOcmList<PlacementJson>('Placement', { namespace: ns, enabled: !!ns });
  return (
    <>
      <FormSection
        title={t('Placement')}
        icon="mdi:target"
        description={t(
          'The argocd-agent add-on is deployed to every cluster this placement selects. Create the GitOpsCluster in the Argo CD namespace.'
        )}
        docsUrl="https://github.com/open-cluster-management-io/argocd-pull-integration"
      >
        <SelectInput
          label={t('Placement')}
          value={value.spec?.placementRef?.name || undefined}
          onChange={name =>
            onChange(
              setIn(value, ['spec', 'placementRef'], {
                kind: 'Placement',
                apiVersion: 'cluster.open-cluster-management.io/v1beta1',
                name: name || '',
              })
            )
          }
          options={(placements.items || []).map(p => p.metadata.name).sort()}
          allowEmpty={false}
          required
        />
      </FormSection>
      <FormSection title={t('Argo CD agent')} icon="mdi:robot-outline">
        <FieldGrid columns={3}>
          <SelectInput
            {...bind<string>(['spec', 'argoCDAgentAddon', 'mode'])}
            label={t('Agent mode')}
            options={[
              { value: 'managed', description: t('Applications are managed on the hub') },
              {
                value: 'autonomous',
                description: t('Applications are defined on the managed clusters'),
              },
            ]}
            allowEmpty={false}
          />
          <TextInput
            {...bind<string>(['spec', 'argoCDAgentAddon', 'principalServerAddress'])}
            label={t('Principal server address')}
            help={t('Leave empty to discover it from the hub service.')}
          />
          <TextInput
            {...bind<string>(['spec', 'argoCDAgentAddon', 'principalServerPort'])}
            label={t('Principal server port')}
          />
          <TextInput
            {...bind<string>(['spec', 'argoCDAgentAddon', 'agentNamespace'])}
            label={t('Agent namespace (managed cluster)')}
          />
          <TextInput
            {...bind<string>(['spec', 'argoCDAgentAddon', 'operatorNamespace'])}
            label={t('Operator namespace (managed cluster)')}
          />
        </FieldGrid>
      </FormSection>
    </>
  );
}

export function GitOpsClusterForm({ value, onChange, mode }: ResourceFormProps) {
  const agent = isAgentGitOpsCluster(value);
  return (
    <Box>
      <MetadataFields value={value} onChange={onChange} mode={mode} />
      {agent ? (
        <AgentGitOpsSection value={value} onChange={onChange} />
      ) : (
        <GitOpsSpecSection value={value} onChange={onChange} />
      )}
    </Box>
  );
}

export function ManagedServiceAccountForm({ value, onChange, mode }: ResourceFormProps) {
  const { t } = useText();
  const bind = useBinder(value, onChange);
  const clusters = useOcmList<KubeJson>('ManagedCluster');
  return (
    <Box>
      <MetadataFields
        value={value}
        onChange={onChange}
        mode={mode}
        namespaceOptions={(clusters.items || []).map(c => c.metadata.name).sort()}
        namespaceHelp={t(
          'The cluster namespace: the service account is created on that managed cluster.'
        )}
      />
      <FormSection title={t('Token')} icon="mdi:key-chain-variant">
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('Requires the managed-serviceaccount add-on on the target cluster.')}
        </Alert>
        <FieldGrid columns={3}>
          <SwitchInput
            {...bind<boolean>(['spec', 'rotation', 'enabled'])}
            label={t('Rotate the token')}
            keepFalse
          />
          <TextInput
            {...bind<string>(['spec', 'rotation', 'validity'])}
            label={t('Validity')}
            placeholder="8640h0m0s"
          />
          <NumberInput
            {...bind<number>(['spec', 'ttlSecondsAfterCreation'])}
            label={t('Delete after (seconds)')}
            min={0}
          />
        </FieldGrid>
      </FormSection>
    </Box>
  );
}
