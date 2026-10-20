/**
 * Edit support for BackendSecurityPolicy: maps an existing object onto the form and back
 * without losing what the form cannot express. Pure, unit tested.
 *
 * Kept as is:
 * - targetRefs that are not AIServiceBackends (e.g. InferencePool),
 * - credentialOverride and any unknown field,
 * - fields inside the credential block the form does not manage (e.g. a secretRef namespace),
 * - the whole credential block when it uses OIDC token exchange / workload identity
 *   federation (the form only edits secret-based credentials).
 */
import type {
  BackendSecurityPolicyInterface,
  BackendSecurityPolicyType,
} from '../../resources/backendSecurityPolicy';
import { AI_SERVICE_BACKEND_KIND } from '../../utils/crossReference';
import { CredentialState, initialCredentialState } from './credentialResources';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Spec key holding the credential block for each type. */
type SpecKey = keyof NonNullable<BackendSecurityPolicyInterface['spec']>;

export const CREDENTIAL_BLOCK: Record<BackendSecurityPolicyType, SpecKey> = {
  APIKey: 'apiKey',
  AnthropicAPIKey: 'anthropicAPIKey',
  AzureAPIKey: 'azureAPIKey',
  AWSCredentials: 'awsCredentials',
  AzureCredentials: 'azureCredentials',
  GCPCredentials: 'gcpCredentials',
};

export interface BSPEditState {
  targets: string[];
  /** targetRefs the form does not manage (kept verbatim). */
  otherTargets: Json[];
  cred: CredentialState;
  /** True when the credential block uses federation and is kept read-only. */
  credentialLocked: boolean;
}

function secretNameOf(type: BackendSecurityPolicyType, block: Json): string {
  switch (type) {
    case 'AWSCredentials':
    case 'GCPCredentials':
      return block.credentialsFile?.secretRef?.name || '';
    case 'AzureCredentials':
      return block.clientSecretRef?.name || '';
    default:
      return block.secretRef?.name || '';
  }
}

/** Pre-fills the edit form from an existing BackendSecurityPolicy. */
export function formFromBSP(json: Json): BSPEditState {
  const spec: Json = json.spec || {};
  const type: BackendSecurityPolicyType = spec.type || 'APIKey';
  const block: Json = spec[CREDENTIAL_BLOCK[type]] || {};
  const refs: Json[] = spec.targetRefs || [];
  const credentialLocked = !!(block.oidcExchangeToken || block.workloadIdentityFederationConfig);
  const cred: CredentialState = {
    ...initialCredentialState(type, secretNameOf(type, block)),
    secretMode: 'existing',
    awsRegion: block.region || (type === 'AWSCredentials' ? '' : 'us-east-1'),
    awsProfile: block.credentialsFile?.profile || '',
    azureClientId: block.clientID || '',
    azureTenantId: block.tenantID || '',
    gcpProject: block.projectName || '',
    gcpRegion: block.region || (type === 'GCPCredentials' ? '' : 'us-central1'),
  };
  return {
    targets: refs.filter(r => r.kind === AI_SERVICE_BACKEND_KIND).map(r => r.name),
    otherTargets: refs.filter(r => r.kind !== AI_SERVICE_BACKEND_KIND),
    cred,
    credentialLocked,
  };
}

function withName(ref: Json | undefined, name: string): Json {
  return { ...(ref || {}), name };
}

/** Credential block for the form state, layered over the original block of the same type. */
function credentialBlock(
  cred: CredentialState,
  original: Json | undefined,
  namespace: string
): Json {
  const base: Json = JSON.parse(JSON.stringify(original || {}));
  // A new block gets an explicit namespace like the create wizard; an existing one keeps its own.
  const ref = (existing: Json | undefined) =>
    existing ? withName(existing, cred.secretName) : { name: cred.secretName, namespace };
  switch (cred.type) {
    case 'AWSCredentials': {
      const file: Json = { ...(base.credentialsFile || {}) };
      file.secretRef = ref(file.secretRef);
      if (cred.awsProfile) file.profile = cred.awsProfile;
      else delete file.profile;
      return { ...base, region: cred.awsRegion, credentialsFile: file };
    }
    case 'AzureCredentials':
      return {
        ...base,
        clientID: cred.azureClientId,
        tenantID: cred.azureTenantId,
        clientSecretRef: ref(base.clientSecretRef),
      };
    case 'GCPCredentials':
      return {
        ...base,
        projectName: cred.gcpProject,
        region: cred.gcpRegion,
        credentialsFile: {
          ...(base.credentialsFile || {}),
          secretRef: ref(base.credentialsFile?.secretRef),
        },
      };
    default:
      return { ...base, secretRef: ref(base.secretRef) };
  }
}

/** Applies the edit form onto the original spec (see the module comment for what is kept). */
export function mergeBSPSpec(
  original: Json | undefined,
  state: BSPEditState,
  namespace: string
): Json {
  const spec: Json = JSON.parse(JSON.stringify(original || {}));
  const originalRefs: Json[] = spec.targetRefs || [];
  const managed = state.targets.map(
    name =>
      originalRefs.find(r => r.kind === AI_SERVICE_BACKEND_KIND && r.name === name) || {
        group: 'aigateway.envoyproxy.io',
        kind: AI_SERVICE_BACKEND_KIND,
        name,
      }
  );
  const targetRefs = [...managed, ...state.otherTargets];
  if (targetRefs.length > 0) spec.targetRefs = targetRefs;
  else delete spec.targetRefs;

  if (state.credentialLocked) return spec;

  const previousType: BackendSecurityPolicyType | undefined = spec.type;
  const key = CREDENTIAL_BLOCK[state.cred.type];
  const originalBlock = previousType === state.cred.type ? spec[key] : undefined;
  Object.values(CREDENTIAL_BLOCK).forEach(k => delete spec[k]);
  spec.type = state.cred.type;
  spec[key] = credentialBlock(state.cred, originalBlock, namespace);
  return spec;
}
