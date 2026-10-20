import { EnvoyGatewayObject, EnvoyGatewayObjectInterface } from './base';
import { ObjectRef } from './types';

export interface EnvoyProxyInterface extends EnvoyGatewayObjectInterface {
  spec?: {
    provider?: {
      type?: string;
      kubernetes?: {
        envoyDeployment?: {
          replicas?: number;
          container?: {
            image?: string;
            resources?: Record<string, unknown>;
          };
          patch?: {
            type?: string;
            value?: unknown;
          };
        };
        envoyDaemonSet?: Record<string, unknown>;
        envoyService?: {
          type?: string;
          annotations?: Record<string, string>;
          externalTrafficPolicy?: string;
        };
        envoyHpa?: {
          minReplicas?: number;
          maxReplicas?: number;
        };
      };
    };
    logging?: {
      level?: Record<string, string>;
    };
    telemetry?: {
      accessLog?: {
        disable?: boolean;
        settings?: unknown[];
      };
      metrics?: {
        prometheus?: {
          disable?: boolean;
        };
        sinks?: unknown[];
      };
      tracing?: {
        samplingRate?: number;
        provider?: {
          type?: string;
          host?: string;
          port?: number;
        };
      };
    };
    bootstrap?: {
      type?: string;
      value?: string;
    };
    mergeGateways?: boolean;
    shutdown?: {
      drainTimeout?: string;
      minDrainDuration?: string;
    };
    filterOrder?: Array<{
      name: string;
      before?: string;
      after?: string;
    }>;
    backendTLS?: {
      clientCertificateRef?: ObjectRef;
    };
  };
}

export class EnvoyProxy extends EnvoyGatewayObject<EnvoyProxyInterface> {
  static kind = 'EnvoyProxy';
  static apiName = 'envoyproxies';

  static get detailsRoute() {
    return 'eg-envoyproxy-detail';
  }

  get providerType(): string {
    return this.spec.provider?.type || 'Kubernetes';
  }

  get mergeGateways(): boolean {
    return this.spec.mergeGateways ?? false;
  }

  get replicas(): number | undefined {
    return this.spec.provider?.kubernetes?.envoyDeployment?.replicas;
  }

  get serviceType(): string | undefined {
    return this.spec.provider?.kubernetes?.envoyService?.type;
  }
}
