import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  addOwnerReference,
  createResource,
  deleteResource,
  getLive,
  updateResource,
} from '../common/form/apply';
import { isOwnedBy, ownerReferenceTo, withOwnerReference } from '../common/form/resourceModel';
import { KubeJson } from '../common/form/types';
import { GATEWAY_API_GROUP } from '../resources/external';
import { dependentLinks, releasedSecretNames } from './ownership';

/**
 * Applies resources one by one, in order (e.g. Secret before the policy that references it).
 * Stops at the first failure and reports which object failed.
 */
export async function applyAll(items: KubeObjectInterface[]): Promise<void> {
  for (const item of items) {
    try {
      await ApiProxy.apply(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to apply ${item.kind} "${item.metadata?.name}": ${message}`);
    }
  }
}

function failure(item: { kind?: string; metadata?: { name?: string } }, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Failed to apply ${item.kind} "${item.metadata?.name}": ${message}`);
}

/**
 * Applies a wizard's objects in order, like `applyAll`, except for the objects it generated for
 * another object in the list (see `dependentLinks`: a new credential Secret, an Envoy Gateway
 * Backend and its BackendTLSPolicy). Those belong to their owner:
 *
 * - one that already exists is only updated when it belongs to that owner; otherwise nothing is
 *   applied at all ("already exists"), so an object of someone else is never overwritten;
 * - a new one is created (never replaced) with an owner reference, so it is deleted together with
 *   its owner; an owner created in the same call gets linked once it exists;
 * - when a later object fails, the ones created in this call are deleted again.
 *
 * `applyOther` applies the remaining objects (by default `ApiProxy.apply`). Objects for which
 * `createOnly` returns true are new instead: when one with that name exists, nothing is applied
 * ("already exists"); they are created without ever replacing an object and removed again when a
 * later object fails. Returns warnings for links that could not be made.
 */
export async function applyWithOwners(
  items: KubeObjectInterface[],
  applyOther: (item: KubeObjectInterface) => Promise<unknown> = item => ApiProxy.apply(item),
  options: { createOnly?: (item: KubeObjectInterface) => boolean } = {}
): Promise<string[]> {
  const objects = items as unknown as KubeJson[];
  const links = dependentLinks(objects);
  const createOnly = (index: number) => !links.has(index) && !!options.createOnly?.(items[index]);
  for (const [index, object] of objects.entries()) {
    if (createOnly(index) && (await getLive(object))) {
      throw new Error(
        `${object.kind} "${object.metadata.name}" already exists. Choose another name; the existing one is not changed.`
      );
    }
  }
  const owners = new Map<number, KubeJson | undefined>();
  const lives = new Map<number, KubeJson | undefined>();
  for (const [child, owner] of links) {
    if (!owners.has(owner)) owners.set(owner, await getLive(objects[owner]));
    lives.set(child, await getLive(objects[child]));
  }
  for (const [child, owner] of links) {
    const live = lives.get(child);
    if (live && !isOwnedBy(live, owners.get(owner)?.metadata.uid)) {
      const object = objects[child];
      throw new Error(
        `${object.kind} "${object.metadata.name}" already exists. Choose another name or use the existing one.`
      );
    }
  }

  const created: Array<{ object: KubeJson; owner: number }> = [];
  for (const [index, item] of items.entries()) {
    try {
      const owner = links.get(index);
      if (owner === undefined) {
        if (createOnly(index)) {
          await createResource(objects[index]);
          created.push({ object: objects[index], owner: -1 });
        } else {
          await applyOther(item);
        }
        continue;
      }
      const object = objects[index];
      const live = lives.get(index);
      const ownerLive = owners.get(owner);
      if (live) {
        // Already ours: replace the content, keeping its owner references.
        await updateResource({
          ...object,
          metadata: {
            ...object.metadata,
            ownerReferences: live.metadata.ownerReferences,
            resourceVersion: live.metadata.resourceVersion,
          },
        });
      } else {
        const body = ownerLive?.metadata.uid
          ? withOwnerReference(object, ownerReferenceTo(ownerLive))
          : object;
        await createResource(body);
        created.push({ object: body, owner });
      }
    } catch (err) {
      await Promise.allSettled(created.map(c => deleteResource(c.object)));
      throw failure(item, err);
    }
  }

  const warnings: string[] = [];
  for (const { object, owner } of created) {
    // Objects without an owner (owner -1) and those linked while being created need nothing.
    if (owner < 0 || owners.get(owner)?.metadata.uid) continue;
    const ownerObject = objects[owner];
    try {
      const ownerLive = await getLive(ownerObject);
      if (!ownerLive) throw new Error('owner not found');
      await addOwnerReference(object, ownerLive);
    } catch {
      warnings.push(
        `${object.kind} "${object.metadata.name}" could not be linked to ${ownerObject.kind} "${ownerObject.metadata.name}"; delete it yourself when you delete the ${ownerObject.kind}.`
      );
    }
  }
  return warnings;
}

/**
 * After an edit was saved: deletes the Secrets the object no longer refers to (e.g. the old one
 * after a key rotation), but only those that belong to it. Returns warnings for failed deletes.
 */
export async function deleteReleasedSecrets(
  before: KubeObjectInterface,
  after: KubeObjectInterface
): Promise<string[]> {
  const owner = before as unknown as KubeJson;
  const warnings: string[] = [];
  for (const name of releasedSecretNames(owner, after as unknown as KubeJson)) {
    const secret: KubeJson = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name, namespace: owner.metadata.namespace },
    };
    try {
      const live = await getLive(secret);
      if (live && isOwnedBy(live, owner.metadata.uid)) await deleteResource(secret);
    } catch {
      warnings.push(
        `Secret "${name}" is no longer used by ${owner.kind} "${owner.metadata.name}" but could not be deleted.`
      );
    }
  }
  return warnings;
}

let backendTLSPolicyVersion: Promise<string | null> | null = null;

/**
 * Finds the served Gateway API version for BackendTLSPolicy (v1 on newer Gateway API
 * releases, v1alpha3 on older ones). Resolves to null when the resource is not served.
 */
export function discoverBackendTLSPolicyVersion(): Promise<string | null> {
  if (backendTLSPolicyVersion) return backendTLSPolicyVersion;
  backendTLSPolicyVersion = (async () => {
    for (const version of ['v1', 'v1alpha3']) {
      try {
        const info = await ApiProxy.request(`/apis/${GATEWAY_API_GROUP}/${version}`);
        if (
          (info?.resources || []).some((r: { name: string }) => r.name === 'backendtlspolicies')
        ) {
          return `${GATEWAY_API_GROUP}/${version}`;
        }
      } catch {
        // Version not served; try the next one.
      }
    }
    return null;
  })();
  return backendTLSPolicyVersion;
}
