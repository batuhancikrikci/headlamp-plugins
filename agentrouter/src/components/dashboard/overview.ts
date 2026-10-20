/**
 * Pure aggregation for the overview dashboard: health per kind and the "needs attention"
 * list. Inputs are structural (metadata / spec / conditions), so the KubeObject classes can be
 * passed in directly and tests can use plain objects.
 */
import type { Condition } from '../../resources/common';
import { isAIServiceBackendRef } from '../../utils/crossReference';
import { modelSuggestions } from '../quotaPolicy/quotaForm';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ResourceLike {
  metadata: { name: string; namespace?: string };
  spec?: Json;
  conditions: Condition[];
}

export type Health = 'accepted' | 'rejected' | 'pending';

/** Classifies a resource from its conditions (Accepted / NotAccepted per the status API). */
export function healthOf(conditions: Condition[] | undefined): Health {
  const list = conditions || [];
  if (list.some(c => c.type === 'Accepted' && c.status === 'True')) return 'accepted';
  if (list.some(c => (c.type === 'NotAccepted' && c.status === 'True') || c.status === 'False')) {
    return 'rejected';
  }
  return 'pending';
}

export interface HealthCounts {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

export function healthCounts(items: ResourceLike[] | null | undefined): HealthCounts {
  const counts: HealthCounts = { total: 0, accepted: 0, rejected: 0, pending: 0 };
  for (const item of items || []) {
    counts.total++;
    counts[healthOf(item.conditions)]++;
  }
  return counts;
}

export interface Issue {
  id: string;
  severity: 'error' | 'warning';
  /** Kind of the affected resource (undefined for cluster-level issues). */
  kind?: string;
  name: string;
  namespace?: string;
  message: string;
}

export interface OverviewInput {
  routes?: ResourceLike[] | null;
  backends?: ResourceLike[] | null;
  securityPolicies?: ResourceLike[] | null;
  mcpRoutes?: ResourceLike[] | null;
  quotaPolicies?: ResourceLike[] | null;
  gatewayConfigs?: ResourceLike[] | null;
}

const KINDS: Array<[keyof OverviewInput, string]> = [
  ['routes', 'AIGatewayRoute'],
  ['backends', 'AIServiceBackend'],
  ['securityPolicies', 'BackendSecurityPolicy'],
  ['mcpRoutes', 'MCPRoute'],
  ['quotaPolicies', 'QuotaPolicy'],
  ['gatewayConfigs', 'GatewayConfig'],
];

const SERVICE_BACKEND = 'AIServiceBackend';
const key = (namespace: string | undefined, name: string) => `${namespace || ''}/${name}`;

function rejectionMessage(conditions: Condition[]): string {
  const c = conditions.find(x => x.status === 'False' || x.type === 'NotAccepted');
  return c?.message || c?.reason || 'Not accepted by the controller.';
}

/** Service Backend names (in the route namespace unless stated) a route sends traffic to. */
function routeBackendKeys(route: ResourceLike): Array<{ key: string; rule: number; name: string }> {
  const refs: Array<{ key: string; rule: number; name: string }> = [];
  (route.spec?.rules || []).forEach((rule: Json, i: number) => {
    (rule.backendRefs || []).forEach((ref: Json) => {
      if (!isAIServiceBackendRef(ref as Parameters<typeof isAIServiceBackendRef>[0])) return;
      refs.push({
        key: key(ref.namespace || route.metadata.namespace, ref.name),
        rule: i + 1,
        name: ref.name,
      });
    });
  });
  return refs;
}

/**
 * Everything that deserves a look, errors first:
 * rejected resources, routes pointing at missing backends, backends with several Security
 * Policies, policy targets that do not exist, unused backends, model quotas no route can
 * match, and resources the controller has not reported on.
 */
export function collectIssues(input: OverviewInput): Issue[] {
  const issues: Issue[] = [];
  const add = (
    severity: Issue['severity'],
    kind: string,
    r: ResourceLike,
    slug: string,
    message: string
  ) =>
    issues.push({
      id: `${kind}/${key(r.metadata.namespace, r.metadata.name)}/${slug}`,
      severity,
      kind,
      name: r.metadata.name,
      namespace: r.metadata.namespace,
      message,
    });

  // Status reported by the controller. A resource without status is only flagged when another
  // resource of the same kind has one, which proves the controller reports on that kind.
  let total = 0;
  let pendingTotal = 0;
  const pending: Array<[string, ResourceLike]> = [];
  for (const [field, kind] of KINDS) {
    const items = input[field] || [];
    const waiting = items.filter(r => healthOf(r.conditions) === 'pending');
    total += items.length;
    pendingTotal += waiting.length;
    items
      .filter(r => healthOf(r.conditions) === 'rejected')
      .forEach(r => add('error', kind, r, 'rejected', rejectionMessage(r.conditions)));
    if (waiting.length < items.length) waiting.forEach(r => pending.push([kind, r]));
  }
  if (total > 0 && pendingTotal === total) {
    issues.push({
      id: 'controller/no-status',
      severity: 'warning',
      name: 'No status reported',
      message:
        'None of the resources has a status. The Agent Router controller may not be running.',
    });
  }
  pending.forEach(([kind, r]) =>
    add('warning', kind, r, 'pending', 'The controller has not reported a status yet.')
  );

  const backends = input.backends;
  const backendKeys = new Set(
    (backends || []).map(b => key(b.metadata.namespace, b.metadata.name))
  );

  // Routes → Service Backends.
  const used = new Set<string>();
  for (const route of input.routes || []) {
    const missing = new Map<string, number>();
    for (const ref of routeBackendKeys(route)) {
      used.add(ref.key);
      if (backends && !backendKeys.has(ref.key) && !missing.has(ref.name)) {
        missing.set(ref.name, ref.rule);
      }
    }
    missing.forEach((rule, name) =>
      add(
        'error',
        'AIGatewayRoute',
        route,
        `missing-${name}`,
        `Rule ${rule} sends traffic to Service Backend "${name}", which does not exist.`
      )
    );
  }
  if (input.routes && backends) {
    backends
      .filter(b => !used.has(key(b.metadata.namespace, b.metadata.name)))
      .forEach(b => add('warning', SERVICE_BACKEND, b, 'unused', 'Not used by any AI Route.'));
  }

  // Security Policies: one per backend, and targets must exist.
  const policyByBackend = new Map<string, string>();
  for (const policy of input.securityPolicies || []) {
    for (const target of policy.spec?.targetRefs || []) {
      if (target.kind !== SERVICE_BACKEND) continue;
      const k = key(policy.metadata.namespace, target.name);
      const other = policyByBackend.get(k);
      if (other) {
        add(
          'error',
          'BackendSecurityPolicy',
          policy,
          `duplicate-${target.name}`,
          `Service Backend "${target.name}" is already targeted by "${other}"; only one Security Policy may target a backend.`
        );
      } else {
        policyByBackend.set(k, policy.metadata.name);
      }
      if (backends && !backendKeys.has(k)) {
        add(
          'warning',
          'BackendSecurityPolicy',
          policy,
          `target-${target.name}`,
          `Targets Service Backend "${target.name}", which does not exist.`
        );
      }
    }
  }

  // Quota Policies: targets must exist, model names must match a route's override.
  for (const quota of input.quotaPolicies || []) {
    const targets: string[] = (quota.spec?.targetRefs || []).map((t: Json) => t.name);
    if (backends) {
      targets
        .filter(t => !backendKeys.has(key(quota.metadata.namespace, t)))
        .forEach(t =>
          add(
            'warning',
            'QuotaPolicy',
            quota,
            `target-${t}`,
            `Targets Service Backend "${t}", which does not exist.`
          )
        );
    }
    if (input.routes) {
      const known = new Set(
        modelSuggestions(
          input.routes as unknown as Parameters<typeof modelSuggestions>[0],
          targets,
          quota.metadata.namespace || ''
        ).map(s => s.model)
      );
      const unmatched: string[] = (quota.spec?.perModelQuotas || [])
        .map((pm: Json) => pm.modelName)
        .filter((m: string) => !known.has(m));
      if (unmatched.length > 0) {
        add(
          'warning',
          'QuotaPolicy',
          quota,
          'unmatched-models',
          `Not applied: no AI Route overrides a targeted backend's model name to ${unmatched
            .map(m => `"${m}"`)
            .join(', ')}.`
        );
      }
    }
  }

  return issues.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
}

/** Service Backends per API schema, most used first. */
export function providerMix(backends: ResourceLike[] | null | undefined): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const b of backends || []) {
    const schema: string = b.spec?.schema?.name || '-';
    counts.set(schema, (counts.get(schema) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
