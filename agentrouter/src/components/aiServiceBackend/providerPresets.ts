import { BackendSecurityPolicyType } from '../../resources/backendSecurityPolicy';
import { APISchemaName } from '../../resources/common';

/**
 * Provider presets for the Service Backend wizard.
 * Hostnames, schema versions and policy types follow the upstream examples
 * (theagentrouter/agent-router v1.1.0, examples/basic).
 */
export interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  schema: APISchemaName;
  schemaVersion?: string;
  hostname: string;
  hostnameHelp?: string;
  port: number;
  tls: boolean;
  policyType?: BackendSecurityPolicyType;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'api.openai.com with an API key',
    schema: 'OpenAI',
    hostname: 'api.openai.com',
    port: 443,
    tls: true,
    policyType: 'APIKey',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'api.anthropic.com with an Anthropic API key',
    schema: 'Anthropic',
    hostname: 'api.anthropic.com',
    port: 443,
    tls: true,
    policyType: 'AnthropicAPIKey',
  },
  {
    id: 'aws-bedrock',
    label: 'AWS Bedrock',
    description: 'Bedrock runtime (Converse API) with AWS credentials',
    schema: 'AWSBedrock',
    hostname: 'bedrock-runtime.us-east-1.amazonaws.com',
    hostnameHelp: 'bedrock-runtime.<region>.amazonaws.com',
    port: 443,
    tls: true,
    policyType: 'AWSCredentials',
  },
  {
    id: 'aws-anthropic',
    label: 'Anthropic on AWS Bedrock',
    description: 'Claude models through Bedrock using the native Anthropic API',
    schema: 'AWSAnthropic',
    schemaVersion: 'bedrock-2023-05-31',
    hostname: 'bedrock-runtime.us-east-1.amazonaws.com',
    hostnameHelp: 'bedrock-runtime.<region>.amazonaws.com',
    port: 443,
    tls: true,
    policyType: 'AWSCredentials',
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    description: 'Azure OpenAI resource with an API key or Entra ID credentials',
    schema: 'AzureOpenAI',
    schemaVersion: '2025-01-01-preview',
    hostname: '',
    hostnameHelp: '<resource-name>.openai.azure.com',
    port: 443,
    tls: true,
    policyType: 'AzureAPIKey',
  },
  {
    id: 'gcp-vertex',
    label: 'GCP Vertex AI',
    description: 'Gemini models on Vertex AI with a service account',
    schema: 'GCPVertexAI',
    hostname: 'us-central1-aiplatform.googleapis.com',
    hostnameHelp: '<region>-aiplatform.googleapis.com',
    port: 443,
    tls: true,
    policyType: 'GCPCredentials',
  },
  {
    id: 'gcp-anthropic',
    label: 'Anthropic on GCP Vertex AI',
    description: 'Claude models on Vertex AI with a service account',
    schema: 'GCPAnthropic',
    schemaVersion: 'vertex-2023-10-16',
    hostname: 'us-east5-aiplatform.googleapis.com',
    hostnameHelp: '<region>-aiplatform.googleapis.com',
    port: 443,
    tls: true,
    policyType: 'GCPCredentials',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    description: 'api.cohere.com with an API key',
    schema: 'Cohere',
    hostname: 'api.cohere.com',
    port: 443,
    tls: true,
    policyType: 'APIKey',
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (self-hosted)',
    description: 'vLLM, Ollama, TGI or any OpenAI-compatible endpoint',
    schema: 'OpenAI',
    hostname: '',
    hostnameHelp: 'e.g. vllm.inference.svc.cluster.local',
    port: 8000,
    tls: false,
  },
];

/** Secret data key the controller reads for each credential type (see upstream controller). */
export const SECRET_KEYS = {
  apiKey: 'apiKey',
  awsCredentials: 'credentials',
  azureClientSecret: 'client-secret',
  gcpServiceAccount: 'service_account.json',
} as const;
