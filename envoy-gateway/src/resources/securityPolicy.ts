import { PolicyObject, PolicyObjectInterface } from './base';
import { BackendRef, ObjectRef, PolicyTargetSpec } from './types';

export interface JWTProvider {
  name: string;
  issuer?: string;
  audiences?: string[];
  remoteJWKS?: {
    uri: string;
  };
  localJWKS?: {
    type?: string;
    inline?: string;
    valueRef?: ObjectRef;
  };
  claimToHeaders?: Array<{
    header: string;
    claim: string;
  }>;
  recomputeRoute?: boolean;
}

export interface ExtAuthService {
  backendRef?: BackendRef;
  backendRefs?: BackendRef[];
  path?: string;
  headersToBackend?: string[];
}

export type AuthMethod = 'jwt' | 'oidc' | 'basicAuth' | 'apiKeyAuth' | 'extAuth';

export const AUTH_METHODS: AuthMethod[] = ['jwt', 'oidc', 'basicAuth', 'apiKeyAuth', 'extAuth'];

export interface SecurityPolicyInterface extends PolicyObjectInterface {
  spec?: PolicyTargetSpec & {
    cors?: {
      allowOrigins?: string[];
      allowMethods?: string[];
      allowHeaders?: string[];
      exposeHeaders?: string[];
      maxAge?: string;
      allowCredentials?: boolean;
    };
    basicAuth?: {
      users?: ObjectRef;
      forwardUsernameHeader?: string;
    };
    apiKeyAuth?: {
      credentialRefs?: ObjectRef[];
      extractFrom?: Array<{ headers?: string[]; params?: string[]; cookies?: string[] }>;
      forwardClientIDHeader?: string;
    };
    jwt?: {
      optional?: boolean;
      providers?: JWTProvider[];
    };
    oidc?: {
      provider?: {
        issuer: string;
        authorizationEndpoint?: string;
        tokenEndpoint?: string;
      };
      clientID?: string;
      clientSecret?: ObjectRef;
      redirectURL?: string;
      logoutPath?: string;
      scopes?: string[];
      forwardAccessToken?: boolean;
    };
    extAuth?: {
      grpc?: ExtAuthService;
      http?: ExtAuthService;
      headersToExtAuth?: string[];
      failOpen?: boolean;
    };
    authorization?: {
      defaultAction?: 'Allow' | 'Deny' | string;
      rules?: Array<{
        name?: string;
        action: 'Allow' | 'Deny' | string;
        principal?: {
          clientCIDRs?: string[];
          jwt?: {
            provider?: string;
            scopes?: string[];
            claims?: Array<{ name: string; values?: string[] }>;
          };
          headers?: Array<{ name: string; values?: string[] }>;
        };
      }>;
    };
  };
}

export class SecurityPolicy extends PolicyObject<SecurityPolicyInterface> {
  static kind = 'SecurityPolicy';
  static apiName = 'securitypolicies';

  static get detailsRoute() {
    return 'eg-securitypolicy-detail';
  }

  /** Enabled authentication methods, in display order. */
  get authMethods(): AuthMethod[] {
    return AUTH_METHODS.filter(m => !!this.spec[m]);
  }

  get hasCORS(): boolean {
    return !!this.spec.cors;
  }

  get hasAuthorization(): boolean {
    return !!this.spec.authorization;
  }
}

/** ExtAuth supports both the deprecated `backendRef` and `backendRefs`. */
export function extAuthBackendRefs(s?: ExtAuthService): BackendRef[] {
  if (!s) return [];
  return [...(s.backendRef ? [s.backendRef] : []), ...(s.backendRefs || [])];
}
