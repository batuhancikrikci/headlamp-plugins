import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { extractModelRoutes, ModelRoute } from './aiGatewayRoute.models';
import {
  Condition,
  CRDStatus,
  HTTPBodyMutation,
  HTTPHeaderMatch,
  HTTPHeaderMutation,
  LLMRequestCost,
  ParentReference,
} from './common';

export type { ModelRoute };
export { extractModelRoutes };

/** Backend reference in a route rule. */
export interface AIGatewayRouteRuleBackendRef {
  name: string;
  namespace?: string;
  group?: string;
  kind?: string;
  modelNameOverride?: string;
  headerMutation?: HTTPHeaderMutation;
  bodyMutation?: HTTPBodyMutation;
  weight?: number;
  priority?: number;
}

/** Route rule match (headers). */
export interface AIGatewayRouteRuleMatch {
  headers?: HTTPHeaderMatch[];
}

/** A single routing rule. */
export interface AIGatewayRouteRule {
  name?: string;
  backendRefs?: AIGatewayRouteRuleBackendRef[];
  matches?: AIGatewayRouteRuleMatch[];
  timeouts?: {
    request?: string;
    backendRequest?: string;
  };
  streamIdleTimeout?: string;
  modelsOwnedBy?: string;
  modelsCreatedAt?: string;
}

export interface AIGatewayRouteInterface extends KubeObjectInterface {
  spec?: {
    parentRefs?: ParentReference[];
    hostnames?: string[];
    rules?: AIGatewayRouteRule[];
    llmRequestCosts?: LLMRequestCost[];
  };
  status?: CRDStatus;
}

export class AIGatewayRoute extends KubeObject<AIGatewayRouteInterface> {
  static kind = 'AIGatewayRoute';
  static apiName = 'aigatewayroutes';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'AI Routes Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get ruleCount(): number {
    return this.spec?.rules?.length || 0;
  }

  get hostnames(): string[] {
    return this.spec?.hostnames || [];
  }

  /** Get unique backend names referenced by all rules. */
  get backendNames(): string[] {
    const names = new Set<string>();
    for (const rule of this.spec?.rules || []) {
      for (const ref of rule.backendRefs || []) {
        names.add(ref.name);
      }
    }
    return Array.from(names);
  }

  /** Model names this route matches on, paired with the backendRefs of the matching rule. */
  get modelRoutes(): ModelRoute[] {
    return extractModelRoutes(this.spec?.rules);
  }

  get modelNames(): string[] {
    return Array.from(new Set(this.modelRoutes.map(m => m.model)));
  }

  get parentRefNames(): string[] {
    return (this.spec?.parentRefs || []).map(r => r.name);
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }

  get costCount(): number {
    return this.spec?.llmRequestCosts?.length || 0;
  }
}
