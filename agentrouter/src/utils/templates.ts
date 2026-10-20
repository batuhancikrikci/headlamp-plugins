/**
 * Starting objects for "Create from YAML": valid shapes with empty names to fill in.
 * Pure, unit tested.
 */
type Spec = Record<string, unknown>;

const GATEWAY = { group: 'gateway.networking.k8s.io', kind: 'Gateway', name: '' };
const SERVICE_BACKEND_TARGET = {
  group: 'aigateway.envoyproxy.io',
  kind: 'AIServiceBackend',
  name: '',
};

const INITIAL_SPECS: Record<string, () => Spec> = {
  AIGatewayRoute: () => ({
    parentRefs: [GATEWAY],
    rules: [
      {
        matches: [{ headers: [{ type: 'Exact', name: 'x-ai-eg-model', value: '' }] }],
        backendRefs: [{ name: '' }],
      },
    ],
  }),
  AIServiceBackend: () => ({
    schema: { name: 'OpenAI' },
    backendRef: { group: 'gateway.envoyproxy.io', kind: 'Backend', name: '' },
  }),
  BackendSecurityPolicy: () => ({
    targetRefs: [SERVICE_BACKEND_TARGET],
    type: 'APIKey',
    apiKey: { secretRef: { name: '' } },
  }),
  MCPRoute: () => ({
    parentRefs: [GATEWAY],
    backendRefs: [{ group: 'gateway.envoyproxy.io', kind: 'Backend', name: '' }],
  }),
  QuotaPolicy: () => ({
    targetRefs: [SERVICE_BACKEND_TARGET],
    perModelQuotas: [{ modelName: '', quota: { defaultBucket: { limit: 10000, duration: '1h' } } }],
  }),
  GatewayConfig: () => ({
    extProc: {
      kubernetes: {
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { memory: '512Mi' } },
      },
    },
  }),
};

export function newResource(kind: string, apiVersion: string, namespace = 'default') {
  return {
    apiVersion,
    kind,
    metadata: { name: '', namespace },
    spec: INITIAL_SPECS[kind] ? INITIAL_SPECS[kind]() : {},
  };
}

export const TEMPLATE_KINDS = Object.keys(INITIAL_SPECS);
