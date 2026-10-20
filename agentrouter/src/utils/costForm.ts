/**
 * Form model for LLM request cost metrics (AIGatewayRoute.spec.llmRequestCosts and
 * GatewayConfig.spec.globalLLMRequestCosts). Pure, unit tested.
 */
import type { LLMRequestCost, LLMRequestCostType } from '../resources/common';

export interface CostForm {
  metadataKey: string;
  type: LLMRequestCostType;
  cel: string;
}

export const newCost = (): CostForm => ({ metadataKey: '', type: 'TotalToken', cel: '' });

/** metadataKey is the list-map key upstream, so it must be present and unique. */
export function costErrors(costs: CostForm[]): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  costs.forEach((c, i) => {
    const label = `Cost metric #${i + 1}`;
    if (!c.metadataKey) errors.push(`${label}: metadata key is required.`);
    else if (keys.has(c.metadataKey)) errors.push(`${label}: metadata keys must be unique.`);
    keys.add(c.metadataKey);
    if (c.type === 'CEL' && !c.cel.trim()) errors.push(`${label}: CEL expression is required.`);
  });
  return errors;
}

export function toLLMRequestCosts(costs: CostForm[]): LLMRequestCost[] {
  return costs.map(c => ({
    metadataKey: c.metadataKey,
    type: c.type,
    cel: c.type === 'CEL' ? c.cel.trim() : undefined,
  }));
}
