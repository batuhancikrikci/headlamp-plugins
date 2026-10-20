import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useState } from 'react';
import { Alertmanager, Prometheus } from '../resources/crds';
import { getClusterSettings, updateClusterSettings, useMonitoringSettings } from '../settings';
import {
  findInstanceService,
  InstanceKind,
  parseServiceOverride,
  ServiceEndpoint,
  ServiceJSON,
  serviceProxyBase,
} from '../utils/discovery';
import { instanceKey } from '../utils/keys';

export interface MonitoringEndpoint<T> {
  /** Service proxy base URL (…/proxy[/prefix]); empty when unavailable. */
  baseUrl: string;
  endpoint: ServiceEndpoint | null;
  /** The selected custom resource (null when only a manual override is used). */
  instance: T | null;
  instances: T[];
  select: (namespacedName: string) => void;
  source: 'auto' | 'override' | 'none';
  loading: boolean;
  /** Error listing CRs or services (RBAC etc). */
  error: unknown;
  /** The CRD is not installed or no instance exists and no override is set. */
  notFound: boolean;
}

/** Services of one namespace (null while loading or when ns is undefined). */
export function useNamespaceServices(ns: string | undefined, cluster: string | null) {
  const [services, setServices] = useState<ServiceJSON[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    setServices(null);
    setError(null);
    if (!ns) return;
    ApiProxy.request(`/api/v1/namespaces/${encodeURIComponent(ns)}/services`)
      .then((res: { items?: ServiceJSON[] }) => {
        if (!cancelled) setServices(res?.items || []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [ns, cluster]);
  return { services, error };
}

/** Resolves the proxy base URL for a specific Prometheus/Alertmanager object. */
export function useInstanceBaseUrl(
  kind: InstanceKind,
  instance: { metadata: { name: string; namespace?: string }; spec?: object } | null
) {
  const cluster = K8s.useCluster();
  const { services, error } = useNamespaceServices(instance?.metadata.namespace, cluster);
  const endpoint = useMemo(
    () => (instance && services ? findInstanceService(kind, instance, services) : null),
    [instance, services, kind]
  );
  return {
    endpoint,
    baseUrl: endpoint ? serviceProxyBase(endpoint) : '',
    loading: !!instance && services === null && !error,
    error,
  };
}

const keyOf = instanceKey;

/** Deterministic default: kube-prometheus-stack instance first, then by namespace/name. */
function sortInstances<
  T extends { metadata: { name: string; namespace?: string; labels?: Record<string, string> } }
>(items: T[]): T[] {
  const score = (o: T) =>
    o.metadata.labels?.['app.kubernetes.io/part-of'] === 'kube-prometheus-stack' ||
    o.metadata.labels?.release
      ? 0
      : 1;
  return [...items].sort((a, b) => score(a) - score(b) || keyOf(a).localeCompare(keyOf(b)));
}

function useInstanceEndpoint<C extends typeof Prometheus | typeof Alertmanager>(
  kind: InstanceKind,
  cls: C
): MonitoringEndpoint<InstanceType<C>> {
  const cluster = K8s.useCluster();
  const settings = useMonitoringSettings();
  const clusterSettings = getClusterSettings(settings, cluster);
  const selectedKey =
    kind === 'Prometheus' ? clusterSettings.prometheus : clusterSettings.alertmanager;
  const override = parseServiceOverride(
    kind === 'Prometheus'
      ? clusterSettings.prometheusOverride
      : clusterSettings.alertmanagerOverride
  );

  const [items, listError] = (cls as typeof Prometheus).useList() as unknown as [
    InstanceType<C>[] | null,
    { status?: number } | null
  ];
  const instances = useMemo(() => sortInstances(items || []), [items]);
  const instance = useMemo(
    () => instances.find(i => keyOf(i) === selectedKey) || instances[0] || null,
    [instances, selectedKey]
  );

  const ns = instance?.metadata.namespace;
  const { services, error: serviceError } = useNamespaceServices(
    override ? undefined : ns,
    cluster
  );

  const endpoint = useMemo<ServiceEndpoint | null>(() => {
    if (override) return override;
    if (!instance || !services) return null;
    const json = instance.jsonData as {
      metadata: { name: string; namespace?: string };
      spec?: object;
    };
    return findInstanceService(kind, json, services);
  }, [override, instance, services, kind]);

  const listLoading = items === null && !listError;
  const serviceLoading = !override && !!instance && services === null && !serviceError;
  const crdMissing = (listError as { status?: number } | null)?.status === 404;

  return {
    baseUrl: endpoint ? serviceProxyBase(endpoint) : '',
    endpoint,
    instance,
    instances,
    select: (value: string) =>
      updateClusterSettings(
        cluster,
        kind === 'Prometheus' ? { prometheus: value } : { alertmanager: value }
      ),
    source: override ? 'override' : endpoint ? 'auto' : 'none',
    loading: !override && (listLoading || serviceLoading),
    error: override ? null : crdMissing ? null : listError || serviceError,
    notFound:
      !override &&
      !listLoading &&
      (crdMissing || instances.length === 0 || (!!services && !endpoint && !serviceLoading)),
  };
}

export function usePrometheusEndpoint() {
  return useInstanceEndpoint('Prometheus', Prometheus);
}

export function useAlertmanagerEndpoint() {
  return useInstanceEndpoint('Alertmanager', Alertmanager);
}

export { instanceKey };
