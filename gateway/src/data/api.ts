/** Writes to the Kubernetes API: create, update and server-side dry-run of single resources. */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import { KubeJson } from '../resources/types';
import { ApiFailure, parseApiError, WriteMode, writeQuery, writeTarget } from '../utils/apiPaths';
import { dropUndefined } from '../utils/objects';

/** Outcome of a write: either the object the server returned, or why the write was rejected. */
export interface WriteResult {
  ok: boolean;
  object?: KubeJson;
  failure?: ApiFailure;
}

/**
 * Creates or updates one resource. With `dryRun` the API server validates and admits the object
 * (schema, CEL rules, admission webhooks) without persisting it.
 *
 * Create fails when the object already exists, and update fails on a concurrent modification
 * (the object carries the `resourceVersion` it was loaded with), so nothing is overwritten
 * silently.
 */
export async function writeResource(
  resource: KubeJson,
  mode: WriteMode,
  options: { dryRun?: boolean; cluster?: string | null } = {}
): Promise<WriteResult> {
  const cluster = options.cluster ?? getCluster();
  const body = dropUndefined(resource);
  try {
    const target = writeTarget(body, mode);
    const url = `${target.path}${writeQuery(!!options.dryRun)}`;
    const requestOptions = cluster ? { cluster } : {};
    const object: KubeJson =
      target.method === 'POST'
        ? await ApiProxy.post(url, body, true, requestOptions)
        : // The draft type is looser than Headlamp's object type; the API server validates it.
          await ApiProxy.put(url, body as Parameters<typeof ApiProxy.put>[1], true, requestOptions);
    return { ok: true, object };
  } catch (err) {
    return { ok: false, failure: parseApiError(err) };
  }
}

/**
 * Writes several resources in order, stopping at the first failure. Returns the results of the
 * resources that were attempted.
 */
export async function writeResources(
  resources: Array<{ resource: KubeJson; mode: WriteMode }>,
  options: { dryRun?: boolean; cluster?: string | null } = {}
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  for (const { resource, mode } of resources) {
    const result = await writeResource(resource, mode, options);
    results.push(result);
    // A dry-run keeps going so every problem is reported at once; a real apply stops.
    if (!result.ok && !options.dryRun) break;
  }
  return results;
}
