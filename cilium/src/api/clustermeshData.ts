/**
 * Reads what the Cluster Mesh views need from a cluster through Headlamp's API proxy. Any of the
 * clusters configured in Headlamp can be read, which the connect wizard uses for the remote side.
 * Secrets are never read.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import {
  imageVersion,
  isPodReady,
  K8S_APP_SELECTOR,
  OPERATOR_SELECTOR,
  PodJson,
  summarizeInstall,
} from './ciliumInstall';
import {
  APISERVER_SELECTOR,
  APISERVER_SERVICE,
  apiserverAddress,
  ClusterFacts,
  DaemonSetJson,
  globalServicePatch,
  GlobalServiceSettings,
  ServiceJson,
} from './clustermesh';

function params(cluster?: string) {
  return cluster ? { cluster } : {};
}

function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status;
}

/** GET that yields undefined for a missing object and rethrows other errors. */
async function getOptional<T>(path: string, cluster?: string): Promise<T | undefined> {
  try {
    return (await ApiProxy.request(path, params(cluster))) as T;
  } catch (err) {
    if (errorStatus(err) === 404) return undefined;
    throw err;
  }
}

async function list<T>(path: string, cluster?: string): Promise<T[]> {
  const result = (await ApiProxy.request(path, params(cluster))) as { items?: T[] };
  return result?.items || [];
}

/** What a cluster's own resources tell about its Cluster Mesh. */
export interface MeshState {
  namespace?: string;
  version?: string;
  config?: Record<string, string>;
  apiserverPods: PodJson[];
  /** The clustermesh-apiserver runs KVStoreMesh (a "kvstoremesh" container). */
  kvstoremesh: boolean;
  apiserverService?: ServiceJson;
  /** users.yaml of the clustermesh-remote-users ConfigMap, when it exists. */
  remoteUsersYaml?: string;
  agentDaemonSet?: DaemonSetJson;
  podCidrs: string[];
}

interface ConfigMapJson {
  data?: Record<string, string>;
}

interface CiliumNodeJson {
  spec?: { ipam?: { podCIDRs?: string[] } };
}

/** Reads the Cluster Mesh state of a cluster (the current one when `cluster` is omitted). */
export async function loadMeshState(cluster?: string): Promise<MeshState> {
  const selector = (s: string) => `/api/v1/pods?labelSelector=${encodeURIComponent(s)}`;
  const [apps, operators, apiserverPods] = await Promise.all([
    list<PodJson>(selector(K8S_APP_SELECTOR), cluster),
    list<PodJson>(selector(OPERATOR_SELECTOR), cluster).catch(() => []),
    list<PodJson>(selector(APISERVER_SELECTOR), cluster).catch(() => []),
  ]);
  const install = summarizeInstall([...apps, ...operators]);
  const namespace = install.namespace || apiserverPods[0]?.metadata.namespace;
  if (!namespace) return { apiserverPods, kvstoremesh: false, podCidrs: [] };
  const ns = encodeURIComponent(namespace);
  const [config, service, users, daemonSets, nodes] = await Promise.all([
    getOptional<ConfigMapJson>(`/api/v1/namespaces/${ns}/configmaps/cilium-config`, cluster).catch(
      () => undefined
    ),
    getOptional<ServiceJson>(
      `/api/v1/namespaces/${ns}/services/${APISERVER_SERVICE}`,
      cluster
    ).catch(() => undefined),
    getOptional<ConfigMapJson>(
      `/api/v1/namespaces/${ns}/configmaps/clustermesh-remote-users`,
      cluster
    ).catch(() => undefined),
    list<DaemonSetJson & { metadata?: { name?: string } }>(
      `/apis/apps/v1/namespaces/${ns}/daemonsets?labelSelector=${encodeURIComponent(
        'k8s-app=cilium'
      )}`,
      cluster
    ).catch(() => []),
    list<CiliumNodeJson>('/apis/cilium.io/v2/ciliumnodes', cluster).catch(() => []),
  ]);
  const podCidrs = Array.from(new Set(nodes.flatMap(n => n.spec?.ipam?.podCIDRs || [])));
  return {
    namespace,
    version: install.version,
    config: config?.data,
    apiserverPods,
    kvstoremesh: apiserverPods.some(p =>
      (p.spec?.containers || []).some(c => c.name === 'kvstoremesh')
    ),
    apiserverService: service,
    remoteUsersYaml: users?.data?.['users.yaml'],
    agentDaemonSet: daemonSets[0],
    podCidrs,
  };
}

/** The facts the connect wizard compares, from a loaded state. */
export function factsOf(cluster: string, state: MeshState): ClusterFacts {
  return {
    cluster,
    config: state.config,
    version: state.version,
    podCidrs: state.podCidrs,
    apiserver: state.apiserverService ? apiserverAddress(state.apiserverService) : undefined,
    apiserverReady:
      state.apiserverPods.length === 0 ? undefined : state.apiserverPods.some(isPodReady),
  };
}

/** Version of the clustermesh-apiserver image, e.g. "v1.20.4". */
export function apiserverVersion(state: MeshState): string | undefined {
  const container = state.apiserverPods[0]?.spec?.containers?.find(c => c.name === 'apiserver');
  return imageVersion(container?.image);
}

/** Writes the Cluster Mesh annotations of a Service (merge patch). */
export async function saveGlobalService(
  service: { name: string; namespace: string },
  settings: GlobalServiceSettings,
  cluster?: string
): Promise<void> {
  await ApiProxy.patch(
    `/api/v1/namespaces/${encodeURIComponent(service.namespace)}/services/${encodeURIComponent(
      service.name
    )}`,
    globalServicePatch(settings),
    true,
    params(cluster)
  );
}
