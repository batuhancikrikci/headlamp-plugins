/**
 * CustomResourceDefinitions, read for their OpenAPI schemas (documentation tabs).
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { SchemaNode } from '../common/docs/crdSchema';
import { RESOURCE_LIST } from '../resources/definitions';
import { toApiError } from './liveStore';
import { clusterParams } from './paths';

export interface CRDVersion {
  name: string;
  served?: boolean;
  storage?: boolean;
  schema?: { openAPIV3Schema?: SchemaNode };
}

export interface CRDJson {
  metadata: { name: string };
  spec: { group: string; names: { kind: string; plural: string }; versions?: CRDVersion[] };
}

const CRD_API = '/apis/apiextensions.k8s.io/v1/customresourcedefinitions';

/** CRDs per `${cluster}/${group}/${kind}`; schemas only change when a CRD is upgraded. */
const cache = new Map<string, Promise<CRDJson>>();

export class NotACustomResource extends Error {}

export function fetchCRD(cluster: string, group: string, kind: string): Promise<CRDJson> {
  if (!group) {
    return Promise.reject(new NotACustomResource(`${kind} is a built-in Kubernetes kind`));
  }
  const key = `${cluster}/${group}/${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    // Fetch the single CRD by name when the plural is known: it only needs `get`.
    const plural = RESOURCE_LIST.find(r => r.kind === kind && r.groups.includes(group))?.plural;
    if (plural) {
      try {
        return (await ApiProxy.request(
          `${CRD_API}/${plural}.${group}`,
          clusterParams(cluster)
        )) as CRDJson;
      } catch (err) {
        if ((err as { status?: number })?.status !== 404) throw toApiError(err);
      }
    }
    let list: { items?: CRDJson[] };
    try {
      list = await ApiProxy.request(CRD_API, clusterParams(cluster));
    } catch (err) {
      throw toApiError(err);
    }
    const crd = (list.items || []).find(c => c.spec.group === group && c.spec.names.kind === kind);
    if (!crd) throw new Error(`No CRD found for ${kind} in group ${group}`);
    return crd;
  })();
  cache.set(key, promise);
  // Failures are not cached, so a retry fetches again.
  promise.catch(() => cache.delete(key));
  return promise;
}

/** The schema of the requested version, falling back to the storage version. */
export function schemaFor(crd: CRDJson, version?: string): { version: string; root?: SchemaNode } {
  const versions = crd.spec.versions || [];
  const v = versions.find(x => x.name === version) || versions.find(x => x.storage) || versions[0];
  return { version: v?.name || '', root: v?.schema?.openAPIV3Schema };
}
