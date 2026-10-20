/** Kubernetes API path builders. */
import { ResourceDefinition } from '../resources/definitions';
import { ResourceLocation } from './discovery';

export interface ListOptions {
  /** Namespace to list; omit (or '') for all namespaces. Ignored for cluster-scoped kinds. */
  namespace?: string;
  labelSelector?: string;
  fieldSelector?: string;
}

function query(opts: ListOptions): string {
  const params = new URLSearchParams();
  if (opts.labelSelector) params.set('labelSelector', opts.labelSelector);
  if (opts.fieldSelector) params.set('fieldSelector', opts.fieldSelector);
  const q = params.toString();
  return q ? `?${q}` : '';
}

function nsSegment(namespaced: boolean, namespace?: string): string {
  return namespaced && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : '';
}

/** Path of a custom resource collection at a discovered location. */
export function customListPath(
  def: ResourceDefinition,
  location: ResourceLocation,
  opts: ListOptions = {}
): string {
  return `/apis/${location.apiVersion}${nsSegment(def.namespaced, opts.namespace)}/${
    def.plural
  }${query(opts)}`;
}

/** Path of a single custom resource. */
export function customItemPath(
  def: ResourceDefinition,
  location: ResourceLocation,
  name: string,
  namespace?: string
): string {
  return `/apis/${location.apiVersion}${nsSegment(def.namespaced, namespace)}/${
    def.plural
  }/${encodeURIComponent(name)}`;
}

/** Path of a built-in collection, e.g. coreListPath('v1', 'pods') or ('apps/v1', 'deployments'). */
export function coreListPath(
  apiVersion: string,
  plural: string,
  namespaced: boolean,
  opts: ListOptions = {}
): string {
  const base = apiVersion === 'v1' ? '/api/v1' : `/apis/${apiVersion}`;
  return `${base}${nsSegment(namespaced, opts.namespace)}/${plural}${query(opts)}`;
}

/** Kubernetes API server service proxy path. `scheme` is only added for https. */
export function serviceProxyPath(
  namespace: string,
  service: string,
  port: number | string,
  scheme: 'http' | 'https' = 'http'
): string {
  const target = `${scheme === 'https' ? 'https:' : ''}${service}:${port}`;
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${target}/proxy`;
}

/** Kubernetes API server pod proxy path. */
export function podProxyPath(
  namespace: string,
  pod: string,
  port: number | string,
  scheme: 'http' | 'https' = 'http'
): string {
  const target = `${scheme === 'https' ? 'https:' : ''}${pod}:${port}`;
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${target}/proxy`;
}

/**
 * Request params for ApiProxy targeting a cluster. The key is omitted for '' because an
 * explicit `cluster: undefined` would override the cluster of the current route.
 */
export function clusterParams<T extends object>(
  cluster: string,
  extra?: T
): T & { cluster?: string } {
  return { ...(extra || ({} as T)), ...(cluster ? { cluster } : {}) };
}
