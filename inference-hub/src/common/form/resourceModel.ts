/**
 * Pure helpers of the create / update requests (see apply.ts), kept free of Headlamp imports so
 * they can be unit tested.
 */
import { KubeJson } from './types';

/** One entry of an APIResourceList. */
export interface APIResourceInfo {
  name: string;
  kind: string;
  namespaced: boolean;
}

/**
 * URL of one object, e.g. `/apis/example.com/v1/namespaces/apps/widgets/w1` or
 * `/api/v1/namespaces/apps`. Pure; `resource` comes from API discovery.
 */
export function buildObjectPath(
  apiVersion: string,
  resource: Pick<APIResourceInfo, 'name' | 'namespaced'>,
  name: string,
  namespace?: string
): string {
  const base = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const ns = resource.namespaced ? `/namespaces/${namespace || ''}` : '';
  return `${base}${ns}/${resource.name}/${name}`;
}

/**
 * The live object (without status and managed fields, with its resourceVersion) carrying the
 * generated labels, annotations and top-level content. Everything the generator does not set
 * (finalizers, owner references, other labels) is kept.
 */
export function mergeIntoLive(live: KubeJson, generated: KubeJson): KubeJson {
  const base = JSON.parse(JSON.stringify(live)) as KubeJson;
  delete base.status;
  delete base.metadata.managedFields;
  const out: KubeJson = { ...base };
  for (const [key, value] of Object.entries(generated)) {
    if (key === 'metadata' || key === 'status') continue;
    out[key] = JSON.parse(JSON.stringify(value));
  }
  const labels = { ...(base.metadata.labels || {}), ...(generated.metadata.labels || {}) };
  const annotations = {
    ...(base.metadata.annotations || {}),
    ...(generated.metadata.annotations || {}),
  };
  out.metadata = { ...base.metadata };
  if (Object.keys(labels).length > 0) out.metadata.labels = labels;
  if (Object.keys(annotations).length > 0) out.metadata.annotations = annotations;
  return out;
}

/**
 * URL of the collection an object is created in, e.g. `/apis/example.com/v1/namespaces/apps/widgets`.
 */
export function buildCollectionPath(
  apiVersion: string,
  resource: Pick<APIResourceInfo, 'name' | 'namespaced'>,
  namespace?: string
): string {
  const base = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const ns = resource.namespaced ? `/namespaces/${namespace || ''}` : '';
  return `${base}${ns}/${resource.name}`;
}

/** An entry of `metadata.ownerReferences`. */
export interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
}

/**
 * Owner reference to an existing object, for garbage collection only: without the `controller`
 * and `blockOwnerDeletion` flags, so controllers do not adopt the dependent and deleting the owner
 * is not delayed.
 */
export function ownerReferenceTo(owner: KubeJson): OwnerReference {
  if (!owner.metadata.uid) throw new Error(`${owner.kind} "${owner.metadata.name}" has no uid`);
  return {
    apiVersion: owner.apiVersion,
    kind: owner.kind,
    name: owner.metadata.name,
    uid: owner.metadata.uid,
  };
}

/** Whether the object lists the owner (by uid) among its owner references. */
export function isOwnedBy(object: KubeJson | undefined, ownerUid: string | undefined): boolean {
  return !!ownerUid && !!object?.metadata?.ownerReferences?.some(r => r.uid === ownerUid);
}

/** The object with the owner reference added; references to other owners are kept. */
export function withOwnerReference(object: KubeJson, ref: OwnerReference): KubeJson {
  const refs = object.metadata.ownerReferences || [];
  if (refs.some(r => r.uid === ref.uid)) return object;
  return { ...object, metadata: { ...object.metadata, ownerReferences: [...refs, ref] } };
}
