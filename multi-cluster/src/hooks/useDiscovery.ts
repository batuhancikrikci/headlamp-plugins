import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import { CapabilityId, CapabilityState, capabilityState, CRDJson } from '../api/capabilities';
import { CAPABILITIES } from '../api/capabilities';
import {
  Availability,
  chosenApiVersion,
  discoverAvailability,
  errorStatusOf,
  fetchCRD,
  getCachedAvailability,
  invalidateAvailability,
} from '../api/discovery';
import { crd, CRDS } from '../resources/registry';

/** Name of the cluster the current view belongs to ('' when there is none). */
export function useCurrentCluster(): string {
  return K8s.useCluster() || getCluster() || '';
}

/** Writes the discovered versions to the resource classes. */
export function applyVersions(availability: Availability) {
  for (const info of CRDS) {
    const version = chosenApiVersion(availability, info);
    if (!version) continue;
    if (info.cls.apiVersion !== version) {
      info.cls.apiVersion = version;
      // Headlamp caches the endpoint built from apiVersion; rebuild it for the new version.
      info.cls._internalApiEndpoint = undefined;
    }
  }
}

export type DiscoveryState =
  | { status: 'loading' }
  | { status: 'error'; error: string; forbidden: boolean; retry: () => void }
  | { status: 'ready'; availability: Availability; refresh: () => void };

/** Discovers (and applies) the OCM API versions of the current cluster. */
export function useOcmDiscovery(): DiscoveryState {
  const cluster = useCurrentCluster();
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => setAttempt(a => a + 1), []);
  const refresh = React.useCallback(() => {
    invalidateAvailability(cluster);
    setAttempt(a => a + 1);
  }, [cluster]);

  const [state, setState] = React.useState<DiscoveryState>(() => {
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      return { status: 'ready', availability: cached, refresh };
    }
    return { status: 'loading' };
  });

  React.useEffect(() => {
    let cancelled = false;
    const cached = getCachedAvailability(cluster);
    if (cached) {
      applyVersions(cached);
      setState({ status: 'ready', availability: cached, refresh });
      return;
    }
    setState({ status: 'loading' });
    discoverAvailability(cluster)
      .then(availability => {
        if (cancelled) return;
        applyVersions(availability);
        setState({ status: 'ready', availability, refresh });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = errorStatusOf(err);
        setState({
          status: 'error',
          error: (err as Error)?.message || String(err),
          forbidden: status === 403 || status === 401,
          retry,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, attempt, retry, refresh]);

  return state;
}

/** The discovered availability, or undefined while discovery runs. */
export function useAvailability(): Availability | undefined {
  const state = useOcmDiscovery();
  return state.status === 'ready' ? state.availability : undefined;
}

export type CRDState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; crd: CRDJson | undefined };

/** The CRD object of a kind. Reading CRDs is often not permitted: state is then `unavailable`. */
export function useCRDOf(kind: string): CRDState {
  const cluster = useCurrentCluster();
  const [state, setState] = React.useState<CRDState>({ status: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchCRD(cluster, crd(kind))
      .then(result => !cancelled && setState({ status: 'ready', crd: result }))
      .catch(() => !cancelled && setState({ status: 'unavailable' }));
    return () => {
      cancelled = true;
    };
  }, [cluster, kind]);
  return state;
}

export interface CapabilityResult {
  state: CapabilityState;
  /** Minimum OCM version, for the hint when the state is unknown. */
  since: string;
  label: string;
}

/** Whether a version-dependent field is supported by the CRD version in use. */
export function useCapability(id: CapabilityId): CapabilityResult {
  const info = CAPABILITIES[id];
  const crdState = useCRDOf(info.kind);
  const availability = useAvailability();
  const apiVersion = chosenApiVersion(availability, crd(info.kind));
  const state =
    crdState.status === 'ready' ? capabilityState(id, crdState.crd, apiVersion) : 'unknown';
  return { state, since: info.since, label: info.label };
}
