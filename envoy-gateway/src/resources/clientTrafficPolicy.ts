import { PolicyObject, PolicyObjectInterface } from './base';
import { ObjectRef, PolicyTargetSpec } from './types';

export interface ClientTrafficPolicySpec extends PolicyTargetSpec {
  tcpKeepalive?: {
    probes?: number;
    idleTime?: string;
    interval?: string;
  };
  enableProxyProtocol?: boolean;
  clientIPDetection?: {
    xForwardedFor?: {
      numTrustedHops?: number;
    };
    customHeader?: {
      name?: string;
      failClosed?: boolean;
    };
  };
  tls?: {
    minVersion?: string;
    maxVersion?: string;
    ciphers?: string[];
    ecdhCurves?: string[];
    signatureAlgorithms?: string[];
    alpnProtocols?: string[];
    clientValidation?: {
      caCertificateRefs?: ObjectRef[];
      optional?: boolean;
    };
  };
  http1?: {
    enableTrailers?: boolean;
    preserveHeaderCase?: boolean;
    http10?: {
      useDefaultHost?: boolean;
    };
  };
  http2?: {
    initialStreamWindowSize?: string;
    initialConnectionWindowSize?: string;
    maxConcurrentStreams?: number;
  };
  http3?: Record<string, unknown>;
  headers?: {
    enableEnvoyHeaders?: boolean;
    disableRateLimitHeaders?: boolean;
    xForwardedClientCert?: {
      mode?: string;
      certDetailsToAdd?: string[];
    };
    withUnderscoresAction?: string;
    preserveXRequestID?: boolean;
  };
  timeout?: {
    http?: {
      requestReceivedTimeout?: string;
      idleTimeout?: string;
    };
  };
  connection?: {
    connectionLimit?: {
      value?: number;
      closeDelay?: string;
    };
    bufferLimit?: string;
  };
  path?: {
    escapedSlashesAction?: string;
    disableMergeSlashes?: boolean;
  };
  healthCheck?: {
    path?: string;
  };
}

export interface ClientTrafficPolicyInterface extends PolicyObjectInterface {
  spec?: ClientTrafficPolicySpec;
}

export class ClientTrafficPolicy extends PolicyObject<ClientTrafficPolicyInterface> {
  static kind = 'ClientTrafficPolicy';
  static apiName = 'clienttrafficpolicies';

  static get detailsRoute() {
    return 'eg-clienttrafficpolicy-detail';
  }

  get hasTLS(): boolean {
    return !!this.spec.tls;
  }

  get hasProxyProtocol(): boolean {
    return !!this.spec.enableProxyProtocol;
  }

  get httpVersions(): string[] {
    const versions: string[] = [];
    if (this.spec.http1) versions.push('HTTP/1.1');
    if (this.spec.http2) versions.push('HTTP/2');
    if (this.spec.http3) versions.push('HTTP/3');
    return versions;
  }
}
