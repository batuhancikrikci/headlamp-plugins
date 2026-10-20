import { Discovery, locationsOf } from '../../api/discovery';
import type { DocsTarget } from '../../common/docs/DocsDrawer';
import { ResourceId, RESOURCES } from '../../resources/definitions';

/** Documentation targets for the given resources, in order, skipping those not served. */
export function docsTargets(discovery: Discovery | undefined, ids: ResourceId[]): DocsTarget[] {
  return ids.flatMap(id => {
    const loc = locationsOf(discovery, id)[0];
    return loc ? [{ apiVersion: loc.apiVersion, kind: RESOURCES[id].kind }] : [];
  });
}
