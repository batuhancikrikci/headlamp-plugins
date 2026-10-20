import { useMemo } from 'react';
import { Alertmanager, Prometheus, PrometheusAgent, ThanosRuler } from '../resources/crds';
import { Labels } from '../types';
import { ObjectRef, SelectableKind, SelectionResult, workloadSelects } from '../utils/relations';
import { useNamespaceLabels } from './useClusterData';

export type WorkloadObject = Prometheus | PrometheusAgent | ThanosRuler | Alertmanager;

export interface WorkloadSelection {
  workload: WorkloadObject;
  result: SelectionResult;
}

/**
 * Lists every workload that could select a resource of `kind` and exposes an
 * evaluator so list/detail views can show "selected by" relationships.
 */
export function useSelectingWorkloads(kind: SelectableKind) {
  const [proms] = Prometheus.useList();
  const [agents] = PrometheusAgent.useList();
  const [rulers] = ThanosRuler.useList();
  const [ams] = Alertmanager.useList();
  const nsLabels = useNamespaceLabels();

  const workloads: WorkloadObject[] = useMemo(() => {
    switch (kind) {
      case 'AlertmanagerConfig':
        return ams || [];
      case 'PrometheusRule':
        return [...(proms || []), ...(rulers || [])];
      default:
        return [...(proms || []), ...(agents || [])];
    }
  }, [kind, proms, agents, rulers, ams]);

  const evaluate = useMemo(
    () =>
      (resource: ObjectRef): WorkloadSelection[] =>
        workloads.map(w => ({
          workload: w,
          result: workloadSelects(w.jsonData, kind, resource, nsLabels),
        })),
    [workloads, kind, nsLabels]
  );

  return { workloads, evaluate, nsLabels, loading: proms === null && ams === null };
}

/** Everything a workload selects, grouped by kind. */
export function selectedBy(
  workload: WorkloadObject,
  kind: SelectableKind,
  resources: Array<{ jsonData: ObjectRef }> | null,
  nsLabels: Record<string, Labels> | null
) {
  return (resources || [])
    .map(r => ({
      resource: r,
      result: workloadSelects(workload.jsonData, kind, r.jsonData, nsLabels),
    }))
    .filter(r => r.result !== 'not-selected');
}
