/**
 * Aggregations for the Command Center.
 */
import { EventJson } from '../../components/detail/EventsPanel';
import { ModelEndpoint } from '../../resources/endpoint';
import { VllmEngine } from '../../resources/engine';
import { Health } from '../../utils/health';
import { aggregate, VllmMetrics } from '../../utils/vllmMetrics';

export interface TrafficRow {
  key: string;
  /** Endpoint, when the engines belong to one. */
  endpoint?: ModelEndpoint;
  namespace: string;
  name: string;
  model: string;
  engines: number;
  metrics: VllmMetrics;
}

/** Sums engine metrics per endpoint (or per standalone engine) and sorts by generated tokens/s. */
export function trafficByEndpoint(
  engines: VllmEngine[],
  metrics: Map<string, VllmMetrics>,
  endpoints: ModelEndpoint[]
): TrafficRow[] {
  const groups = new Map<string, { engines: VllmEngine[]; endpoint?: ModelEndpoint }>();
  for (const engine of engines) {
    const key = engine.endpoint
      ? `${engine.endpoint.slug}/${engine.namespace}/${engine.endpoint.name}`
      : `pod/${engine.namespace}/${engine.pod}`;
    const group = groups.get(key) || {
      engines: [],
      endpoint: engine.endpoint
        ? endpoints.find(
            e =>
              e.slug === engine.endpoint?.slug &&
              e.namespace === engine.namespace &&
              e.name === engine.endpoint?.name
          )
        : undefined,
    };
    group.engines.push(engine);
    groups.set(key, group);
  }
  const rows: TrafficRow[] = [];
  groups.forEach((group, key) => {
    const list = group.engines.map(e => metrics.get(e.key)).filter((m): m is VllmMetrics => !!m);
    if (list.length === 0) return;
    const first = group.engines[0];
    rows.push({
      key,
      endpoint: group.endpoint,
      namespace: first.namespace,
      name: group.endpoint?.name || first.endpoint?.name || first.pod,
      model:
        group.endpoint?.servedModelName ||
        list.find(m => m.modelName)?.modelName ||
        first.servedModelName ||
        '',
      engines: group.engines.length,
      metrics: aggregate(list),
    });
  });
  const load = (r: TrafficRow) =>
    (r.metrics.generationTps ?? 0) * 1000 + (r.metrics.running ?? 0) + (r.metrics.waiting ?? 0);
  return rows.sort((a, b) => load(b) - load(a) || a.name.localeCompare(b.name));
}

export function healthCounts(endpoints: ModelEndpoint[]): Record<Health, number> {
  const counts: Record<Health, number> = {
    ready: 0,
    progressing: 0,
    failed: 0,
    stopped: 0,
    unknown: 0,
  };
  endpoints.forEach(e => counts[e.status.health]++);
  return counts;
}

export interface PlatformStatus {
  tone: 'success' | 'info' | 'warning' | 'error' | 'default';
  label: string;
}

/** Overall status shown in the Command Center banner; the worst endpoint state wins. */
export function platformStatus(
  counts: Record<Health, number>,
  notInstalled: boolean
): PlatformStatus {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (notInstalled) return { tone: 'default', label: 'Not installed' };
  if (counts.failed > 0) return { tone: 'error', label: `${counts.failed} failing` };
  if (counts.unknown > 0) return { tone: 'warning', label: `${counts.unknown} unknown` };
  if (counts.progressing > 0) return { tone: 'info', label: `${counts.progressing} deploying` };
  if (total === 0) return { tone: 'default', label: 'No endpoints' };
  return { tone: 'success', label: 'Healthy' };
}

/** Kinds that belong to the AI platform even outside of endpoint namespaces. */
const AI_KINDS = new Set([
  'InferenceService',
  'LLMInferenceService',
  'LLMInferenceServiceConfig',
  'LocalModelCache',
  'LocalModelNode',
  'LocalModelNodeGroup',
  'InferencePool',
  'InferenceObjective',
  'InferenceModelRewrite',
  'ClusterPolicy',
  'NVIDIADriver',
]);

/**
 * Warning events that concern the AI platform: AI kinds anywhere, and objects named after an
 * endpoint (its pods, deployments, services) in the endpoint's namespace.
 */
export function aiWarnings(
  events: EventJson[],
  endpoints: ModelEndpoint[],
  limit = 10
): EventJson[] {
  const prefixes = endpoints.map(e => ({ ns: e.namespace, name: e.name }));
  const relevant = events.filter(e => {
    if (e.type !== 'Warning') return false;
    const obj = e.involvedObject || {};
    if (obj.kind && AI_KINDS.has(obj.kind)) return true;
    const ns = obj.namespace || e.metadata.namespace;
    return prefixes.some(
      p => p.ns === ns && (obj.name === p.name || (obj.name || '').startsWith(`${p.name}-`))
    );
  });
  const time = (e: EventJson) =>
    e.series?.lastObservedTime ||
    e.lastTimestamp ||
    e.eventTime ||
    e.metadata.creationTimestamp ||
    '';
  return relevant.sort((a, b) => time(b).localeCompare(time(a))).slice(0, limit);
}
