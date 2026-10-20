/** Pure helpers over AIGatewayRoute specs (no Headlamp runtime imports; unit tested). */
import type { AIGatewayRouteRule, AIGatewayRouteRuleBackendRef } from './aiGatewayRoute';
import { AI_MODEL_HEADER } from './common';

export interface ModelRoute {
  model: string;
  backendRefs: AIGatewayRouteRuleBackendRef[];
}

/** Collects exact `x-ai-eg-model` header matches from route rules (pure, unit tested). */
export function extractModelRoutes(rules: AIGatewayRouteRule[] | undefined): ModelRoute[] {
  const result: ModelRoute[] = [];
  for (const rule of rules || []) {
    for (const match of rule.matches || []) {
      for (const h of match.headers || []) {
        if (
          h.name.toLowerCase() === AI_MODEL_HEADER &&
          h.value &&
          (!h.type || h.type === 'Exact')
        ) {
          result.push({ model: h.value, backendRefs: rule.backendRefs || [] });
        }
      }
    }
  }
  return result;
}
