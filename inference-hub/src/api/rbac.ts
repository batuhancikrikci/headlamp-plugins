/**
 * Permission checks with SelfSubjectAccessReview, cached per cluster for a minute.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { clusterParams } from './paths';

export interface AccessCheck {
  verb: 'get' | 'list' | 'watch' | 'create' | 'update' | 'patch' | 'delete';
  /** API group ('' for core). */
  group: string;
  resource: string;
  subresource?: string;
  namespace?: string;
  name?: string;
}

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

const TTL_MS = 60000;
const cache = new Map<string, { at: number; promise: Promise<AccessResult> }>();

export function accessKey(cluster: string, check: AccessCheck): string {
  return [
    cluster,
    check.verb,
    check.group,
    check.resource,
    check.subresource || '',
    check.namespace || '',
    check.name || '',
  ].join('|');
}

export function checkAccess(cluster: string, check: AccessCheck): Promise<AccessResult> {
  const key = accessKey(cluster, check);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const body = {
    apiVersion: 'authorization.k8s.io/v1',
    kind: 'SelfSubjectAccessReview',
    spec: { resourceAttributes: { ...check } },
  };
  const promise = (
    ApiProxy.request(
      '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
      clusterParams(cluster, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ) as Promise<{ status?: { allowed?: boolean; reason?: string } }>
  )
    .then(res => ({ allowed: !!res?.status?.allowed, reason: res?.status?.reason }))
    // When the review itself fails, let the API server decide on the real request.
    .catch(() => ({ allowed: true, reason: 'Permission check unavailable' }));
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
