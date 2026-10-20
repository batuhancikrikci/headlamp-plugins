/**
 * Pure builders/validators for backend credentials (Secret + BackendSecurityPolicy).
 * Kept free of Headlamp runtime imports so it can be unit tested.
 */
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import type {
  BackendSecurityPolicyInterface,
  BackendSecurityPolicyType,
} from '../../resources/backendSecurityPolicy';
import { AI_GATEWAY_GROUP } from '../../resources/common';
import { AI_SERVICE_BACKEND_KIND } from '../../utils/crossReference';
import { prune, validateName } from '../../utils/forms';
import { SECRET_KEYS } from '../aiServiceBackend/providerPresets';

export const POLICY_TYPE_LABELS: Record<BackendSecurityPolicyType, string> = {
  APIKey: 'API Key (Bearer token)',
  AnthropicAPIKey: 'Anthropic API Key (x-api-key)',
  AzureAPIKey: 'Azure API Key (api-key header)',
  AWSCredentials: 'AWS Credentials (SigV4)',
  AzureCredentials: 'Azure Entra ID (client credentials)',
  GCPCredentials: 'GCP Service Account',
};

export interface CredentialState {
  type: BackendSecurityPolicyType;
  secretMode: 'new' | 'existing';
  secretName: string;
  apiKey: string;
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsProfile: string;
  azureClientId: string;
  azureTenantId: string;
  gcpProject: string;
  gcpRegion: string;
  /** Holds the new secret value for Azure client secret / GCP service account JSON. */
  secretValue: string;
}

export function initialCredentialState(
  type: BackendSecurityPolicyType,
  secretName: string
): CredentialState {
  return {
    type,
    secretMode: 'new',
    secretName,
    apiKey: '',
    awsRegion: 'us-east-1',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsProfile: '',
    azureClientId: '',
    azureTenantId: '',
    gcpProject: '',
    gcpRegion: 'us-central1',
    secretValue: '',
  };
}

export function isAPIKeyType(t: BackendSecurityPolicyType) {
  return t === 'APIKey' || t === 'AnthropicAPIKey' || t === 'AzureAPIKey';
}

/** Validation errors for the credential form. */
export function credentialErrors(s: CredentialState): string[] {
  const errors: string[] = [];
  const nameErr = validateName(s.secretName, 'Secret name');
  if (nameErr) errors.push(nameErr);
  const creatingSecret = s.secretMode === 'new';

  if (isAPIKeyType(s.type) && creatingSecret && !s.apiKey) errors.push('API key is required.');
  if (s.type === 'AWSCredentials') {
    if (!s.awsRegion) errors.push('AWS region is required.');
    if (creatingSecret && (!s.awsAccessKeyId || !s.awsSecretAccessKey)) {
      errors.push('AWS access key ID and secret access key are required.');
    }
  }
  if (s.type === 'AzureCredentials') {
    if (!s.azureClientId || !s.azureTenantId)
      errors.push('Azure client ID and tenant ID are required.');
    if (creatingSecret && !s.secretValue) errors.push('Azure client secret is required.');
  }
  if (s.type === 'GCPCredentials') {
    if (!s.gcpProject || !s.gcpRegion) errors.push('GCP project and region are required.');
    if (creatingSecret) {
      try {
        JSON.parse(s.secretValue);
      } catch {
        errors.push('Service account key must be valid JSON.');
      }
    }
  }
  return errors;
}

/** Builds the (optional) Secret and the BackendSecurityPolicy for the given credential state. */
export function buildCredentialResources(
  s: CredentialState,
  opts: {
    policyName: string;
    namespace: string;
    targetBackends: string[];
    /** Served BackendSecurityPolicy apiVersion (from version discovery). */
    apiVersion: string;
  }
): KubeObjectInterface[] {
  const { policyName, namespace, targetBackends, apiVersion } = opts;
  const secretRef = { name: s.secretName, namespace };
  const result: KubeObjectInterface[] = [];

  if (s.secretMode === 'new') {
    let stringData: Record<string, string> = {};
    if (isAPIKeyType(s.type)) stringData = { [SECRET_KEYS.apiKey]: s.apiKey };
    if (s.type === 'AWSCredentials') {
      const profile = s.awsProfile || 'default';
      stringData = {
        [SECRET_KEYS.awsCredentials]: `[${profile}]\naws_access_key_id = ${s.awsAccessKeyId}\naws_secret_access_key = ${s.awsSecretAccessKey}\n`,
      };
    }
    if (s.type === 'AzureCredentials')
      stringData = { [SECRET_KEYS.azureClientSecret]: s.secretValue };
    if (s.type === 'GCPCredentials')
      stringData = { [SECRET_KEYS.gcpServiceAccount]: s.secretValue };
    result.push({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: s.secretName, namespace },
      type: 'Opaque',
      stringData,
    } as unknown as KubeObjectInterface);
  }

  const spec: BackendSecurityPolicyInterface['spec'] = {
    type: s.type,
    targetRefs: targetBackends.map(name => ({
      group: AI_GATEWAY_GROUP,
      kind: AI_SERVICE_BACKEND_KIND,
      name,
    })),
  };
  switch (s.type) {
    case 'APIKey':
      spec.apiKey = { secretRef };
      break;
    case 'AnthropicAPIKey':
      spec.anthropicAPIKey = { secretRef };
      break;
    case 'AzureAPIKey':
      spec.azureAPIKey = { secretRef };
      break;
    case 'AWSCredentials':
      spec.awsCredentials = {
        region: s.awsRegion,
        credentialsFile: { secretRef, profile: s.awsProfile || undefined },
      };
      break;
    case 'AzureCredentials':
      spec.azureCredentials = {
        clientID: s.azureClientId,
        tenantID: s.azureTenantId,
        clientSecretRef: secretRef,
      };
      break;
    case 'GCPCredentials':
      spec.gcpCredentials = {
        projectName: s.gcpProject,
        region: s.gcpRegion,
        credentialsFile: { secretRef },
      };
      break;
  }

  result.push(
    prune({
      apiVersion,
      kind: 'BackendSecurityPolicy',
      metadata: { name: policyName, namespace },
      spec,
    }) as KubeObjectInterface
  );
  return result;
}

export function expectedSecretKey(t: BackendSecurityPolicyType): string {
  if (isAPIKeyType(t)) return SECRET_KEYS.apiKey;
  if (t === 'AWSCredentials') return SECRET_KEYS.awsCredentials;
  if (t === 'AzureCredentials') return SECRET_KEYS.azureClientSecret;
  return SECRET_KEYS.gcpServiceAccount;
}
