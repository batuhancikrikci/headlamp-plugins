import { PolicyObject, PolicyObjectInterface } from './base';
import { PolicyTargetSpec } from './types';

export interface RateLimitRule {
  clientSelectors?: Array<{
    headers?: Array<{ name: string; value?: string; type?: string; invert?: boolean }>;
    sourceCIDR?: { type?: string; value?: string };
  }>;
  limit: { requests: number; unit: 'Second' | 'Minute' | 'Hour' | 'Day' | string };
  shared?: boolean;
}

export interface BackendTrafficPolicySpec extends PolicyTargetSpec {
  rateLimit?: {
    type?: 'Local' | 'Global' | string;
    global?: { rules?: RateLimitRule[] };
    local?: { rules?: RateLimitRule[] };
  };
  loadBalancer?: {
    type?: 'RoundRobin' | 'Random' | 'LeastRequest' | 'ConsistentHash' | string;
    consistentHash?: {
      type?: 'SourceIP' | 'Header' | 'Cookie' | string;
      header?: { name: string };
      cookie?: { name: string; ttl?: string; attributes?: Record<string, string> };
      tableSize?: number;
    };
    slowStart?: {
      window?: string;
    };
  };
  circuitBreaker?: {
    maxConnections?: number;
    maxPendingRequests?: number;
    maxParallelRequests?: number;
    maxParallelRetries?: number;
    maxRequestsPerConnection?: number;
  };
  timeout?: {
    tcp?: { connectTimeout?: string };
    http?: {
      connectionIdleTimeout?: string;
      maxConnectionDuration?: string;
      requestTimeout?: string;
    };
  };
  retry?: {
    numRetries?: number;
    retryOn?: {
      triggers?: string[];
      httpStatusCodes?: number[];
    };
    perRetry?: {
      timeout?: string;
      backOff?: {
        baseInterval?: string;
        maxInterval?: string;
      };
    };
  };
  healthCheck?: {
    active?: {
      type?: 'HTTP' | 'TCP' | 'GRPC' | string;
      timeout?: string;
      interval?: string;
      unhealthyThreshold?: number;
      healthyThreshold?: number;
      http?: { path?: string; method?: string; expectedStatuses?: number[] };
      tcp?: Record<string, unknown>;
      grpc?: { service?: string };
    };
    passive?: {
      baseEjectionTime?: string;
      interval?: string;
      maxEjectionPercent?: number;
      consecutive5XxErrors?: number;
      consecutiveGatewayErrors?: number;
      consecutiveLocalOriginFailures?: number;
      splitExternalLocalOriginErrors?: boolean;
    };
  };
  tcpKeepalive?: {
    probes?: number;
    idleTime?: string;
    interval?: string;
  };
  faultInjection?: {
    delay?: { fixedDelay?: string; percentage?: number };
    abort?: { httpStatus?: number; grpcStatus?: number; percentage?: number };
  };
  compression?: Array<{
    type: string;
  }>;
  useClientProtocol?: boolean;
  proxyProtocol?: { version?: string };
}

export interface BackendTrafficPolicyInterface extends PolicyObjectInterface {
  spec?: BackendTrafficPolicySpec;
}

/** Feature keys that can be summarized in list views. */
export const BTP_FEATURES = [
  'rateLimit',
  'loadBalancer',
  'circuitBreaker',
  'retry',
  'timeout',
  'healthCheck',
  'faultInjection',
  'compression',
] as const;

export type BTPFeature = (typeof BTP_FEATURES)[number];

export class BackendTrafficPolicy extends PolicyObject<BackendTrafficPolicyInterface> {
  static kind = 'BackendTrafficPolicy';
  static apiName = 'backendtrafficpolicies';

  static get detailsRoute() {
    return 'eg-backendtrafficpolicy-detail';
  }

  get features(): BTPFeature[] {
    return BTP_FEATURES.filter(f => !!this.spec[f]);
  }

  get loadBalancerType(): string {
    return this.spec.loadBalancer?.type || '-';
  }
}
