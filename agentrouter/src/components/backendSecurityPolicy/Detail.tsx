import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import {
  BackendSecurityPolicy,
  BackendSecurityPolicyOIDC,
} from '../../resources/backendSecurityPolicy';
import { backendsForTargetRefs } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  ConditionsTable,
  ObjectBlock,
  RelatedResourcesSection,
  SchemaChip,
  SecretRefLabel,
  TargetRefChip,
} from '../common/SharedComponents';

type Row = { name: string; value: React.ReactNode; hide?: boolean };

function oidcRows(prefix: string, oidc?: BackendSecurityPolicyOIDC): Row[] {
  if (!oidc) return [];
  return [
    { name: `${prefix} OIDC Provider`, value: <ObjectBlock value={oidc.oidc} /> },
    { name: `${prefix} Grant Type`, value: oidc.grantType || '-', hide: !oidc.grantType },
    { name: `${prefix} Audience`, value: oidc.aud || '-', hide: !oidc.aud },
  ];
}

/** Provider-specific credential rows, depending on the policy type. */
function credentialRows(policy: BackendSecurityPolicy): Row[] {
  const s = policy.spec;
  if (!s) return [];
  switch (s.type) {
    case 'APIKey':
      return [
        { name: 'API Key Secret', value: <SecretRefLabel secretRef={s.apiKey?.secretRef} /> },
      ];
    case 'AnthropicAPIKey':
      return [
        {
          name: 'Anthropic API Key Secret',
          value: <SecretRefLabel secretRef={s.anthropicAPIKey?.secretRef} />,
        },
      ];
    case 'AzureAPIKey':
      return [
        {
          name: 'Azure API Key Secret',
          value: <SecretRefLabel secretRef={s.azureAPIKey?.secretRef} />,
        },
      ];
    case 'AWSCredentials': {
      const aws = s.awsCredentials;
      return [
        { name: 'Region', value: aws?.region || '-' },
        {
          name: 'Authentication',
          value: aws?.oidcExchangeToken ? 'OIDC token exchange' : 'Credentials file',
        },
        {
          name: 'Credentials Secret',
          value: <SecretRefLabel secretRef={aws?.credentialsFile?.secretRef} />,
          hide: !aws?.credentialsFile,
        },
        {
          name: 'Profile',
          value: aws?.credentialsFile?.profile || 'default',
          hide: !aws?.credentialsFile,
        },
        {
          name: 'Role ARN',
          value: aws?.oidcExchangeToken?.awsRoleArn || '-',
          hide: !aws?.oidcExchangeToken,
        },
        ...oidcRows('AWS', aws?.oidcExchangeToken),
      ];
    }
    case 'AzureCredentials': {
      const az = s.azureCredentials;
      return [
        { name: 'Client ID', value: az?.clientID || '-' },
        { name: 'Tenant ID', value: az?.tenantID || '-' },
        {
          name: 'Client Secret',
          value: <SecretRefLabel secretRef={az?.clientSecretRef} />,
          hide: !az?.clientSecretRef,
        },
        ...oidcRows('Azure', az?.oidcExchangeToken),
      ];
    }
    case 'GCPCredentials': {
      const gcp = s.gcpCredentials;
      const wif = gcp?.workloadIdentityFederationConfig;
      return [
        { name: 'Project', value: gcp?.projectName || '-' },
        { name: 'Region', value: gcp?.region || '-' },
        {
          name: 'Credentials Secret',
          value: <SecretRefLabel secretRef={gcp?.credentialsFile?.secretRef} />,
          hide: !gcp?.credentialsFile,
        },
        { name: 'WIF Project ID', value: wif?.projectID || '-', hide: !wif },
        { name: 'WIF Pool', value: wif?.workloadIdentityPoolName || '-', hide: !wif },
        { name: 'WIF Provider', value: wif?.workloadIdentityProviderName || '-', hide: !wif },
        {
          name: 'Impersonated Service Account',
          value: wif?.serviceAccountImpersonation?.serviceAccountName || '-',
          hide: !wif?.serviceAccountImpersonation,
        },
        ...oidcRows('GCP', wif?.oidcExchangeToken),
      ];
    }
    default:
      return [];
  }
}

export function BackendSecurityPolicyDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="Security Policy">
      <DetailsGrid
        resourceType={BackendSecurityPolicy}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            {
              name: 'Type',
              value: (
                <Chip size="small" color="primary" variant="outlined" label={item.policyType} />
              ),
            },
            {
              name: 'Targets',
              value:
                item.targetRefs.length > 0
                  ? item.targetRefs.map((ref, i) => <TargetRefChip key={i} targetRef={ref} />)
                  : '-',
            },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'credentials',
              section: (
                <SectionBox title="Credentials">
                  <NameValueTable rows={credentialRows(item)} />
                </SectionBox>
              ),
            },
            {
              id: 'credentialOverride',
              section: item.spec?.credentialOverride && (
                <SectionBox title="Credential Override">
                  <NameValueTable
                    rows={[
                      {
                        name: 'From Request Header',
                        value: item.spec.credentialOverride.fromRequestHeaders?.header || '-',
                        hide: !item.spec.credentialOverride.fromRequestHeaders,
                      },
                      {
                        name: 'From Dynamic Metadata',
                        value: item.spec.credentialOverride.fromDynamicMetadata
                          ? `${item.spec.credentialOverride.fromDynamicMetadata.namespace}/${
                              item.spec.credentialOverride.fromDynamicMetadata.key || '-'
                            }`
                          : '-',
                        hide: !item.spec.credentialOverride.fromDynamicMetadata,
                      },
                    ]}
                  />
                </SectionBox>
              ),
            },
            {
              id: 'protectedBackends',
              section: <ProtectedBackendsSection policy={item} />,
            },
            {
              id: 'conditions',
              section: (
                <SectionBox title="Conditions">
                  <ConditionsTable conditions={item.conditions} />
                </SectionBox>
              ),
            },
          ]
        }
      />
    </WithVersionDiscovery>
  );
}

function ProtectedBackendsSection({ policy }: { policy: BackendSecurityPolicy }) {
  const [backends] = AIServiceBackend.useList({ namespace: policy.metadata.namespace });
  return (
    <RelatedResourcesSection
      title="Protected Service Backends"
      items={
        backends === null
          ? null
          : backendsForTargetRefs(policy.targetRefs, policy.metadata.namespace, backends)
      }
      emptyMessage="None of the targeted Service Backends exist in this namespace."
      extraColumns={[
        {
          label: 'API Schema',
          getter: item => <SchemaChip schemaName={(item as AIServiceBackend).schemaName} />,
        },
      ]}
    />
  );
}
