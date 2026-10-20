/**
 * Pure helpers that resolve relationships between AI Gateway resources.
 *
 * Reference semantics follow the upstream API (theagentrouter/agent-router v1.1.0):
 * - AIGatewayRoute rule backendRefs point to AIServiceBackends by default (kind omitted),
 *   or to InferencePools when group/kind are set. Namespace defaults to the route's namespace.
 * - BackendSecurityPolicy / QuotaPolicy targetRefs are LocalPolicyTargetReferences, so the
 *   target always lives in the policy's own namespace.
 * - AIServiceBackend.spec.backendRef and MCPRoute backendRefs point to Envoy Gateway
 *   `Backend` resources (or Services), which lets us relate the two through a shared backend.
 */
import type { AIGatewayRoute, AIGatewayRouteRuleBackendRef } from '../resources/aiGatewayRoute';
import type { AIServiceBackend } from '../resources/aiServiceBackend';
import type { BackendSecurityPolicy } from '../resources/backendSecurityPolicy';
import {
  AI_GATEWAY_GROUP,
  BackendObjectReference,
  Condition,
  INFERENCE_POOL_GROUP,
  INFERENCE_POOL_KIND,
  LocalPolicyTargetReference,
} from '../resources/common';
import type { MCPRoute } from '../resources/mcpRoute';
import type { QuotaPolicy } from '../resources/quotaPolicy';

export const AI_SERVICE_BACKEND_KIND = 'AIServiceBackend';

/** Returns true when a route rule backendRef targets an AIServiceBackend (the default kind). */
export function isAIServiceBackendRef(ref: AIGatewayRouteRuleBackendRef): boolean {
  return (
    (!ref.kind || ref.kind === AI_SERVICE_BACKEND_KIND) &&
    (!ref.group || ref.group === AI_GATEWAY_GROUP)
  );
}

/** Returns true when a route rule backendRef targets a Gateway API Inference Extension InferencePool. */
export function isInferencePoolRef(ref: AIGatewayRouteRuleBackendRef): boolean {
  return ref.kind === INFERENCE_POOL_KIND && ref.group === INFERENCE_POOL_GROUP;
}

/** Returns true when the route has at least one rule backendRef pointing at the given backend. */
export function routeReferencesBackend(route: AIGatewayRoute, backend: AIServiceBackend): boolean {
  for (const rule of route.spec?.rules || []) {
    for (const ref of rule.backendRefs || []) {
      if (!isAIServiceBackendRef(ref)) continue;
      const ns = ref.namespace || route.metadata.namespace;
      if (ref.name === backend.metadata.name && ns === backend.metadata.namespace) {
        return true;
      }
    }
  }
  return false;
}

/** Returns true when a policy's targetRefs include the given AIServiceBackend. */
export function targetRefsIncludeBackend(
  targetRefs: LocalPolicyTargetReference[] | undefined,
  policyNamespace: string | undefined,
  backend: AIServiceBackend
): boolean {
  if (policyNamespace !== backend.metadata.namespace) return false;
  return (targetRefs || []).some(
    ref => ref.kind === AI_SERVICE_BACKEND_KIND && ref.name === backend.metadata.name
  );
}

/** Returns true when an Envoy Gateway backend reference resolves to the same object. */
function sameEnvoyBackend(
  a: BackendObjectReference,
  aNamespace: string | undefined,
  b: BackendObjectReference,
  bNamespace: string | undefined
): boolean {
  const aKind = a.kind || 'Service';
  const bKind = b.kind || 'Service';
  const aGroup = a.group || '';
  const bGroup = b.group || '';
  return (
    a.name === b.name &&
    aKind === bKind &&
    aGroup === bGroup &&
    (a.namespace || aNamespace) === (b.namespace || bNamespace)
  );
}

/** Returns true when the MCPRoute forwards to the same Envoy Gateway backend as the AIServiceBackend. */
export function mcpRouteSharesEnvoyBackend(mcp: MCPRoute, backend: AIServiceBackend): boolean {
  const target = backend.spec?.backendRef;
  if (!target) return false;
  return (mcp.spec?.backendRefs || []).some(ref =>
    sameEnvoyBackend(ref, mcp.metadata.namespace, target, backend.metadata.namespace)
  );
}

/** All resources related to a single AIServiceBackend. */
export interface BackendRelations {
  routes: AIGatewayRoute[];
  mcpRoutes: MCPRoute[];
  securityPolicies: BackendSecurityPolicy[];
  quotaPolicies: QuotaPolicy[];
}

export function resolveBackendRelations(
  backend: AIServiceBackend,
  lists: {
    routes?: AIGatewayRoute[] | null;
    mcpRoutes?: MCPRoute[] | null;
    securityPolicies?: BackendSecurityPolicy[] | null;
    quotaPolicies?: QuotaPolicy[] | null;
  }
): BackendRelations {
  return {
    routes: (lists.routes || []).filter(r => routeReferencesBackend(r, backend)),
    mcpRoutes: (lists.mcpRoutes || []).filter(m => mcpRouteSharesEnvoyBackend(m, backend)),
    securityPolicies: (lists.securityPolicies || []).filter(p =>
      targetRefsIncludeBackend(p.targetRefs, p.metadata.namespace, backend)
    ),
    quotaPolicies: (lists.quotaPolicies || []).filter(p =>
      targetRefsIncludeBackend(p.targetRefs, p.metadata.namespace, backend)
    ),
  };
}

/** Resolves the AIServiceBackends a list of policy targetRefs points at. */
export function backendsForTargetRefs(
  targetRefs: LocalPolicyTargetReference[] | undefined,
  policyNamespace: string | undefined,
  backends: AIServiceBackend[] | null | undefined
): AIServiceBackend[] {
  return (backends || []).filter(b => targetRefsIncludeBackend(targetRefs, policyNamespace, b));
}

/** Resolves the AIServiceBackends referenced by the rules of a route. */
export function backendsForRoute(
  route: AIGatewayRoute,
  backends: AIServiceBackend[] | null | undefined
): AIServiceBackend[] {
  return (backends || []).filter(b => routeReferencesBackend(route, b));
}

/** Resolves AIServiceBackends that sit on top of the same Envoy Gateway backends as the MCPRoute. */
export function backendsForMCPRoute(
  mcp: MCPRoute,
  backends: AIServiceBackend[] | null | undefined
): AIServiceBackend[] {
  return (backends || []).filter(b => mcpRouteSharesEnvoyBackend(mcp, b));
}

/** Returns true when the resource reports Accepted=True. */
export function isAccepted(conditions: Condition[] | undefined): boolean {
  return !!conditions?.some(c => c.type === 'Accepted' && c.status === 'True');
}
