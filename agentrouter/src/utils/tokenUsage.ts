/**
 * Token usage and quota fill from the GenAI metrics of Agent Router.
 *
 * Agent Router records `gen_ai.client.token.usage` (Prometheus: gen_ai_client_token_usage_*)
 * per request with the attributes gen_ai.token.type (input, output, total),
 * gen_ai.request.model and gen_ai.backend (the AIServiceBackend as "namespace/name").
 *
 * QuotaPolicy counters live in the quota rate limit service and are not exported, so the fill
 * of a quota is estimated from the metrics: the default cost of a request is its total tokens,
 * and every request is charged to the default bucket (Shared mode), so the total tokens of the
 * backend and model over the quota window approximate the used budget. Quotas with a custom
 * cost expression or a one-second window cannot be estimated this way.
 */
import type { QuotaPolicyInterface, QuotaValue } from '../resources/quotaPolicy';

export const WINDOWS = ['1h', '24h', '7d'] as const;
export type UsageWindow = (typeof WINDOWS)[number];

const METRIC = 'gen_ai_client_token_usage';

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function tokenUsageQueries(window: UsageWindow) {
  return {
    tokens: `sum by (gen_ai_request_model, gen_ai_token_type) (increase(${METRIC}_sum{gen_ai_token_type=~"input|output"}[${window}]))`,
    // One input token record per request.
    requests: `sum by (gen_ai_request_model) (increase(${METRIC}_count{gen_ai_token_type="input"}[${window}]))`,
  };
}

interface Sample {
  metric: Record<string, string>;
  value: [number, string];
}

export interface ModelUsage {
  model: string;
  input: number;
  output: number;
  requests: number;
}

const valueOf = (s: Sample) => {
  const v = Number(s.value?.[1]);
  return Number.isFinite(v) ? v : 0;
};

/** Tokens and requests per model, the busiest first. */
export function modelUsage(tokens: Sample[], requests: Sample[]): ModelUsage[] {
  const byModel = new Map<string, ModelUsage>();
  const row = (model: string) => {
    let r = byModel.get(model);
    if (!r) byModel.set(model, (r = { model, input: 0, output: 0, requests: 0 }));
    return r;
  };
  for (const s of tokens) {
    const r = row(s.metric.gen_ai_request_model || '(unknown)');
    if (s.metric.gen_ai_token_type === 'input') r.input += valueOf(s);
    if (s.metric.gen_ai_token_type === 'output') r.output += valueOf(s);
  }
  for (const s of requests)
    row(s.metric.gen_ai_request_model || '(unknown)').requests += valueOf(s);
  return [...byModel.values()]
    .filter(r => r.input + r.output + r.requests > 0)
    .sort((a, b) => b.input + b.output - (a.input + a.output));
}

export interface QuotaRow {
  policy: string;
  backend: string;
  /** Model the quota applies to; undefined for the service-wide quota. */
  model?: string;
  quota: QuotaValue;
  /** PromQL of the estimated usage over the quota window, when it can be estimated. */
  query?: string;
  /** Why the usage cannot be estimated. */
  reason?: string;
}

function rowFor(
  policy: string,
  backend: string,
  model: string | undefined,
  quota: QuotaValue,
  costExpression?: string
): QuotaRow {
  const base = { policy, backend, model, quota };
  if (costExpression) {
    return { ...base, reason: 'Custom cost expression: not comparable with token counts.' };
  }
  if (quota.duration === '1s') {
    return { ...base, reason: 'A one-second window is too short to estimate from Prometheus.' };
  }
  const labels = [
    'gen_ai_token_type="total"',
    `gen_ai_backend=${quote(backend)}`,
    ...(model ? [`gen_ai_request_model=${quote(model)}`] : []),
  ].join(',');
  return { ...base, query: `sum(increase(${METRIC}_sum{${labels}}[${quota.duration}]))` };
}

/** The default buckets and service-wide quotas of the policies, one row per targeted backend. */
export function quotaRows(policies: QuotaPolicyInterface[]): QuotaRow[] {
  return policies.flatMap(p => {
    const ns = p.metadata.namespace || '';
    const name = `${ns}/${p.metadata.name}`;
    const backends = (p.spec?.targetRefs || [])
      .filter(r => !r.kind || r.kind === 'AIServiceBackend')
      .map(r => `${(r as { namespace?: string }).namespace || ns}/${r.name}`);
    return backends.flatMap(backend => [
      ...(p.spec?.serviceQuota
        ? [
            rowFor(
              name,
              backend,
              undefined,
              p.spec.serviceQuota.quota,
              p.spec.serviceQuota.costExpression
            ),
          ]
        : []),
      ...(p.spec?.perModelQuotas || []).map(q =>
        rowFor(name, backend, q.modelName, q.quota.defaultBucket, q.quota.costExpression)
      ),
    ]);
  });
}

/** Share of the limit used (0–1+), or undefined without a limit. */
export function fill(used: number, limit: number): number | undefined {
  return limit > 0 ? used / limit : undefined;
}
