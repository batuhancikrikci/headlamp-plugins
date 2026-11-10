/**
 * Concurrency sweep: the benchmark at growing concurrency, the highest level that still meets a
 * latency goal, and the autoscaling settings that follow from it. Everything here is pure.
 */
import type { BenchmarkSummary } from './benchmark';

export interface SweepGoal {
  /** Highest acceptable time to first token, 95th percentile. */
  ttftP95Ms: number;
  /** Highest acceptable share of failed requests (0–1). */
  maxErrorRate: number;
}

export interface SweepLevel {
  concurrency: number;
  summary: BenchmarkSummary;
}

/** Concurrency levels up to `max`: powers of two, plus `max` itself. */
export function sweepLevels(max: number): number[] {
  const levels: number[] = [];
  for (let c = 1; c < max; c *= 2) levels.push(c);
  levels.push(Math.max(1, Math.floor(max)));
  return Array.from(new Set(levels));
}

export function meetsGoal(level: SweepLevel, goal: SweepGoal): boolean {
  const ttft = level.summary.ttftMs.p95;
  return (
    level.summary.completed > 0 &&
    ttft !== undefined &&
    ttft <= goal.ttftP95Ms &&
    level.summary.errorRate <= goal.maxErrorRate
  );
}

/** The highest level that meets the goal, when every lower level met it too. */
export function recommendedLevel(levels: SweepLevel[], goal: SweepGoal): SweepLevel | undefined {
  let best: SweepLevel | undefined;
  for (const level of [...levels].sort((a, b) => a.concurrency - b.concurrency)) {
    if (!meetsGoal(level, goal)) break;
    best = level;
  }
  return best;
}

export interface ScalingAdvice {
  /** Concurrent requests one replica handles within the goal. */
  perReplica: number;
  /** Replicas for the expected peak, when one was given. */
  replicasForPeak?: number;
}

/**
 * Splits the recommended concurrency over the replicas that served the sweep. A sweep against
 * two replicas that met the goal at 16 means about 8 per replica.
 */
export function scalingAdvice(
  recommended: number,
  replicas: number,
  expectedPeak?: number
): ScalingAdvice {
  const perReplica = Math.max(1, Math.floor(recommended / Math.max(1, replicas)));
  return {
    perReplica,
    replicasForPeak:
      expectedPeak && expectedPeak > 0
        ? Math.max(1, Math.ceil(expectedPeak / perReplica))
        : undefined,
  };
}

/** In-cluster address of Prometheus from the plugin's endpoint, if it can be derived. */
export function inClusterPrometheus(endpoint?: { kind: 'proxy' | 'url'; base: string }): string {
  if (!endpoint) return '<prometheus-url>';
  if (endpoint.kind === 'url') return endpoint.base.replace(/\/$/, '');
  const m = endpoint.base.match(
    /\/namespaces\/([^/]+)\/services\/(?:(https?):)?([^/:]+):([^/]+)\/proxy(\/.*)?$/
  );
  if (!m) return '<prometheus-url>';
  const [, ns, scheme, name, port, path] = m;
  return `${scheme || 'http'}://${name}.${ns}.svc:${port}${(path || '').replace(/\/$/, '')}`;
}

/**
 * The scaling part of the endpoint spec that keeps each replica near `perReplica` concurrent
 * requests: for an LLMInferenceService a KEDA Prometheus trigger on the running and waiting
 * requests of its decode pods (spec.scaling.keda, KServe 0.21+), for an InferenceService the
 * concurrency target of the predictor.
 */
export function scalingSpec(
  kind: 'LLMInferenceService' | 'InferenceService',
  endpoint: { namespace: string; name: string },
  advice: ScalingAdvice,
  minReplicas: number,
  maxReplicas: number,
  prometheusUrl: string
): Record<string, unknown> {
  if (kind === 'InferenceService') {
    return {
      predictor: {
        minReplicas,
        maxReplicas,
        scaleMetric: 'concurrency',
        scaleTarget: advice.perReplica,
      },
    };
  }
  const pods = `namespace="${endpoint.namespace}",pod=~"${endpoint.name}-kserve-.*",pod!~"${endpoint.name}-kserve-prefill-.*"`;
  return {
    scaling: {
      minReplicas,
      maxReplicas,
      keda: {
        triggers: [
          {
            type: 'prometheus',
            metadata: {
              serverAddress: prometheusUrl,
              query: `sum(vllm:num_requests_running{${pods}}) + sum(vllm:num_requests_waiting{${pods}})`,
              threshold: String(advice.perReplica),
            },
          },
        ],
      },
    },
  };
}
