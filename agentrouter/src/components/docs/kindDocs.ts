/**
 * Short introductions and upstream documentation links for the kinds this plugin edits.
 * Paths follow the upstream site (site/docs in theagentrouter/agent-router v1.1.0).
 */
import type { KindDoc } from '../../common/docs/kindDocs';

const DOCS = 'https://aigateway.envoyproxy.io/docs';

export const KIND_DOCS: Record<string, KindDoc> = {
  AIGatewayRoute: {
    summary:
      'Routes LLM requests from Gateways to Service Backends or a single InferencePool per rule. Rules usually match the model name (x-ai-eg-model header); backends of a rule share traffic by weight and fall back by priority.',
    url: `${DOCS}/capabilities/traffic/`,
  },
  AIServiceBackend: {
    summary:
      'An AI provider endpoint: the API schema the provider speaks (OpenAI, Anthropic, AWSBedrock, …) and the Envoy Gateway Backend that points at it. Credentials come from a BackendSecurityPolicy that targets it.',
    url: `${DOCS}/capabilities/llm-integrations/connect-providers`,
  },
  BackendSecurityPolicy: {
    summary:
      'Upstream credentials the gateway injects when calling a provider (API key, AWS, Azure or GCP credentials). Only one policy may target a given Service Backend.',
    url: `${DOCS}/capabilities/security/upstream-auth`,
  },
  MCPRoute: {
    summary:
      'Exposes several MCP servers as one MCP endpoint on a Gateway. Tools can be filtered per server, upstream API keys injected and clients required to use OAuth.',
    url: `${DOCS}/capabilities/mcp/`,
  },
  QuotaPolicy: {
    summary:
      'Token budgets per model for Service Backends (sliding windows of 1s/1m/1h/1d), optionally per client via header bucket rules. perModelQuotas[].modelName must equal the modelNameOverride of the AI Route backend; serviceQuota is not enforced yet. Needs Envoy Gateway rate limiting with Redis.',
    url: `${DOCS}/capabilities/traffic/quota-policy`,
  },
  GatewayConfig: {
    summary:
      'Gateway-level settings for the external processor (image, resources, environment), global LLM cost metrics and an optional egress forward proxy. Gateways select it with the aigateway.envoyproxy.io/gateway-config annotation.',
    url: `${DOCS}/capabilities/gateway-config`,
  },
};
