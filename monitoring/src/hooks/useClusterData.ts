import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useState } from 'react';
import { MONITORING_GROUP } from '../resources/crds';
import { Labels } from '../types';

/** namespace name -> labels, or null when namespaces cannot be listed (RBAC). */
export function useNamespaceLabels(): Record<string, Labels> | null {
  const [namespaces, error] = K8s.ResourceClasses.Namespace.useList();
  return useMemo(() => {
    if (error || !namespaces) return null;
    const map: Record<string, Labels> = {};
    for (const ns of namespaces) {
      map[ns.metadata.name] = ns.metadata.labels || {};
    }
    return map;
  }, [namespaces, error]);
}

// ---------------------------------------------------------------------------
// CRD availability (per cluster, cached for the session)
// ---------------------------------------------------------------------------

const availabilityCache = new Map<string, Set<string>>();
const pending = new Map<string, Promise<Set<string>>>();
const listeners = new Set<() => void>();
/** cluster -> served group versions, e.g. ["monitoring.coreos.com/v1", ...]. */
const versionsCache = new Map<string, string[]>();

const statusOf = (err: unknown) => (err as { status?: number })?.status;

/**
 * Detects the served monitoring.coreos.com resources of a cluster.
 *
 * Only a definitive answer is returned: the group exists (its resources are
 * listed) or the API server answers 404 for the group (not installed). Any
 * other failure (401/403 while the web session is still being set up, network
 * errors, timeouts...) rejects, so it is never cached as "not installed".
 */
async function detect(cluster: string): Promise<Set<string>> {
  let group: { versions?: Array<{ groupVersion: string }> };
  try {
    group = await ApiProxy.request(`/apis/${MONITORING_GROUP}`, { cluster });
  } catch (err) {
    if (statusOf(err) === 404) {
      versionsCache.set(cluster, []);
      return new Set();
    }
    throw err;
  }
  const found = new Set<string>();
  const versions = (group?.versions || []).map(v => v.groupVersion).sort();
  await Promise.all(
    versions.map(async gv => {
      try {
        const res = await ApiProxy.request(`/apis/${gv}`, { cluster });
        for (const r of res?.resources || []) {
          if (!String(r.name).includes('/')) found.add(r.name);
        }
      } catch (err) {
        // A listed version that 404s is simply not served; anything else is transient.
        if (statusOf(err) !== 404) throw err;
      }
    })
  );
  versionsCache.set(cluster, versions);
  return found;
}

/** Served monitoring.coreos.com group versions for a cluster (empty until detected). */
export function getServedVersions(cluster: string | null): string[] {
  return (cluster && versionsCache.get(cluster)) || [];
}

/** Returns the cached set of served monitoring.coreos.com plurals for a cluster (if known). */
export function getCachedCrdAvailability(cluster: string | null): Set<string> | undefined {
  return cluster ? availabilityCache.get(cluster) : undefined;
}

/**
 * Resolves with the served resources once known. Rejects on transient errors;
 * the failed attempt is not cached, so the next call retries.
 */
export function ensureCrdAvailability(cluster: string | null): Promise<Set<string>> {
  if (!cluster) return Promise.reject(new Error('No cluster selected'));
  const cached = availabilityCache.get(cluster);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(cluster);
  if (!p) {
    p = detect(cluster)
      .then(set => {
        availabilityCache.set(cluster, set);
        listeners.forEach(l => l());
        return set;
      })
      .finally(() => pending.delete(cluster));
    pending.set(cluster, p);
  }
  return p;
}

const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * Served monitoring.coreos.com resources (plural names); null while unknown
 * (detecting, or retrying after a transient error such as an auth race right
 * after login in web Headlamp).
 */
export function useCrdAvailability(): Set<string> | null {
  const cluster = K8s.useCluster();
  const [value, setValue] = useState<Set<string> | null>(getCachedCrdAvailability(cluster) || null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setValue(getCachedCrdAvailability(cluster) || null);
    const attempt = (n: number) => {
      ensureCrdAvailability(cluster)
        .then(set => {
          if (!cancelled) setValue(set);
        })
        .catch(() => {
          if (cancelled || !cluster) return;
          const delay = RETRY_DELAYS_MS[Math.min(n, RETRY_DELAYS_MS.length - 1)];
          timer = window.setTimeout(() => attempt(n + 1), delay);
        });
    };
    attempt(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cluster]);
  return value;
}

export function onCrdAvailabilityChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
