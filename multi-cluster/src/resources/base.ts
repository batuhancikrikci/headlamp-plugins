import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Condition } from './models/common';

/** JSON shape shared by every object the plugin manages. */
export interface OcmObjectInterface extends KubeObjectInterface {
  spec?: object;
  status?: object;
}

/**
 * Base class of every resource class in the plugin.
 *
 * `apiVersion` is intentionally mutable: the served version is discovered per cluster at runtime
 * (see api/discovery.ts) and written here before any request is made.
 */
export class OcmObject<T extends OcmObjectInterface = OcmObjectInterface> extends KubeObject<T> {
  static apiVersion: string | string[] = '';
  static isNamespaced = false;

  get spec(): NonNullable<T['spec']> {
    return (this.jsonData.spec || {}) as NonNullable<T['spec']>;
  }

  get status(): NonNullable<T['status']> {
    return (this.jsonData.status || {}) as NonNullable<T['status']>;
  }

  get conditions(): Condition[] {
    return (this.jsonData.status as { conditions?: Condition[] } | undefined)?.conditions || [];
  }
}

/** Static side of a resource class as used by the registry and the generic views. */
export type OcmClass = typeof OcmObject & {
  kind: string;
  apiName: string;
  detailsRoute: string;
};
