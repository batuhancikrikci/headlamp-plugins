/**
 * Shared TypeScript types used across all Envoy AI Gateway CRD resources.
 */

/** API group served by all AI Gateway CRDs. */
export const AI_GATEWAY_GROUP = 'aigateway.envoyproxy.io';

/**
 * Gateway API Inference Extension InferencePool — the only non-AIServiceBackend kind an
 * AIGatewayRoute rule may reference (upstream CEL validation on AIGatewayRouteRuleBackendRef).
 */
export const INFERENCE_POOL_GROUP = 'inference.networking.k8s.io';
export const INFERENCE_POOL_KIND = 'InferencePool';

/** Header the gateway populates with the requested model name; rules match on it. */
export const AI_MODEL_HEADER = 'x-ai-eg-model';

/** Standard Kubernetes-style condition. */
export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

/** Common status block used by all AI Gateway CRDs. */
export interface CRDStatus {
  conditions?: Condition[];
}

/** Gateway API BackendObjectReference. */
export interface BackendObjectReference {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
  port?: number;
}

/** Gateway API ParentReference. */
export interface ParentReference {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
  sectionName?: string;
  port?: number;
}

/** Gateway API LocalPolicyTargetReference. */
export interface LocalPolicyTargetReference {
  group: string;
  kind: string;
  name: string;
}

/** API schema specification for AI backends. */
export interface VersionedAPISchema {
  name: APISchemaName;
  version?: string;
  prefix?: string;
}

/** Supported API schema names. */
export type APISchemaName =
  | 'OpenAI'
  | 'Cohere'
  | 'AWSBedrock'
  | 'AzureOpenAI'
  | 'GCPVertexAI'
  | 'GCPAnthropic'
  | 'Anthropic'
  | 'AWSAnthropic';

/** All API schema names accepted by the CRD enum, in display order. */
export const API_SCHEMA_NAMES: APISchemaName[] = [
  'OpenAI',
  'Anthropic',
  'AWSBedrock',
  'AWSAnthropic',
  'AzureOpenAI',
  'GCPVertexAI',
  'GCPAnthropic',
  'Cohere',
];

/** Gateway API SecretObjectReference. */
export interface SecretObjectReference {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
}

/** HTTP header match for routing. */
export interface HTTPHeaderMatch {
  type?: 'Exact' | 'RegularExpression';
  name: string;
  value?: string;
}

/** HTTP header mutation. */
export interface HTTPHeaderMutation {
  set?: Array<{ name: string; value: string }>;
  remove?: string[];
}

/** HTTP body field mutation. */
export interface HTTPBodyMutation {
  set?: Array<{ path: string; value: string }>;
  remove?: string[];
}

/** LLM request cost configuration. */
export interface LLMRequestCost {
  metadataKey: string;
  type: LLMRequestCostType;
  cel?: string;
}

/** All LLM request cost types accepted by the CRD enum. */
export const LLM_REQUEST_COST_TYPES: LLMRequestCostType[] = [
  'InputToken',
  'CachedInputToken',
  'CacheCreationInputToken',
  'OutputToken',
  'TotalToken',
  'ReasoningToken',
  'CEL',
];

/** LLM request cost type enum. */
export type LLMRequestCostType =
  | 'InputToken'
  | 'CachedInputToken'
  | 'CacheCreationInputToken'
  | 'OutputToken'
  | 'TotalToken'
  | 'ReasoningToken'
  | 'CEL';
