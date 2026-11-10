/**
 * Pure helpers of the node dashboard: what the pods on a node request against what it can
 * allocate, its taints, and the pods holding the most of it.
 */
import { NodeJson, parseCpu, parseMemory } from '../overview/clusterHealth';

export interface NodePodJson {
  metadata?: { name?: string; namespace?: string };
  spec?: {
    nodeName?: string;
    containers?: Array<{
      resources?: { requests?: Record<string, string>; limits?: Record<string, string> };
    }>;
  };
  status?: { phase?: string };
}

export interface Taint {
  key?: string;
  value?: string;
  effect?: string;
}

export interface NodeDetailJson extends NodeJson {
  spec?: { unschedulable?: boolean; taints?: Taint[]; podCIDR?: string };
}

const holdsResources = (pod: NodePodJson) =>
  pod.status?.phase !== 'Succeeded' && pod.status?.phase !== 'Failed';

export interface Allocation {
  allocatable: { cpu: number; memory: number; pods: number };
  requests: { cpu: number; memory: number };
  limits: { cpu: number; memory: number };
  pods: number;
}

export function nodeAllocation(node: NodeDetailJson, pods: NodePodJson[]): Allocation {
  const alloc = node.status?.allocatable ?? {};
  const result: Allocation = {
    allocatable: {
      cpu: parseCpu(alloc.cpu),
      memory: parseMemory(alloc.memory),
      pods: parseInt(alloc.pods ?? '0', 10) || 0,
    },
    requests: { cpu: 0, memory: 0 },
    limits: { cpu: 0, memory: 0 },
    pods: 0,
  };
  for (const pod of pods) {
    if (!holdsResources(pod)) continue;
    result.pods += 1;
    for (const c of pod.spec?.containers ?? []) {
      result.requests.cpu += parseCpu(c.resources?.requests?.cpu);
      result.requests.memory += parseMemory(c.resources?.requests?.memory);
      result.limits.cpu += parseCpu(c.resources?.limits?.cpu);
      result.limits.memory += parseMemory(c.resources?.limits?.memory);
    }
  }
  return result;
}

export function taintLabel(taint: Taint): string {
  return `${taint.key}${taint.value ? `=${taint.value}` : ''}:${taint.effect}`;
}

export interface PodLoad {
  namespace: string;
  name: string;
  requests: { cpu: number; memory: number };
  used?: { cpu: number; memory: number };
}

/** Pods on the node with their requests and, when known, their usage ("namespace/name" keys). */
export function podLoads(
  pods: NodePodJson[],
  usage?: Map<string, { cpu: number; memory: number }>
): PodLoad[] {
  return pods.filter(holdsResources).map(pod => {
    const namespace = pod.metadata?.namespace ?? '';
    const name = pod.metadata?.name ?? '';
    const requests = { cpu: 0, memory: 0 };
    for (const c of pod.spec?.containers ?? []) {
      requests.cpu += parseCpu(c.resources?.requests?.cpu);
      requests.memory += parseMemory(c.resources?.requests?.memory);
    }
    return { namespace, name, requests, used: usage?.get(`${namespace}/${name}`) };
  });
}

/** The pods using (or, without usage, requesting) the most of a resource. */
export function heaviest(loads: PodLoad[], by: 'cpu' | 'memory', count = 5): PodLoad[] {
  const value = (l: PodLoad) => l.used?.[by] ?? l.requests[by];
  return [...loads].sort((a, b) => value(b) - value(a)).slice(0, count);
}
