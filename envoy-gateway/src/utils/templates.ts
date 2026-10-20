/**
 * Starting objects for the create dialogs, and the Backend Traffic Policy scenario presets used by
 * its wizard.
 */
import { GATEWAY_API_GROUP, KubeJson } from '../resources/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Spec = Record<string, any>;

const initialSpecs: Record<string, () => Spec> = {
  EnvoyProxy: () => ({
    provider: {
      type: 'Kubernetes',
      kubernetes: {
        envoyDeployment: { replicas: 2 },
        envoyService: { type: 'LoadBalancer' },
      },
    },
  }),
  ClientTrafficPolicy: () => ({
    targetRefs: [{ group: GATEWAY_API_GROUP, kind: 'Gateway', name: '' }],
  }),
  BackendTrafficPolicy: () => ({
    targetRefs: [{ group: GATEWAY_API_GROUP, kind: 'HTTPRoute', name: '' }],
  }),
  SecurityPolicy: () => ({
    targetRefs: [{ group: GATEWAY_API_GROUP, kind: 'HTTPRoute', name: '' }],
  }),
  EnvoyExtensionPolicy: () => ({
    targetRefs: [{ group: GATEWAY_API_GROUP, kind: 'HTTPRoute', name: '' }],
  }),
  EnvoyPatchPolicy: () => ({
    type: 'JSONPatch',
    targetRef: { group: GATEWAY_API_GROUP, kind: 'Gateway', name: '' },
    jsonPatches: [
      {
        type: 'type.googleapis.com/envoy.config.listener.v3.Listener',
        name: '',
        operation: { op: 'add', path: '', value: {} },
      },
    ],
  }),
  Backend: () => ({
    endpoints: [{ fqdn: { hostname: '', port: 443 } }],
  }),
  HTTPRouteFilter: () => ({
    directResponse: {
      statusCode: 200,
      contentType: 'text/plain',
      body: { type: 'Inline', inline: 'OK' },
    },
  }),
};

export function newResource(kind: string, apiVersion: string, namespace = 'default'): KubeJson {
  return {
    apiVersion,
    kind,
    metadata: { name: '', namespace },
    spec: initialSpecs[kind] ? initialSpecs[kind]() : {},
  };
}

export type BTPPresetId =
  | 'rateLimit'
  | 'resilience'
  | 'healthCheck'
  | 'stickySession'
  | 'slowStart'
  | 'faultInjection'
  | 'compression';

export interface BTPPreset {
  id: BTPPresetId;
  /** Spec keys the preset writes; used to show the matching form sections. */
  keys: string[];
  /** Presets in the same group are mutually exclusive. */
  group?: string;
  spec: () => Spec;
}

export const BTP_PRESETS: BTPPreset[] = [
  {
    id: 'rateLimit',
    keys: ['rateLimit'],
    spec: () => ({
      rateLimit: {
        type: 'Local',
        local: { rules: [{ limit: { requests: 100, unit: 'Second' } }] },
      },
    }),
  },
  {
    id: 'resilience',
    keys: ['circuitBreaker', 'retry', 'timeout'],
    spec: () => ({
      circuitBreaker: { maxConnections: 1024, maxPendingRequests: 1024, maxParallelRequests: 1024 },
      retry: {
        numRetries: 3,
        retryOn: {
          triggers: ['connect-failure', 'retriable-status-codes'],
          httpStatusCodes: [502, 503, 504],
        },
        perRetry: { timeout: '2s', backOff: { baseInterval: '100ms', maxInterval: '1s' } },
      },
      timeout: { tcp: { connectTimeout: '5s' }, http: { requestTimeout: '15s' } },
    }),
  },
  {
    id: 'healthCheck',
    keys: ['healthCheck'],
    spec: () => ({
      healthCheck: {
        active: {
          type: 'HTTP',
          interval: '10s',
          timeout: '1s',
          healthyThreshold: 1,
          unhealthyThreshold: 3,
          http: { path: '/healthz', expectedStatuses: [200] },
        },
        passive: {
          consecutive5XxErrors: 5,
          interval: '10s',
          baseEjectionTime: '30s',
          maxEjectionPercent: 50,
        },
      },
    }),
  },
  {
    id: 'stickySession',
    keys: ['loadBalancer'],
    group: 'loadBalancer',
    spec: () => ({
      loadBalancer: {
        type: 'ConsistentHash',
        consistentHash: { type: 'Cookie', cookie: { name: 'session-affinity', ttl: '1h' } },
      },
    }),
  },
  {
    id: 'slowStart',
    keys: ['loadBalancer'],
    group: 'loadBalancer',
    spec: () => ({
      loadBalancer: { type: 'RoundRobin', slowStart: { window: '30s' } },
    }),
  },
  {
    id: 'faultInjection',
    keys: ['faultInjection'],
    spec: () => ({
      faultInjection: {
        delay: { fixedDelay: '2s', percentage: 10 },
        abort: { httpStatus: 503, percentage: 5 },
      },
    }),
  },
  {
    id: 'compression',
    keys: ['compression'],
    spec: () => ({ compression: [{ type: 'Gzip' }] }),
  },
];

/**
 * Returns a new spec with the given presets toggled. Enabling a preset writes its defaults
 * (replacing other presets of the same group); disabling it removes the keys it owns.
 */
export function toggleBTPPreset(spec: Spec, id: BTPPresetId, enabled: boolean): Spec {
  const preset = BTP_PRESETS.find(p => p.id === id);
  if (!preset) return spec;
  const next: Spec = { ...spec };
  if (enabled) {
    Object.assign(next, preset.spec());
  } else {
    for (const key of preset.keys) delete next[key];
  }
  return next;
}

/** Returns the presets whose keys are all present in the spec (used to restore wizard state). */
export function activeBTPPresets(spec: Spec): BTPPresetId[] {
  return BTP_PRESETS.filter(p => {
    if (!p.keys.every(k => spec[k] !== undefined)) return false;
    if (p.id === 'stickySession') return spec.loadBalancer?.type === 'ConsistentHash';
    if (p.id === 'slowStart') return !!spec.loadBalancer?.slowStart;
    return true;
  }).map(p => p.id);
}
