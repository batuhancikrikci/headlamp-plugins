/**
 * Resource classes built at runtime for cilium.io kinds this plugin has no dedicated views for
 * (for example CRDs introduced by a newer Cilium release). They get a generic list and detail
 * page under Advanced.
 */
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { ServedResource } from '../api/discovery';
import { GENERIC_DETAIL_ROUTE } from '../routes';
import { CiliumClass, CiliumObject } from './base';

/** Placeholder for the namespace segment of cluster-scoped objects in the generic detail URL. */
export const CLUSTER_SCOPE_SEGMENT = '-';

const cache = new Map<string, CiliumClass>();

export function genericClass(resource: ServedResource): CiliumClass {
  const key = `${resource.plural}@${resource.versions[0]}`;
  const cached = cache.get(key);
  if (cached) return cached;

  class GenericCiliumObject extends CiliumObject {
    static kind = resource.kind;
    static apiName = resource.plural;
    static apiVersion: string | string[] = resource.versions[0];
    static isNamespaced = resource.namespaced;

    static get detailsRoute() {
      return GENERIC_DETAIL_ROUTE;
    }

    // The generic detail route needs the resource plural, which the default link lacks.
    getDetailsLink(): string {
      return Router.createRouteURL(GENERIC_DETAIL_ROUTE, {
        plural: resource.plural,
        namespace: this.getNamespace() || CLUSTER_SCOPE_SEGMENT,
        name: this.getName(),
      });
    }
  }

  const cls = GenericCiliumObject as CiliumClass;
  cache.set(key, cls);
  return cls;
}
