import { KubeObject, KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Condition, CRDStatus, LocalPolicyTargetReference } from './common';

/** Quota value with limit and time window. */
export interface QuotaValue {
  limit: number;
  duration: '1s' | '1m' | '1h' | '1d';
}

/** Service-wide quota definition. */
export interface ServiceQuotaDefinition {
  costExpression?: string;
  quota: QuotaValue;
}

/** Quota rule with client selectors. */
export interface QuotaRule {
  clientSelectors?: Array<{
    headers?: Array<{
      name: string;
      value?: string;
      type?: string;
      invert?: boolean;
    }>;
    sourceCIDR?: { type?: string; value: string };
  }>;
  quota: QuotaValue;
  shadowMode?: boolean;
}

/** Per-model quota definition. */
export interface QuotaDefinition {
  costExpression?: string;
  mode?: 'Shared';
  defaultBucket: QuotaValue;
  bucketRules?: QuotaRule[];
}

/** Per-model quota entry. */
export interface PerModelQuota {
  modelName: string;
  quota: QuotaDefinition;
}

export interface QuotaPolicyInterface extends KubeObjectInterface {
  spec?: {
    targetRefs?: LocalPolicyTargetReference[];
    serviceQuota?: ServiceQuotaDefinition;
    perModelQuotas?: PerModelQuota[];
  };
  status?: CRDStatus;
}

const DURATION_LABELS: Record<string, string> = {
  '1s': 'second',
  '1m': 'minute',
  '1h': 'hour',
  '1d': 'day',
};

/** Formats a quota value as e.g. `10,000 / hour`. */
export function formatQuota(q?: QuotaValue): string {
  if (!q) return '-';
  return `${q.limit.toLocaleString()} / ${DURATION_LABELS[q.duration] || q.duration}`;
}

export class QuotaPolicy extends KubeObject<QuotaPolicyInterface> {
  static kind = 'QuotaPolicy';
  static apiName = 'quotapolicies';
  static apiVersion = 'aigateway.envoyproxy.io/v1alpha1';
  static isNamespaced = true;

  static get detailsRoute() {
    return 'Quota Policies Detail';
  }

  get spec() {
    return this.jsonData.spec;
  }

  get status(): CRDStatus | undefined {
    return this.jsonData.status;
  }

  get targetRefNames(): string[] {
    return (this.spec?.targetRefs || []).map(r => `${r.kind}/${r.name}`);
  }

  get targetRefs(): LocalPolicyTargetReference[] {
    return this.spec?.targetRefs || [];
  }

  get modelCount(): number {
    return this.spec?.perModelQuotas?.length || 0;
  }

  get hasServiceQuota(): boolean {
    return !!this.spec?.serviceQuota?.quota;
  }

  get serviceQuotaSummary(): string {
    const sq = this.spec?.serviceQuota;
    if (!sq?.quota) return '-';
    return formatQuota(sq.quota);
  }

  get conditions(): Condition[] {
    return this.status?.conditions || [];
  }
}
