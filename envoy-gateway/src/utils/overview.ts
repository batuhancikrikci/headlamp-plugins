/**
 * Pure logic behind the overview page: component readiness, problems worth attention, how many
 * routes are protected by a SecurityPolicy, and a summary of the Envoy Gateway configuration.
 */
import { API_GROUP, GATEWAY_API_GROUP, ObjectJson, PolicyCondition } from '../resources/types';
import { summarizeStatus } from './conditions';
import { envoyProxyHealth, envoyProxyReferences } from './envoyProxyStatus';
import { identityOf, policyTargets, routeParentGateways } from './targets';

export const EG_CONTROLLER_PREFIX = 'gateway.envoyproxy.io/';

/** Status fields of a Deployment or DaemonSet that the readiness summary reads. */
interface WorkloadStatusJson {
  desiredNumberScheduled?: number;
  numberReady?: number;
  readyReplicas?: number;
}

/** The fields of `envoy-gateway.yaml` the overview reads; anything else in the file is ignored. */
interface EnvoyGatewayConfigFile {
  provider?: {
    type?: string;
    kubernetes?: {
      deploy?: { type?: string };
      leaderElection?: { disable?: boolean };
      watch?: { namespaces?: unknown };
    };
  };
  gateway?: { controllerName?: string };
  logging?: { level?: { default?: string } };
  rateLimit?: { backend?: { type?: unknown } };
  extensionManager?: unknown;
  extensionApis?: { enableBackend?: boolean; enableEnvoyPatchPolicy?: boolean };
  telemetry?: { metrics?: { prometheus?: { disable?: boolean } } };
}

/** Readiness of a set of workloads (Deployments / DaemonSets) that form one component. */
export interface ComponentStatus {
  id: 'controller' | 'proxy' | 'ratelimit';
  /** Number of workloads (e.g. one Envoy fleet per Gateway). */
  workloads: number;
  ready: number;
  total: number;
  versions: string[];
  namespaces: string[];
}

function imageTag(image?: string): string | undefined {
  if (!image) return undefined;
  const withoutDigest = image.split('@')[0];
  const tag = withoutDigest.includes(':') ? withoutDigest.split(':').pop() : undefined;
  return tag || undefined;
}

/** Summarizes Deployments and DaemonSets of one component. */
export function componentStatus(
  id: ComponentStatus['id'],
  workloads: ObjectJson[]
): ComponentStatus {
  let ready = 0;
  let total = 0;
  const versions = new Set<string>();
  const namespaces = new Set<string>();
  for (const w of workloads) {
    const status = (w.status || {}) as WorkloadStatusJson;
    if (w.kind === 'DaemonSet') {
      total += status.desiredNumberScheduled || 0;
      ready += status.numberReady || 0;
    } else {
      total += w.spec?.replicas ?? 1;
      ready += status.readyReplicas || 0;
    }
    const containers: Array<{ name?: string; image?: string }> =
      w.spec?.template?.spec?.containers || [];
    // The first container is the component itself (envoy-gateway / envoy / ratelimit).
    const tag = imageTag(containers[0]?.image);
    if (tag) versions.add(tag);
    if (w.metadata?.namespace) namespaces.add(w.metadata.namespace);
  }
  return {
    id,
    workloads: workloads.length,
    ready,
    total,
    versions: Array.from(versions).sort(),
    namespaces: Array.from(namespaces).sort(),
  };
}

export function componentHealth(c: ComponentStatus, optional: boolean) {
  if (c.workloads === 0) return optional ? 'unknown' : 'error';
  if (c.ready >= c.total && c.total > 0) return 'success';
  return c.ready === 0 ? 'error' : 'warning';
}

/** GatewayClasses handled by an Envoy Gateway controller. */
export function envoyGatewayClasses(classes: ObjectJson[]): ObjectJson[] {
  return classes.filter(gc => (gc.spec?.controllerName || '').startsWith(EG_CONTROLLER_PREFIX));
}

/** Gateways that use one of the given GatewayClasses. */
export function gatewaysOfClasses(gateways: ObjectJson[], classes: ObjectJson[]): ObjectJson[] {
  const names = new Set(classes.map(c => c.metadata?.name));
  return gateways.filter(g => names.has(g.spec?.gatewayClassName));
}

/** Routes attached to at least one of the given Gateways. */
export function routesOfGateways(routes: ObjectJson[], gateways: ObjectJson[]): ObjectJson[] {
  const keys = new Set(gateways.map(g => `${g.metadata?.namespace}/${g.metadata?.name}`));
  return routes.filter(r => routeParentGateways(r).some(p => keys.has(`${p.namespace}/${p.name}`)));
}

function condition(obj: ObjectJson, type: string): PolicyCondition | undefined {
  return ((obj.status?.conditions || []) as PolicyCondition[]).find(c => c.type === type);
}

export function isProgrammed(gateway: ObjectJson): boolean {
  return condition(gateway, 'Programmed')?.status === 'True';
}

export interface Issue {
  id: string;
  severity: 'error' | 'warning';
  /** Kind/group/name of the affected object, when there is one to link to. */
  kind?: string;
  group?: string;
  name: string;
  namespace?: string;
  message: string;
}

function describe(c: PolicyCondition | undefined, fallback: string): string {
  if (!c) return fallback;
  return [c.reason, c.message].filter(Boolean).join(': ') || `${c.type}=${c.status}`;
}

export interface IssueInput {
  /** Undefined while loading; issues about missing components are only raised once known. */
  components?: ComponentStatus[];
  gatewayClasses?: ObjectJson[];
  gateways?: ObjectJson[];
  routes?: ObjectJson[];
  /** Envoy Gateway objects with controller conditions (policies and Backends). */
  resources?: ObjectJson[];
  envoyProxies?: ObjectJson[];
  /** Parsed envoy-gateway configuration, if readable. */
  config?: EnvoyGatewayConfig | null;
}

/** Collects everything on the overview that deserves a look, errors first. */
export function collectIssues(input: IssueInput): Issue[] {
  const issues: Issue[] = [];
  const classes = envoyGatewayClasses(input.gatewayClasses || []);
  const gateways = gatewaysOfClasses(input.gateways || [], classes);

  for (const c of input.components || []) {
    const optional = c.id !== 'controller';
    const health = componentHealth(c, optional);
    if (health === 'error' || health === 'warning') {
      issues.push({
        id: `component-${c.id}`,
        severity: health,
        name:
          c.id === 'controller'
            ? 'Envoy Gateway controller'
            : c.id === 'proxy'
            ? 'Envoy proxy fleet'
            : 'Rate limit service',
        message:
          c.workloads === 0
            ? 'No controller Deployment (label control-plane=envoy-gateway) is visible.'
            : `${c.ready} of ${c.total} replicas are ready.`,
      });
    }
  }

  for (const gc of classes) {
    const accepted = condition(gc, 'Accepted');
    if (accepted?.status === 'False') {
      issues.push({
        id: `gc-${gc.metadata?.name}`,
        severity: 'error',
        kind: 'GatewayClass',
        group: GATEWAY_API_GROUP,
        name: gc.metadata?.name || '',
        message: describe(accepted, 'Not accepted'),
      });
    }
  }

  for (const gw of gateways) {
    const accepted = condition(gw, 'Accepted');
    const programmed = condition(gw, 'Programmed');
    const failing =
      accepted?.status === 'False'
        ? accepted
        : programmed?.status === 'False'
        ? programmed
        : undefined;
    if (failing) {
      issues.push({
        id: `gw-${gw.metadata?.namespace}-${gw.metadata?.name}`,
        severity: failing.type === 'Accepted' ? 'error' : 'warning',
        kind: 'Gateway',
        group: GATEWAY_API_GROUP,
        name: gw.metadata?.name || '',
        namespace: gw.metadata?.namespace,
        message: describe(failing, 'Not programmed'),
      });
    }
  }

  for (const route of routesOfGateways(input.routes || [], gateways)) {
    const parents: Array<{ conditions?: PolicyCondition[] }> = route.status?.parents || [];
    const failing = parents
      .flatMap(p => p.conditions || [])
      .find(c => ['Accepted', 'ResolvedRefs'].includes(c.type) && c.status === 'False');
    if (failing) {
      issues.push({
        id: `route-${route.kind}-${route.metadata?.namespace}-${route.metadata?.name}`,
        severity: 'error',
        kind: route.kind,
        group: GATEWAY_API_GROUP,
        name: route.metadata?.name || '',
        namespace: route.metadata?.namespace,
        message: describe(failing, 'Not accepted'),
      });
    }
  }

  for (const res of input.resources || []) {
    const summary = summarizeStatus(res.status);
    if (summary.health === 'error' || summary.health === 'warning') {
      issues.push({
        id: `eg-${res.kind}-${res.metadata?.namespace}-${res.metadata?.name}`,
        severity: summary.health,
        kind: res.kind,
        group: API_GROUP,
        name: res.metadata?.name || '',
        namespace: res.metadata?.namespace,
        message: describe(summary.primary, 'Not accepted'),
      });
    }
  }

  for (const ep of input.envoyProxies || []) {
    const refs = envoyProxyReferences(
      { name: ep.metadata?.name || '', namespace: ep.metadata?.namespace },
      input.gatewayClasses || [],
      input.gateways || []
    );
    const health = envoyProxyHealth(refs);
    if (health.health === 'error' && health.culprit) {
      issues.push({
        id: `ep-${ep.metadata?.namespace}-${ep.metadata?.name}`,
        severity: 'error',
        kind: 'EnvoyProxy',
        group: API_GROUP,
        name: ep.metadata?.name || '',
        namespace: ep.metadata?.namespace,
        message: `Rejected by ${health.culprit.kind} ${health.culprit.name}: ${describe(
          health.culprit.condition,
          'not accepted'
        )}`,
      });
    }
  }

  const patchPolicies = (input.resources || []).filter(r => r.kind === 'EnvoyPatchPolicy');
  if (input.config && !input.config.enableEnvoyPatchPolicy && patchPolicies.length > 0) {
    issues.push({
      id: 'config-envoypatchpolicy',
      severity: 'warning',
      name: 'EnvoyPatchPolicy is disabled',
      message: `${patchPolicies.length} EnvoyPatchPolicy object(s) exist, but extensionApis.enableEnvoyPatchPolicy is not set in the Envoy Gateway configuration, so they have no effect.`,
    });
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

export interface NamespaceCoverage {
  namespace: string;
  routes: number;
  protected: number;
}

/**
 * Per namespace: how many routes are covered by a SecurityPolicy, either attached to the route
 * itself or inherited from one of its parent Gateways.
 */
export function securityCoverage(
  routes: ObjectJson[],
  securityPolicies: ObjectJson[]
): NamespaceCoverage[] {
  const byNamespace = new Map<string, NamespaceCoverage>();
  for (const route of routes) {
    const ns = route.metadata?.namespace || '';
    const entry = byNamespace.get(ns) || { namespace: ns, routes: 0, protected: 0 };
    entry.routes++;
    const targets = [
      identityOf(route),
      ...routeParentGateways(route).map(g => ({
        group: GATEWAY_API_GROUP,
        kind: 'Gateway',
        name: g.name,
        namespace: g.namespace,
      })),
    ];
    if (securityPolicies.some(p => targets.some(target => policyTargets(p, target)))) {
      entry.protected++;
    }
    byNamespace.set(ns, entry);
  }
  return Array.from(byNamespace.values()).sort((a, b) => a.namespace.localeCompare(b.namespace));
}

export interface EnvoyGatewayConfig {
  /** Plain settings shown as "label: value". */
  settings: Array<{ id: string; label: string; value: string }>;
  /** Feature switches shown as enabled / disabled chips. */
  features: Array<{ id: string; label: string; enabled: boolean }>;
  enableEnvoyPatchPolicy: boolean;
}

/** Summarizes a parsed `envoy-gateway.yaml` (the EnvoyGateway configuration object). */
export function summarizeConfig(config: unknown): EnvoyGatewayConfig {
  const c = (config && typeof config === 'object' ? config : {}) as EnvoyGatewayConfigFile;
  const kube = c.provider?.kubernetes || {};
  const watched = kube.watch?.namespaces;
  const settings = [
    { id: 'provider', label: 'Provider', value: c.provider?.type || 'Kubernetes' },
    {
      id: 'controller',
      label: 'Controller name',
      value: c.gateway?.controllerName || `${EG_CONTROLLER_PREFIX}gatewayclass-controller`,
    },
    { id: 'deploy', label: 'Proxy placement', value: kube.deploy?.type || 'ControllerNamespace' },
    { id: 'log', label: 'Log level', value: c.logging?.level?.default || 'info' },
    ...(c.rateLimit?.backend?.type
      ? [{ id: 'ratelimit', label: 'Rate limit backend', value: String(c.rateLimit.backend.type) }]
      : []),
    ...(Array.isArray(watched) && watched.length
      ? [{ id: 'watch', label: 'Watched namespaces', value: watched.join(', ') }]
      : []),
  ];
  const enableEnvoyPatchPolicy = !!c.extensionApis?.enableEnvoyPatchPolicy;
  const features = [
    { id: 'epp', label: 'EnvoyPatchPolicy', enabled: enableEnvoyPatchPolicy },
    { id: 'backend', label: 'Backend API', enabled: !!c.extensionApis?.enableBackend },
    { id: 'ratelimit', label: 'Global rate limit', enabled: !!c.rateLimit },
    { id: 'extension', label: 'Extension manager', enabled: !!c.extensionManager },
    {
      id: 'prometheus',
      label: 'Prometheus metrics',
      enabled: c.telemetry?.metrics?.prometheus?.disable !== true,
    },
    { id: 'leader', label: 'Leader election', enabled: kube.leaderElection?.disable !== true },
  ];
  return { settings, features, enableEnvoyPatchPolicy };
}
