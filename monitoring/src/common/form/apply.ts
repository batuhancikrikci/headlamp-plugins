/**
 * Create and update requests of the shared editors and wizards.
 *
 * Headlamp's `ApiProxy.apply` POSTs and falls back to PUT on conflict, so on its own a "create"
 * could silently replace an existing object. Creating therefore only POSTs (the API server refuses
 * an existing name), and updates keep the edited `resourceVersion`, so an edit of a stale copy is
 * rejected instead of overwriting someone else's change.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { t } from '../i18n';
import {
  APIResourceInfo,
  buildCollectionPath,
  buildObjectPath,
  isOwnedBy,
  mergeIntoLive,
  ownerReferenceTo,
  withOwnerReference,
} from './resourceModel';
import { KubeJson } from './types';

function cluster(): string | undefined {
  return getCluster() || undefined;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

/** APIResourceLists per cluster and group version; they only change when CRDs change. */
const resourceLists = new Map<string, Promise<APIResourceInfo[]>>();

function apiResources(apiVersion: string): Promise<APIResourceInfo[]> {
  const id = `${cluster() || ''}|${apiVersion}`;
  let pending = resourceLists.get(id);
  if (!pending) {
    const path = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
    pending = ApiProxy.request(path, cluster() ? { cluster: cluster() } : {}).then(
      (list: { resources?: APIResourceInfo[] }) =>
        (list.resources || []).filter(r => !r.name.includes('/'))
    );
    resourceLists.set(id, pending);
    pending.catch(() => resourceLists.delete(id)); // a failed request can be retried
  }
  return pending;
}

/** URL of the object, resolved through API discovery; undefined when the kind is not served. */
export async function objectPath(
  json: Pick<KubeJson, 'apiVersion' | 'kind' | 'metadata'>
): Promise<string | undefined> {
  if (!json.apiVersion || !json.kind || !json.metadata?.name) return undefined;
  const resource = (await apiResources(json.apiVersion)).find(r => r.kind === json.kind);
  return resource
    ? buildObjectPath(json.apiVersion, resource, json.metadata.name, json.metadata.namespace)
    : undefined;
}

async function collectionPath(body: KubeJson): Promise<string | undefined> {
  const resource = (await apiResources(body.apiVersion)).find(r => r.kind === body.kind);
  return resource
    ? buildCollectionPath(body.apiVersion, resource, body.metadata.namespace)
    : undefined;
}

function alreadyExists(body: KubeJson): Error {
  return new Error(
    t('{{kind}} "{{name}}" already exists', { kind: body.kind, name: body.metadata.name })
  );
}

/** The live object, or undefined when it does not exist. */
export async function getLive(body: KubeJson): Promise<KubeJson | undefined> {
  const path = await objectPath(body);
  if (!path) return undefined;
  try {
    return (await ApiProxy.request(path, cluster() ? { cluster: cluster() } : {})) as KubeJson;
  } catch (err) {
    if (statusOf(err) === 404) return undefined;
    throw err;
  }
}

function send(body: KubeJson) {
  // Headlamp's apply() is typed for its own object interface; the body is a plain object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ApiProxy.apply(body as any, cluster());
}

/** Creates an object; never replaces an existing one (fails with a clear message instead). */
export async function createResource(body: KubeJson): Promise<void> {
  if (await getLive(body)) throw alreadyExists(body);
  const path = await collectionPath(body);
  if (!path) throw new Error(t('{{kind}} is not served by this cluster', { kind: body.kind }));
  const copy = JSON.parse(JSON.stringify(body)) as KubeJson;
  delete copy.metadata.resourceVersion;
  try {
    await ApiProxy.post(path, copy, true, { cluster: cluster() });
  } catch (err) {
    // Created by someone else since the check above.
    if (statusOf(err) === 409) throw alreadyExists(body);
    throw err;
  }
}

/** Deletes an object; one that is already gone counts as deleted. */
export async function deleteResource(body: KubeJson): Promise<void> {
  const path = await objectPath(body);
  if (!path) return;
  try {
    await ApiProxy.remove(path, { cluster: cluster() });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

/** Adds an owner reference to an existing object (merge patch; other owners are kept). */
export async function addOwnerReference(body: KubeJson, owner: KubeJson): Promise<void> {
  const path = await objectPath(body);
  const live = await getLive(body);
  if (!path || !live) {
    throw new Error(
      t('{{kind}} "{{name}}" not found', { kind: body.kind, name: body.metadata.name })
    );
  }
  const patched = withOwnerReference(live, ownerReferenceTo(owner));
  if (patched === live) return;
  await ApiProxy.patch(
    path,
    { metadata: { ownerReferences: patched.metadata.ownerReferences } },
    true,
    { cluster: cluster() }
  );
}

/**
 * Updates an existing object. The resourceVersion of the edited copy is kept, so an edit made on
 * a stale copy is rejected with a conflict instead of overwriting someone else's change.
 */
export async function updateResource(body: KubeJson): Promise<void> {
  if (body.metadata.resourceVersion) {
    await send(body);
    return;
  }
  const live = await getLive(body);
  const copy = JSON.parse(JSON.stringify(body)) as KubeJson;
  if (live?.metadata?.resourceVersion) {
    copy.metadata.resourceVersion = live.metadata.resourceVersion;
  }
  await send(copy);
}

export type WizardApplyResult = 'created' | 'updated' | 'skipped';

/**
 * Applies one object of a wizard. An object that already exists is updated on top of its live
 * copy (see `mergeIntoLive`); namespaces that exist are left untouched.
 */
export async function applyForWizard(body: KubeJson): Promise<WizardApplyResult> {
  const live = await getLive(body);
  if (!live) {
    await send(body);
    return 'created';
  }
  if (body.kind === 'Namespace') return 'skipped';
  await send(mergeIntoLive(live, body));
  return 'updated';
}

/**
 * An object a form writes for the edited resource, e.g. a Secret built from its fields. It is
 * owned by the resource (owner reference), so it is deleted together with it.
 */
export interface Dependent {
  object: KubeJson;
  /**
   * `create`: must not exist yet. `update`: must exist and already belong to the resource.
   * `delete`: no longer used by the resource; deleted after it was saved, if it belongs to it.
   */
  action: 'create' | 'update' | 'delete';
}

/**
 * Applies a resource together with its dependents, never touching objects of someone else:
 *
 * 1. Checks every dependent first: one to create must not exist, one to update must already be
 *    owned by the resource. Nothing is written when a check fails.
 * 2. Writes the dependents, then the resource, so the resource never refers to nothing. When the
 *    resource cannot be written, the dependents created in this call are deleted again.
 * 3. A new resource gets its uid only now: its new dependents are linked to it afterwards. A link
 *    that fails is reported as a warning (the objects are written, just not linked).
 * 4. Dependents the saved resource no longer uses are deleted when they belong to it; a failed
 *    delete is reported as a warning.
 *
 * Returns the warnings.
 */
export async function applyWithDependents(
  resource: KubeJson,
  mode: 'create' | 'edit',
  dependents: Dependent[]
): Promise<string[]> {
  const ownerUid = mode === 'edit' ? resource.metadata.uid : undefined;
  const lives = await Promise.all(dependents.map(d => getLive(d.object)));
  dependents.forEach((d, i) => {
    const live = lives[i];
    if (d.action === 'create' && live) {
      throw new Error(
        t('{{kind}} "{{name}}" already exists. Choose another name or use the existing one.', {
          kind: d.object.kind,
          name: d.object.metadata.name,
        })
      );
    }
    if (d.action === 'update' && !isOwnedBy(live, ownerUid)) {
      throw new Error(
        t('{{kind}} "{{name}}" does not belong to this {{owner}}, so it is not changed.', {
          kind: d.object.kind,
          name: d.object.metadata.name,
          owner: resource.kind,
        })
      );
    }
  });

  const created: KubeJson[] = [];
  try {
    for (const d of dependents) {
      if (d.action !== 'create') continue;
      const body = ownerUid ? withOwnerReference(d.object, ownerReferenceTo(resource)) : d.object;
      await createResource(body);
      created.push(body);
    }
    for (const [i, d] of dependents.entries()) {
      const live = lives[i];
      if (d.action !== 'update' || !live) continue;
      // Replaces the content; owner references and resourceVersion come from the live copy.
      await send({
        ...d.object,
        metadata: {
          ...d.object.metadata,
          ownerReferences: live.metadata.ownerReferences,
          resourceVersion: live.metadata.resourceVersion,
        },
      });
    }
    if (mode === 'create') await createResource(resource);
    else await updateResource(resource);
  } catch (err) {
    await Promise.allSettled(created.map(deleteResource));
    throw err;
  }

  const warnings: string[] = [];
  if (mode === 'create' && created.length > 0) {
    const owner = await getLive(resource).catch(() => undefined);
    for (const object of created) {
      try {
        if (!owner) throw new Error('owner not found');
        await addOwnerReference(object, owner);
      } catch {
        warnings.push(
          t(
            '{{kind}} "{{name}}" could not be linked to {{owner}} "{{ownerName}}"; delete it yourself when you delete the {{owner}}.',
            {
              kind: object.kind,
              name: object.metadata.name,
              owner: resource.kind,
              ownerName: resource.metadata.name,
            }
          )
        );
      }
    }
  }
  // Objects the resource no longer uses: only its own are deleted, never someone else's.
  for (const d of dependents) {
    if (d.action !== 'delete' || !ownerUid) continue;
    try {
      const live = await getLive(d.object);
      if (live && isOwnedBy(live, ownerUid)) await deleteResource(d.object);
    } catch {
      warnings.push(
        t(
          '{{kind}} "{{name}}" is no longer used by {{owner}} "{{ownerName}}" but could not be deleted.',
          {
            kind: d.object.kind,
            name: d.object.metadata.name,
            owner: resource.kind,
            ownerName: resource.metadata.name,
          }
        )
      );
    }
  }
  return warnings;
}
