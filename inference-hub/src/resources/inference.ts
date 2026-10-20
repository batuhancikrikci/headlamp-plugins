/**
 * Inference routing: Gateway API Inference Extension pools (GA inference.networking.k8s.io),
 * llm-d objectives and model rewrites, and the Gateways / HTTPRoutes in front.
 */
import { classifyConditions, HealthSummary } from '../utils/health';
import { Condition, KubeJson } from './types';

export const POOL_GROUP = 'inference.networking.k8s.io';

interface ParentStatus {
  parentRef?: { group?: string; kind?: string; name: string; namespace?: string };
  conditions?: Condition[];
  controllerName?: string;
}

export interface InferencePoolJson extends KubeJson {
  spec?: {
    selector?: { matchLabels?: Record<string, string> };
    targetPorts?: Array<{ number: number }>;
    endpointPickerRef?: {
      group?: string;
      kind?: string;
      name: string;
      port?: { number: number };
      failureMode?: string;
    };
    appProtocol?: string;
  };
  status?: { parents?: ParentStatus[] };
}

export interface InferencePool {
  key: string;
  name: string;
  namespace: string;
  apiVersion: string;
  group: string;
  selector: Record<string, string>;
  targetPorts: number[];
  picker?: { name: string; kind: string; port?: number; failureMode: string };
  parents: ParentStatus[];
  health: HealthSummary;
  /** Owning LLMInferenceService, when KServe created the pool. */
  owner?: { kind: string; name: string };
  raw: InferencePoolJson;
}

export function selectorOf(spec: InferencePoolJson['spec']): Record<string, string> {
  return { ...(spec?.selector?.matchLabels || {}) };
}

/** Health from the parent (Gateway) statuses: Accepted and ResolvedRefs on every parent. */
export function parentsHealth(parents: ParentStatus[] | undefined, what: string): HealthSummary {
  if (!parents || parents.length === 0) {
    return { health: 'unknown', reason: `No Gateway reports this ${what} yet` };
  }
  const summaries = parents.map(p => {
    const conditions = p.conditions || [];
    const accepted = conditions.find(c => c.type === 'Accepted');
    const resolved = conditions.find(c => c.type === 'ResolvedRefs');
    if (accepted?.status === 'True' && (!resolved || resolved.status === 'True')) {
      return { health: 'ready' } as HealthSummary;
    }
    const failing = [accepted, resolved].find(c => c?.status === 'False');
    if (failing)
      return {
        health: 'failed',
        reason: failing.reason,
        message: failing.message,
      } as HealthSummary;
    return { health: 'progressing', reason: 'Pending' } as HealthSummary;
  });
  return (
    summaries.find(s => s.health === 'failed') ||
    summaries.find(s => s.health === 'progressing') || { health: 'ready', reason: 'Accepted' }
  );
}

export function normalizePool(raw: InferencePoolJson): InferencePool {
  const spec = raw.spec || {};
  const apiVersion = raw.apiVersion || '';
  const ports = spec.targetPorts?.map(p => p.number) || [];
  const epp = spec.endpointPickerRef;
  const owner =
    raw.metadata.ownerReferences?.find(o => o.controller) || raw.metadata.ownerReferences?.[0];
  return {
    key: `${raw.metadata.namespace}/${raw.metadata.name}@${apiVersion.split('/')[0]}`,
    name: raw.metadata.name,
    namespace: raw.metadata.namespace || '',
    apiVersion,
    group: apiVersion.split('/')[0],
    selector: selectorOf(spec),
    targetPorts: ports,
    picker: epp
      ? {
          name: epp.name,
          kind: epp.kind || 'Service',
          port: epp.port?.number,
          failureMode: epp.failureMode || 'FailClose',
        }
      : undefined,
    parents: raw.status?.parents || [],
    health: parentsHealth(raw.status?.parents, 'pool'),
    owner: owner ? { kind: owner.kind, name: owner.name } : undefined,
    raw,
  };
}

export interface BackendRef {
  group?: string;
  kind?: string;
  name: string;
  namespace?: string;
  port?: number;
  weight?: number;
}

export interface HTTPRouteJson extends KubeJson {
  spec?: {
    parentRefs?: Array<{
      group?: string;
      kind?: string;
      name: string;
      namespace?: string;
      sectionName?: string;
    }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{ path?: { type?: string; value?: string }; headers?: unknown[] }>;
      backendRefs?: BackendRef[];
    }>;
  };
  status?: { parents?: ParentStatus[] };
}

export interface GatewayJson extends KubeJson {
  spec?: {
    gatewayClassName?: string;
    listeners?: Array<{ name: string; port: number; protocol: string; hostname?: string }>;
  };
  status?: { addresses?: Array<{ type?: string; value: string }>; conditions?: Condition[] };
}

export function gatewayHealth(gw: GatewayJson): HealthSummary {
  const conditions = gw.status?.conditions || [];
  const programmed = conditions.find(c => c.type === 'Programmed');
  if (programmed) return classifyConditions(conditions, { readyType: 'Programmed' });
  return classifyConditions(conditions, {
    readyType: 'Accepted',
    createdAt: gw.metadata.creationTimestamp,
  });
}

export function isPoolBackend(ref: BackendRef): boolean {
  return ref.kind === 'InferencePool' && ref.group === POOL_GROUP;
}

/** InferencePools a route sends traffic to ("namespace/name" keys, without the group). */
export function routePools(
  route: HTTPRouteJson
): Array<{ namespace: string; name: string; group: string; weight?: number }> {
  const ns = route.metadata.namespace || '';
  return (route.spec?.rules || [])
    .flatMap(r => r.backendRefs || [])
    .filter(isPoolBackend)
    .map(b => ({
      namespace: b.namespace || ns,
      name: b.name,
      group: b.group || '',
      weight: b.weight,
    }));
}

export function routeGateways(route: HTTPRouteJson): Array<{ namespace: string; name: string }> {
  const ns = route.metadata.namespace || '';
  return (route.spec?.parentRefs || [])
    .filter(p => (p.kind || 'Gateway') === 'Gateway')
    .map(p => ({ namespace: p.namespace || ns, name: p.name }));
}

export interface ObjectiveJson extends KubeJson {
  spec?: { poolRef?: { group?: string; kind?: string; name: string }; priority?: number };
  status?: { conditions?: Condition[] };
}

export interface ModelRewriteJson extends KubeJson {
  spec?: {
    poolRef?: { group?: string; kind?: string; name: string };
    rules?: Array<{
      matches?: Array<{ model?: { type?: string; value: string } }>;
      targets?: Array<{ modelRewrite: string; weight?: number }>;
    }>;
  };
  status?: { conditions?: Condition[] };
}

/** "model -> target (weight%)" lines for display. */
export function describeRewrite(rw: ModelRewriteJson): string[] {
  return (rw.spec?.rules || []).map(rule => {
    const from =
      (rule.matches || [])
        .map(m => m.model?.value)
        .filter(Boolean)
        .join(', ') || '*';
    const targets = rule.targets || [];
    const total = targets.reduce((s, t) => s + (t.weight ?? 1), 0) || 1;
    const to = targets
      .map(
        t =>
          `${t.modelRewrite}${
            targets.length > 1 ? ` (${Math.round(((t.weight ?? 1) / total) * 100)}%)` : ''
          }`
      )
      .join(', ');
    return `${from} → ${to}`;
  });
}

export interface PoolChain {
  pool: InferencePool;
  routes: HTTPRouteJson[];
  gateways: GatewayJson[];
  /** Gateways referenced by the routes but not found (missing or not readable). */
  missingGateways: string[];
  objectives: ObjectiveJson[];
  rewrites: ModelRewriteJson[];
}

/** Links every pool to the routes that target it, their gateways, objectives and rewrites. */
export function buildChains(
  pools: InferencePool[],
  routes: HTTPRouteJson[],
  gateways: GatewayJson[],
  objectives: ObjectiveJson[] = [],
  rewrites: ModelRewriteJson[] = []
): PoolChain[] {
  const gwKey = (g: { namespace?: string; name: string }) => `${g.namespace}/${g.name}`;
  const gwByKey = new Map(
    gateways.map(g => [gwKey({ namespace: g.metadata.namespace, name: g.metadata.name }), g])
  );
  return pools.map(pool => {
    const poolRoutes = routes.filter(r =>
      routePools(r).some(
        p =>
          p.namespace === pool.namespace &&
          p.name === pool.name &&
          (!p.group || p.group === pool.group)
      )
    );
    const gatewayKeys = Array.from(new Set(poolRoutes.flatMap(r => routeGateways(r).map(gwKey))));
    const inPool = (ref?: { name: string; group?: string }, ns?: string) =>
      !!ref &&
      ref.name === pool.name &&
      ns === pool.namespace &&
      (!ref.group || ref.group === pool.group);
    return {
      pool,
      routes: poolRoutes,
      gateways: gatewayKeys.map(k => gwByKey.get(k)).filter((g): g is GatewayJson => !!g),
      missingGateways: gatewayKeys.filter(k => !gwByKey.has(k)),
      objectives: objectives.filter(o => inPool(o.spec?.poolRef, o.metadata.namespace)),
      rewrites: rewrites.filter(o => inPool(o.spec?.poolRef, o.metadata.namespace)),
    };
  });
}
