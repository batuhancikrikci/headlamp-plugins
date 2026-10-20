/**
 * Turning a workload (Deployment, StatefulSet, DaemonSet) into the endpoint selector of a
 * network policy, and back.
 */
import { Labels, LabelSelector } from '../resources/types';

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet';

export interface Workload {
  kind: WorkloadKind;
  name: string;
  namespace: string;
  /** The workload's pod selector (spec.selector). */
  selector: LabelSelector;
}

/** Selector key that limits a clusterwide policy to one namespace. */
export const NAMESPACE_SELECTOR_KEY = 'k8s:io.kubernetes.pod.namespace';

export function workloadKey(workload: Workload): string {
  return `${workload.kind}/${workload.namespace}/${workload.name}`;
}

/**
 * The endpoint selector that selects exactly the pods of a workload: the labels of its pod
 * selector. Clusterwide policies are not bound to a namespace, so the namespace is added.
 */
export function workloadSelector(workload: Workload, clusterwide: boolean): LabelSelector {
  const matchLabels = { ...(workload.selector.matchLabels || {}) };
  if (clusterwide) matchLabels[NAMESPACE_SELECTOR_KEY] = workload.namespace;
  const selector: LabelSelector = { matchLabels };
  if (workload.selector.matchExpressions?.length) {
    selector.matchExpressions = workload.selector.matchExpressions.map(e => ({ ...e }));
  }
  return selector;
}

function sameSelector(a: LabelSelector, b: LabelSelector): boolean {
  const la = a.matchLabels || {};
  const lb = b.matchLabels || {};
  const keys = Object.keys(la);
  if (keys.length !== Object.keys(lb).length || keys.some(k => la[k] !== lb[k])) return false;
  return JSON.stringify(a.matchExpressions || []) === JSON.stringify(b.matchExpressions || []);
}

/** The workload a selector was derived from, if any. */
export function workloadForSelector(
  selector: LabelSelector | undefined,
  workloads: Workload[],
  clusterwide: boolean
): Workload | undefined {
  if (!selector) return undefined;
  return workloads.find(w => sameSelector(workloadSelector(w, clusterwide), selector));
}

export interface LabelOption {
  key: string;
  value: string;
  /** Number of pods (or workloads) that carry the label. */
  count: number;
}

/** Labels Cilium or Kubernetes derive themselves; they are not useful to pick by hand. */
function isDerivedLabel(key: string): boolean {
  return (
    key.startsWith('io.kubernetes.') ||
    key.startsWith('io.cilium.') ||
    key.startsWith('reserved:') ||
    key === 'pod-template-hash' ||
    key === 'controller-revision-hash' ||
    key === 'pod-template-generation' ||
    key === 'statefulset.kubernetes.io/pod-name' ||
    key === 'apps.kubernetes.io/pod-index'
  );
}

/**
 * The distinct labels found on a set of pods, most common first, for offering them as choices.
 * Labels that identify a single pod or are derived by the platform are left out.
 */
export function labelOptions(labelSets: Labels[]): LabelOption[] {
  const counts = new Map<string, LabelOption>();
  for (const labels of labelSets) {
    for (const [key, value] of Object.entries(labels)) {
      if (isDerivedLabel(key)) continue;
      const id = `${key}=${value}`;
      const option = counts.get(id);
      if (option) option.count++;
      else counts.set(id, { key, value, count: 1 });
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key) || a.value.localeCompare(b.value)
  );
}
