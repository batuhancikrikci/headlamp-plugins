/** Pod helpers. */
import { HealthSummary, isFailure } from '../utils/health';
import { gpuCount } from '../utils/quantity';
import { ContainerSpec } from './endpoint';
import { KubeJson } from './types';

export interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  image?: string;
  state?: {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: { reason?: string; exitCode?: number; message?: string };
  };
  lastState?: { terminated?: { reason?: string; exitCode?: number } };
}

export interface PodSpec {
  nodeName?: string;
  containers?: ContainerSpec[];
  initContainers?: ContainerSpec[];
}

export interface PodStatus {
  phase?: string;
  podIP?: string;
  reason?: string;
  message?: string;
  containerStatuses?: ContainerStatus[];
  initContainerStatuses?: ContainerStatus[];
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
}

export type PodJson = KubeJson<PodSpec, PodStatus>;

export function podRestarts(pod: PodJson): number {
  return (pod.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0);
}

export function podReadyCount(pod: PodJson): [number, number] {
  const statuses = pod.status?.containerStatuses || [];
  const total = pod.spec?.containers?.length || statuses.length;
  return [statuses.filter(c => c.ready).length, total];
}

export function podGpus(pod: PodJson): number {
  return (pod.spec?.containers || []).reduce(
    (sum, c) => sum + Math.max(gpuCount(c.resources?.limits), gpuCount(c.resources?.requests)),
    0
  );
}

/** Health of a pod, reporting the most useful waiting/termination reason. */
export function podHealth(pod: PodJson): HealthSummary {
  if (pod.metadata.deletionTimestamp) return { health: 'progressing', reason: 'Terminating' };
  const phase = pod.status?.phase;
  const statuses = [
    ...(pod.status?.initContainerStatuses || []),
    ...(pod.status?.containerStatuses || []),
  ];
  const waiting = statuses.find(c => c.state?.waiting?.reason);
  const terminated = statuses.find(c => c.state?.terminated && c.state.terminated.exitCode !== 0);
  if (phase === 'Failed') {
    return {
      health: 'failed',
      reason: pod.status?.reason || 'Failed',
      message: pod.status?.message,
    };
  }
  if (phase === 'Succeeded') return { health: 'stopped', reason: 'Completed' };
  if (waiting && isFailure(waiting.state?.waiting?.reason)) {
    return {
      health: 'failed',
      reason: waiting.state?.waiting?.reason,
      message: waiting.state?.waiting?.message,
    };
  }
  if (waiting?.state?.waiting?.reason === 'CrashLoopBackOff') {
    return { health: 'failed', reason: 'CrashLoopBackOff' };
  }
  if (terminated) {
    return {
      health: 'failed',
      reason: terminated.state?.terminated?.reason || 'Error',
      message: terminated.state?.terminated?.message,
    };
  }
  const unschedulable = pod.status?.conditions?.find(
    c => c.type === 'PodScheduled' && c.status === 'False'
  );
  if (unschedulable) {
    return {
      health: 'failed',
      reason: unschedulable.reason || 'Unschedulable',
      message: unschedulable.message,
    };
  }
  const [ready, total] = podReadyCount(pod);
  if (phase === 'Running' && total > 0 && ready === total)
    return { health: 'ready', reason: 'Running' };
  return {
    health: 'progressing',
    reason: waiting?.state?.waiting?.reason || phase || 'Pending',
  };
}
