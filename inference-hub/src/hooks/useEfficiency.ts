import React from 'react';
import {
  DEFAULT_IDLE_THRESHOLD,
  efficiencyQueries,
  efficiencyRows,
  efficiencyTotals,
  usageFromProm,
  WindowId,
  WINDOWS,
} from '../utils/efficiency';
import { useEndpoints } from './useEndpoints';
import { useGpuFleet } from './useGpuFleet';
import { usePromInstant } from './usePromQuery';

/** GPU efficiency of endpoints and other GPU workloads over a window (needs Prometheus). */
export function useEfficiency(window: WindowId, threshold = DEFAULT_IDLE_THRESHOLD) {
  const { endpoints } = useEndpoints();
  const fleet = useGpuFleet({ withMetrics: false });
  const prom = usePromInstant(efficiencyQueries(window), 60000);
  const hours = WINDOWS.find(w => w.id === window)?.hours || 1;
  const workloads = React.useMemo(() => fleet.nodes.flatMap(n => n.workloads), [fleet.nodes]);
  const usage = React.useMemo(() => usageFromProm(prom.data || {}), [prom.data]);
  const rows = React.useMemo(
    () => efficiencyRows(endpoints, workloads, usage, hours, threshold),
    [endpoints, workloads, usage, hours, threshold]
  );
  const totals = React.useMemo(() => efficiencyTotals(rows, hours), [rows, hours]);
  return {
    rows,
    totals,
    prometheus: prom.prometheus,
    loading: prom.loading || fleet.loading,
    error: prom.error,
    podsForbidden: fleet.podsForbidden,
  };
}
