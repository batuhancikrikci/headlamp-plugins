import React from 'react';
import { DCGM_QUERIES, groupDcgm, NodeGpuMetrics } from '../api/dcgm';
import { ApiError } from '../api/liveStore';
import { buildInventory, GpuNode } from '../resources/gpu';
import { useGpuPods } from './useGpuPods';
import { PrometheusState } from './usePrometheus';
import { usePromInstant } from './usePromQuery';

export interface GpuFleet {
  nodes: GpuNode[];
  loading: boolean;
  nodesError?: ApiError;
  nodesForbidden: boolean;
  /** Pods of the GPU nodes could not be listed, so "requested" is unknown. */
  podsForbidden: boolean;
  metrics?: Map<string, NodeGpuMetrics>;
  /** DCGM series were found in Prometheus. */
  dcgmAvailable: boolean;
  prometheus: PrometheusState;
}

/** GPU inventory of the cluster, with DCGM metrics when Prometheus has them. */
export function useGpuFleet(opts: { withMetrics?: boolean } = {}): GpuFleet {
  const { nodes, slices, pods } = useGpuPods();
  const dcgm = usePromInstant(opts.withMetrics === false ? null : DCGM_QUERIES);

  const inventory = React.useMemo(
    () => buildInventory(nodes.items, pods.items, slices.items),
    [nodes.items, pods.items, slices.items]
  );
  const metrics = React.useMemo(() => (dcgm.data ? groupDcgm(dcgm.data) : undefined), [dcgm.data]);

  return {
    nodes: inventory,
    loading: nodes.loading || (pods.loading && !pods.forbidden),
    nodesError: nodes.error,
    nodesForbidden: nodes.forbidden,
    podsForbidden: pods.forbidden,
    metrics,
    dcgmAvailable: !!metrics && metrics.size > 0,
    prometheus: dcgm.prometheus,
  };
}
