import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Condition, CRDStatus, LocalPolicyTargetReference, SecretObjectReference } from './common';

/** Supported backend security policy types. */
export type BackendSecurityPolicyType =
  | 'APIKey'
  | 'AWSCredentials'
  | 'AzureAPIKey'
  | 'AzureCredentials'
  | 'GCPCredentials'
  | 'AnthropicAPIKey';

/** All policy types accepted by the CRD enum, in display order. */
export const BACKEND_SECURITY_POLICY_TYPES: BackendSecurityPolicyType[] = [
  'APIKey',
  'AnthropicAPIKey',
  'AWSCredentials',
  'AzureAPIKey',
  'AzureCredentials',
  'GCPCredentials',
];

/** OIDC token exchange configuration (Envoy Gateway OIDC spec kept opaque). */
export interface BackendSecurityPolicyOIDC {
  oidc: Record<string, unknown>;
  grantType?: string;
  aud?: string;
}

/** Per-request credential override configuration. */
export interface BackendSecurityPolicyCredentialOverride {
  fromRequestHeaders?: {
    header?: string;
    fallbackToConfigured?: boolean;
  };
  fromDynamicMetadata?: {
    namespace: string;
    key?: string;
    fallbackToConfigured?: boolean;
  };
}

export interface BackendSecurityPolicyInterface extends KubeObjectInterface {
  spec?: {
    targetRefs?: LocalPolicyTargetReference[];
    type: BackendSecurityPolicyType;
    apiKey?: {
      secretRef?: SecretObjectReference;
    };
    awsCredentials?: {
      region: string;
      credentialsFile?: {
        secretRef?: SecretObjectReference;
        profile?: string;
      };
      oidcExchangeToken?: BackendSecurityPolicyOIDC & { awsRoleArn: string };
    };
    azureAPIKey?: {
      secretRef?: SecretObjectReference;
    };
    azureCredentials?: {
      clientID: string;
      tenantID: string;
      clientSecretRef?: SecretObjectReference;
      oidcExchangeToken?: BackendSecurityPolicyOIDC;
    };
    gcpCredentials?: {
      projectName: string;
      region: string;
      credentialsFile?: {
        secretRef?: SecretObjectReference;
      };
      workloadIdentityFederationConfig?: {
        projectID: string;
        workloadIdentityProviderName: string;
        workloadIdentityPoolName: string;
        oidcExchangeToken: BackendSecurityPolicyOIDC;
        serviceAccountImpersonation?: { serviceAccountName: string };
      };
    };
    anthropicAPIKey?: {
      secretRef?: SecretObjectReference;
    };
    credentialOverride?: BackendSecurityPolicyCredentialOverride;
  };
  status?: CRDStatus;
}

export class BackendSecurityPolicy extends KubeObject<BackendSecurityPolicyInterface> {
  static kind = 'BackendSecurityPolicy';
  static apiName = 'backendsecuritypolicies';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'Security Policies Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get policyType(): BackendSecurityPolicyType | string {
    return this.spec?.type || '-';
  }

  get targetRefNames(): string[] {
    return (this.spec?.targetRefs || []).map(r => `${r.kind}/${r.name}`);
  }

  get targetRefs(): LocalPolicyTargetReference[] {
    return this.spec?.targetRefs || [];
  }

  /** Get a human-readable description of the credential source. */
  get credentialSummary(): string {
    const s = this.spec;
    if (!s) return '-';
    switch (s.type) {
      case 'APIKey':
        return s.apiKey?.secretRef?.name ? `Secret: ${s.apiKey.secretRef.name}` : 'API Key';
      case 'AWSCredentials':
        return `AWS (${s.awsCredentials?.region || 'no region'})`;
      case 'AzureAPIKey':
        return s.azureAPIKey?.secretRef?.name
          ? `Secret: ${s.azureAPIKey.secretRef.name}`
          : 'Azure API Key';
      case 'AzureCredentials':
        return `Azure (Client: ${s.azureCredentials?.clientID || '-'})`;
      case 'GCPCredentials':
        return `GCP (${s.gcpCredentials?.projectName || '-'}, ${s.gcpCredentials?.region || '-'})`;
      case 'AnthropicAPIKey':
        return s.anthropicAPIKey?.secretRef?.name
          ? `Secret: ${s.anthropicAPIKey.secretRef.name}`
          : 'Anthropic API Key';
      default:
        return s.type;
    }
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }
}
