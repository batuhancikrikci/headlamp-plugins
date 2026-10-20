import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  BackendObjectReference,
  Condition,
  CRDStatus,
  HTTPHeaderMatch,
  ParentReference,
  SecretObjectReference,
} from './common';

/** MCP tool filtering config. */
export interface MCPToolFilter {
  include?: string[];
  includeRegex?: string[];
  exclude?: string[];
  excludeRegex?: string[];
}

/** MCP header forwarding config. */
export interface MCPHeaderForward {
  name: string;
  backendHeader?: string;
}

/** MCP backend security policy. */
export interface MCPBackendSecurityPolicy {
  apiKey?: {
    secretRef?: SecretObjectReference;
    inline?: string;
    header?: string;
    queryParam?: string;
  };
}

/** MCP backend reference. */
export interface MCPRouteBackendRef extends BackendObjectReference {
  path?: string;
  toolSelector?: MCPToolFilter;
  securityPolicy?: MCPBackendSecurityPolicy;
  forwardHeaders?: MCPHeaderForward[];
}

/** MCP route security policy (OAuth, API key, etc.). */
export interface MCPRouteSecurityPolicy {
  oauth?: {
    issuer: string;
    audiences?: string[];
    jwks?: {
      remoteJWKS?: { uri: string } & Record<string, unknown>;
      localJWKS?: Record<string, unknown>;
    };
    protectedResourceMetadata: {
      resource: string;
      resourceName?: string;
      scopesSupported?: string[];
      resourceSigningAlgValuesSupported?: string[];
      resourceDocumentation?: string;
      resourcePolicyUri?: string;
    };
    claimToHeaders?: Array<{ claim: string; header: string }>;
  };
  apiKeyAuth?: Record<string, unknown>;
  extAuth?: Record<string, unknown>;
  authorization?: {
    defaultAction?: string;
    rules?: Array<{
      source?: {
        jwt: {
          scopes?: string[];
          claims?: Array<{ name: string; valueType?: string; values: string[] }>;
        };
      };
      target?: { tools: Array<{ backend: string; tool: string }> };
      cel?: string;
      action?: string;
    }>;
  };
}

export interface MCPRouteInterface extends KubeObjectInterface {
  spec?: {
    parentRefs?: ParentReference[];
    path?: string;
    headers?: HTTPHeaderMatch[];
    hostnames?: string[];
    backendRefs?: MCPRouteBackendRef[];
    securityPolicy?: MCPRouteSecurityPolicy;
    backendSelector?: {
      defaultAction?: string;
      rules?: Array<{
        cel?: string;
        action?: string;
      }>;
    };
  };
  status?: CRDStatus;
}

export class MCPRoute extends KubeObject<MCPRouteInterface> {
  static kind = 'MCPRoute';
  static apiName = 'mcproutes';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'MCP Routes Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get path(): string {
    return this.spec?.path || '/mcp';
  }

  get backendCount(): number {
    return this.spec?.backendRefs?.length || 0;
  }

  get backendNames(): string[] {
    return (this.spec?.backendRefs || []).map(r => r.name);
  }

  get parentRefNames(): string[] {
    return (this.spec?.parentRefs || []).map(r => r.name);
  }

  get hostnames(): string[] {
    return this.spec?.hostnames || [];
  }

  get hasSecurityPolicy(): boolean {
    const sp = this.spec?.securityPolicy;
    return !!sp && (!!sp.oauth || !!sp.apiKeyAuth || !!sp.extAuth || !!sp.authorization);
  }

  get hasBackendSelector(): boolean {
    return !!this.spec?.backendSelector;
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }
}
