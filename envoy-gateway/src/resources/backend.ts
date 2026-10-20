import { EnvoyGatewayObject, EnvoyGatewayObjectInterface } from './base';

export interface BackendEndpoint {
  fqdn?: {
    hostname: string;
    port: number;
  };
  ip?: {
    address: string;
    port: number;
  };
  unix?: {
    path: string;
  };
}

export interface BackendInterface extends EnvoyGatewayObjectInterface {
  spec?: {
    endpoints?: BackendEndpoint[];
    appProtocols?: string[];
    fallback?: boolean;
    tls?: {
      caCertificateRefs?: Array<{ group?: string; kind?: string; name: string }>;
      sni?: string;
      insecureSkipVerify?: boolean;
    };
  };
}

export type EndpointType = 'FQDN' | 'IP' | 'Unix';

export function endpointType(ep: BackendEndpoint): EndpointType | undefined {
  if (ep.fqdn) return 'FQDN';
  if (ep.ip) return 'IP';
  if (ep.unix) return 'Unix';
  return undefined;
}

export function endpointAddress(ep: BackendEndpoint): string {
  if (ep.fqdn) return `${ep.fqdn.hostname}:${ep.fqdn.port}`;
  if (ep.ip) return `${ep.ip.address}:${ep.ip.port}`;
  if (ep.unix) return ep.unix.path;
  return '-';
}

export class Backend extends EnvoyGatewayObject<BackendInterface> {
  static kind = 'Backend';
  static apiName = 'backends';

  static get detailsRoute() {
    return 'eg-backend-detail';
  }

  get endpointCount(): number {
    return this.spec.endpoints?.length || 0;
  }

  get endpointTypes(): EndpointType[] {
    const types = new Set<EndpointType>();
    for (const ep of this.spec.endpoints || []) {
      const t = endpointType(ep);
      if (t) types.add(t);
    }
    return Array.from(types);
  }
}
