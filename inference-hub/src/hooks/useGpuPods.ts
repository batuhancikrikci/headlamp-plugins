import React from 'react';
import { isForbidden } from '../api/liveStore';
import { coreListPath } from '../api/paths';
import { gpuNodeNames, NodeJson, ResourceSliceJson } from '../resources/gpu';
import { PodJson } from '../resources/pod';
import { KubeList } from '../resources/types';
import { useCoreList, useLivePaths, useResourceList } from './useLive';

export const INVENTORY_INTERVAL_MS = 30000;

/** Field selector for the running and pending pods of one node. */
export function activePodsOn(node: string): string {
  return `spec.nodeName=${node},status.phase!=Succeeded,status.phase!=Failed`;
}

/**
 * The nodes, the DRA resource slices and the active pods of the GPU nodes, with one pod request
 * per GPU node. Pods of CPU-only nodes are not listed: a large cluster runs thousands of them,
 * and Inference Hub only shows GPU workloads. Every page uses the same requests, so they are
 * shared.
 */
export function useGpuPods() {
  const nodes = useCoreList<NodeJson>('v1', 'nodes', false, {}, INVENTORY_INTERVAL_MS);
  const slices = useResourceList<ResourceSliceJson>('resourceslices', {}, 60000);
  const names = React.useMemo(
    () => gpuNodeNames(nodes.items, slices.items),
    [nodes.items, slices.items]
  );
  const paths = names.map(node =>
    coreListPath('v1', 'pods', true, { fieldSelector: activePodsOn(node) })
  );
  const { snapshots } = useLivePaths<KubeList<PodJson>>(paths, INVENTORY_INTERVAL_MS);
  const items = React.useMemo(
    () => snapshots.flatMap(s => s.data?.items || []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshots.map(s => s.updatedAt).join(','), paths.join(',')]
  );
  const errors = snapshots.flatMap(s => (s.error ? [s.error] : []));
  return {
    nodes,
    slices,
    pods: {
      items,
      loading: nodes.loading || snapshots.some(s => s.loading),
      error: errors[0],
      forbidden: errors.length > 0 && errors.every(isForbidden),
    },
  };
}
