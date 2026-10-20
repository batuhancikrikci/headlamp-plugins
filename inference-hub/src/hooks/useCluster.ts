import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';

/** Name of the cluster shown in the current route ('' outside a cluster). */
export function useCurrentCluster(): string {
  return K8s.useCluster() || getCluster() || '';
}
