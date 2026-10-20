/**
 * Pure helpers for resolving references between Envoy Gateway resources and the
 * Gateway API resources they attach to.
 */
import {
  BackendRef,
  GATEWAY_API_GROUP,
  ObjectJson,
  ObjectRef,
  PolicyTargetSpec,
  TargetRef,
  TargetSelector,
} from '../resources/types';

export interface ResourceIdentity {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
}

/** Extracts the API group of an apiVersion string ("" for the core group). */
export function groupOf(apiVersion?: string): string {
  if (!apiVersion || !apiVersion.includes('/')) return '';
  return apiVersion.split('/')[0];
}

export function identityOf(json: ObjectJson): ResourceIdentity {
  return {
    group: groupOf(json.apiVersion),
    kind: json.kind || '',
    name: json.metadata?.name || '',
    namespace: json.metadata?.namespace,
    labels: json.metadata?.labels,
  };
}

/**
 * Returns all target references of a policy. `targetRef` is deprecated in favour of
 * `targetRefs`, but both may be present; duplicates are removed.
 */
export function resolveTargetRefs(spec?: PolicyTargetSpec): TargetRef[] {
  const refs: TargetRef[] = [...(spec?.targetRefs || [])];
  const single = spec?.targetRef;
  if (single) {
    const duplicate = refs.some(
      r => r.kind === single.kind && r.name === single.name && r.sectionName === single.sectionName
    );
    if (!duplicate) refs.unshift(single);
  }
  return refs;
}

/** A stable key for a reference, suitable for React keys. */
export function refKey(
  ref: { kind?: string; name: string; namespace?: string },
  extra = ''
): string {
  return [ref.kind || '', ref.namespace || '', ref.name, extra].join('/');
}

/** Checks whether a policy target reference points to the given resource. */
export function refMatches(
  ref: TargetRef,
  policyNamespace: string | undefined,
  res: ResourceIdentity
): boolean {
  const refGroup = ref.group ?? GATEWAY_API_GROUP;
  return (
    ref.kind === res.kind &&
    ref.name === res.name &&
    refGroup === res.group &&
    (ref.namespace || policyNamespace) === res.namespace
  );
}

/** Evaluates a label selector against a set of labels. */
export function labelsMatch(
  labels: Record<string, string> | undefined,
  matchLabels?: Record<string, string>,
  matchExpressions?: TargetSelector['matchExpressions']
): boolean {
  const l = labels || {};
  if (!matchLabels && (!matchExpressions || matchExpressions.length === 0)) return false;
  for (const [k, v] of Object.entries(matchLabels || {})) {
    if (l[k] !== v) return false;
  }
  for (const expr of matchExpressions || []) {
    const has = Object.prototype.hasOwnProperty.call(l, expr.key);
    const values = expr.values || [];
    switch (expr.operator) {
      case 'In':
        if (!has || !values.includes(l[expr.key])) return false;
        break;
      case 'NotIn':
        if (has && values.includes(l[expr.key])) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

export function selectorMatches(
  selector: TargetSelector,
  policyNamespace: string | undefined,
  res: ResourceIdentity
): boolean {
  const group = selector.group ?? GATEWAY_API_GROUP;
  return (
    selector.kind === res.kind &&
    group === res.group &&
    policyNamespace === res.namespace &&
    labelsMatch(res.labels, selector.matchLabels, selector.matchExpressions)
  );
}

export interface PolicyMatch {
  /** How the policy selects the resource. */
  via: 'targetRef' | 'targetSelector';
  sectionName?: string;
}

/** Returns how (if at all) a policy attaches to a resource. */
export function policyTargets(policy: ObjectJson, res: ResourceIdentity): PolicyMatch | null {
  const spec = policy.spec as PolicyTargetSpec | undefined;
  const ns = policy.metadata?.namespace;
  for (const ref of resolveTargetRefs(spec)) {
    if (refMatches(ref, ns, res)) return { via: 'targetRef', sectionName: ref.sectionName };
  }
  for (const sel of spec?.targetSelectors || []) {
    if (selectorMatches(sel, ns, res)) return { via: 'targetSelector' };
  }
  return null;
}

/** Returns the Gateways a route is attached to through its parentRefs. */
export function routeParentGateways(
  route: ObjectJson
): Array<{ name: string; namespace?: string }> {
  const parentRefs: Array<ObjectRef & { group?: string }> = route.spec?.parentRefs || [];
  return parentRefs
    .filter(
      p =>
        (p.kind || 'Gateway') === 'Gateway' && (p.group ?? GATEWAY_API_GROUP) === GATEWAY_API_GROUP
    )
    .map(p => ({ name: p.name, namespace: p.namespace || route.metadata?.namespace }));
}

/** Returns every backendRef used by the rules of a route. */
export function routeBackendRefs(route: ObjectJson): BackendRef[] {
  const rules: Array<{ backendRefs?: BackendRef[] }> = route.spec?.rules || [];
  return rules.flatMap(r => r.backendRefs || []);
}

/** Returns every ExtensionRef filter used by a route (rule and backendRef level). */
export function routeExtensionRefs(route: ObjectJson): ObjectRef[] {
  type Filter = { type?: string; extensionRef?: ObjectRef };
  const rules: Array<{ filters?: Filter[]; backendRefs?: Array<{ filters?: Filter[] }> }> =
    route.spec?.rules || [];
  const filters = rules.flatMap(r => [
    ...(r.filters || []),
    ...(r.backendRefs || []).flatMap(b => b.filters || []),
  ]);
  return filters.filter(f => f.type === 'ExtensionRef' && f.extensionRef).map(f => f.extensionRef!);
}

/**
 * Checks whether a reference (with optional group/kind/namespace) points to the given object.
 * `defaultKind` and `defaultGroup` are used when the reference omits them.
 */
export function objectRefMatches(
  ref: (ObjectRef & { group?: string }) | undefined,
  target: { group: string; kind: string; name: string; namespace?: string },
  refNamespace: string | undefined,
  defaults: { kind?: string; group?: string } = {}
): boolean {
  if (!ref) return false;
  const kind = ref.kind || defaults.kind || '';
  const group = ref.group ?? defaults.group ?? '';
  return (
    kind === target.kind &&
    group === target.group &&
    ref.name === target.name &&
    (ref.namespace || refNamespace) === target.namespace
  );
}

/** Resource plurals of the Gateway API kinds a policy can target. */
export const GATEWAY_API_PLURALS: Record<string, string> = {
  Gateway: 'gateways',
  GatewayClass: 'gatewayclasses',
  HTTPRoute: 'httproutes',
  GRPCRoute: 'grpcroutes',
  TCPRoute: 'tcproutes',
  UDPRoute: 'udproutes',
  TLSRoute: 'tlsroutes',
};

export const CLUSTER_SCOPED_KINDS = new Set(['GatewayClass']);

export interface SectionOption {
  value: string;
  description?: string;
}

/**
 * Section names a policy can target on a resource: listener names of a Gateway, or the names of
 * route rules (only named rules can be targeted).
 */
export function sectionOptions(obj?: ObjectJson): SectionOption[] {
  if (!obj) return [];
  if (obj.kind === 'Gateway') {
    const listeners: Array<{ name?: string; protocol?: string; port?: number; hostname?: string }> =
      obj.spec?.listeners || [];
    return listeners
      .filter(l => l.name)
      .map(l => ({
        value: l.name!,
        description: [[l.protocol, l.port].filter(v => v !== undefined).join(':'), l.hostname]
          .filter(Boolean)
          .join(' · '),
      }));
  }
  const rules: Array<{
    name?: string;
    matches?: Array<{ path?: { value?: string }; method?: { service?: string; method?: string } }>;
  }> = obj.spec?.rules || [];
  return rules
    .filter(r => r.name)
    .map(r => {
      const match = r.matches?.[0];
      const description = match?.path?.value
        ? match.path.value
        : match?.method
        ? [match.method.service, match.method.method].filter(Boolean).join('/')
        : undefined;
      return { value: r.name!, description };
    });
}
