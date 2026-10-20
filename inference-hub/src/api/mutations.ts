/**
 * Create, update and delete through the Kubernetes API, using discovered API paths.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { RESOURCE_LIST } from '../resources/definitions';
import { KubeJson } from '../resources/types';
import { refreshMatching, toApiError } from './liveStore';
import { clusterParams } from './paths';

/** Built-in kinds Inference Hub may create next to its custom resources. */
const CORE_KINDS: Record<string, { plural: string; namespaced: boolean }> = {
  Secret: { plural: 'secrets', namespaced: true },
  ConfigMap: { plural: 'configmaps', namespaced: true },
  ServiceAccount: { plural: 'serviceaccounts', namespaced: true },
  PersistentVolumeClaim: { plural: 'persistentvolumeclaims', namespaced: true },
  Namespace: { plural: 'namespaces', namespaced: false },
};

export interface ObjectPaths {
  collection: string;
  item: string;
  namespaced: boolean;
}

/** API paths of an object from its apiVersion and kind. */
export function pathsFor(obj: KubeJson): ObjectPaths {
  const apiVersion = obj.apiVersion || '';
  const kind = obj.kind || '';
  const name = encodeURIComponent(obj.metadata?.name || '');
  const custom = RESOURCE_LIST.find(
    r => r.kind === kind && r.groups.includes(apiVersion.split('/')[0])
  );
  const core = CORE_KINDS[kind];
  if (!custom && !core) throw new Error(`Unsupported kind ${apiVersion} ${kind}`);
  const plural = custom ? custom.plural : core.plural;
  const namespaced = custom ? custom.namespaced : core.namespaced;
  const base = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const ns =
    namespaced && obj.metadata.namespace
      ? `/namespaces/${encodeURIComponent(obj.metadata.namespace)}`
      : '';
  if (namespaced && !obj.metadata.namespace) throw new Error('metadata.namespace is required');
  return {
    collection: `${base}${ns}/${plural}`,
    item: `${base}${ns}/${plural}/${name}`,
    namespaced,
  };
}

export interface WriteOptions {
  cluster: string;
  /** Validate on the server (admission + schema) without persisting. */
  dryRun?: boolean;
}

function withDryRun(path: string, dryRun?: boolean) {
  return dryRun ? `${path}?dryRun=All` : path;
}

async function send(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  cluster: string,
  body?: unknown
): Promise<KubeJson> {
  try {
    return await ApiProxy.request(
      path,
      clusterParams(cluster, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  } catch (err) {
    throw toApiError(err);
  }
}

function afterWrite(cluster: string, paths: ObjectPaths) {
  // Refresh the cached reads of this group version (namespaced and all-namespace lists alike).
  const groupVersion = paths.collection
    .split('/')
    .slice(0, paths.collection.startsWith('/apis/') ? 4 : 3)
    .join('/');
  refreshMatching(cluster, groupVersion).catch(() => undefined);
}

export async function createObject(obj: KubeJson, opts: WriteOptions): Promise<KubeJson> {
  const paths = pathsFor(obj);
  const result = await send('POST', withDryRun(paths.collection, opts.dryRun), opts.cluster, obj);
  if (!opts.dryRun) afterWrite(opts.cluster, paths);
  return result;
}

export async function updateObject(obj: KubeJson, opts: WriteOptions): Promise<KubeJson> {
  const paths = pathsFor(obj);
  const result = await send('PUT', withDryRun(paths.item, opts.dryRun), opts.cluster, obj);
  if (!opts.dryRun) afterWrite(opts.cluster, paths);
  return result;
}

export async function deleteObject(obj: KubeJson, opts: WriteOptions): Promise<void> {
  const paths = pathsFor(obj);
  await send('DELETE', withDryRun(paths.item, opts.dryRun), opts.cluster);
  if (!opts.dryRun) afterWrite(opts.cluster, paths);
}

/** Merge-patches metadata annotations (null removes a key). */
export async function patchAnnotations(
  obj: KubeJson,
  annotations: Record<string, string | null>,
  cluster: string
): Promise<KubeJson> {
  const paths = pathsFor(obj);
  try {
    const result = await ApiProxy.request(
      paths.item,
      clusterParams(cluster, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ metadata: { annotations } }),
      })
    );
    afterWrite(cluster, paths);
    return result;
  } catch (err) {
    throw toApiError(err);
  }
}
