import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { CiliumObjectInterface, Condition } from './types';

/**
 * Base class for every Cilium CRD.
 *
 * `apiVersion` is intentionally mutable: the served version is discovered per cluster at runtime
 * (see api/discovery.ts) and written here before any request is made.
 */
export class CiliumObject<
  T extends CiliumObjectInterface = CiliumObjectInterface
> extends KubeObject<T> {
  static apiVersion: string | string[] = 'cilium.io/v2';
  static isNamespaced = false;

  get spec(): NonNullable<T['spec']> {
    return (this.jsonData.spec || {}) as NonNullable<T['spec']>;
  }

  get status(): NonNullable<T['status']> {
    return (this.jsonData.status || {}) as NonNullable<T['status']>;
  }

  /** Conditions reported by the Cilium operator or agent, if the kind has any. */
  get conditions(): Condition[] {
    return (this.jsonData.status as { conditions?: Condition[] } | undefined)?.conditions || [];
  }
}

/** Static side of a Cilium resource class as used by the registry and the generic views. */
export type CiliumClass = typeof CiliumObject & {
  kind: string;
  apiName: string;
  detailsRoute: string;
};
