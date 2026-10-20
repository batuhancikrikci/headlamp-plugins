import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { ConditionSummary, summarizeStatus } from '../utils/conditions';
import { resolveTargetRefs } from '../utils/targets';
import {
  DEFAULT_API_VERSION,
  PolicyCondition,
  PolicyStatus,
  PolicyTargetSpec,
  TargetRef,
  TargetSelector,
} from './types';

export interface EnvoyGatewayObjectInterface extends KubeObjectInterface {
  spec?: object;
  status?: PolicyStatus;
}

/**
 * Base class for every Envoy Gateway CRD.
 *
 * `apiVersion` is intentionally mutable: the served version is discovered per cluster at runtime
 * (see utils/versionDiscovery.ts) and written here before any request is made.
 */
export class EnvoyGatewayObject<
  T extends EnvoyGatewayObjectInterface = EnvoyGatewayObjectInterface
> extends KubeObject<T> {
  static apiVersion: string | string[] = DEFAULT_API_VERSION;
  static isNamespaced = true;

  get spec(): NonNullable<T['spec']> {
    return (this.jsonData.spec || {}) as NonNullable<T['spec']>;
  }

  get status(): PolicyStatus | undefined {
    return this.jsonData.status;
  }

  /** Conditions reported directly on the object and on every policy ancestor. */
  get conditions(): PolicyCondition[] {
    return this.status?.conditions || [];
  }

  get statusSummary(): ConditionSummary {
    return summarizeStatus(this.status);
  }
}

export interface PolicyObjectInterface extends EnvoyGatewayObjectInterface {
  spec?: PolicyTargetSpec;
}

/** Base class for policy-attachment CRDs (targetRef / targetRefs / targetSelectors). */
export class PolicyObject<
  T extends PolicyObjectInterface = PolicyObjectInterface
> extends EnvoyGatewayObject<T> {
  get targetRefs(): TargetRef[] {
    return resolveTargetRefs(this.jsonData.spec);
  }

  get targetSelectors(): TargetSelector[] {
    return this.jsonData.spec?.targetSelectors || [];
  }
}
