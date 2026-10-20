import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { formatQuota, PerModelQuota, QuotaPolicy, QuotaRule } from '../../resources/quotaPolicy';
import { backendsForTargetRefs } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  ConditionsTable,
  RelatedResourcesSection,
  SchemaChip,
  TargetRefChip,
} from '../common/SharedComponents';
import { modelSuggestions } from './quotaForm';

function ruleSelectorSummary(rule: QuotaRule): React.ReactNode {
  const selectors = rule.clientSelectors || [];
  if (selectors.length === 0) return 'All clients';
  return (
    <Box>
      {selectors.map((sel, i) => (
        <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace' }}>
          {[
            ...(sel.headers || []).map(
              h =>
                `${h.name}${h.invert ? ' !' : ' '}${
                  h.type === 'Distinct' ? '(distinct)' : `= ${h.value ?? ''}`
                }`
            ),
            ...(sel.sourceCIDR ? [`source ${sel.sourceCIDR.value}`] : []),
          ].join(' AND ')}
        </Typography>
      ))}
    </Box>
  );
}

function ModelQuotaCard({ entry }: { entry: PerModelQuota }) {
  const q = entry.quota;
  return (
    <Box sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {entry.modelName}
      </Typography>
      <NameValueTable
        rows={[
          { name: 'Default Bucket', value: formatQuota(q.defaultBucket) },
          {
            name: 'Mode',
            value: <Chip size="small" label={q.mode} />,
            hide: !q.mode,
          },
          {
            name: 'Cost Expression',
            value: <Typography sx={{ fontFamily: 'monospace' }}>{q.costExpression}</Typography>,
            hide: !q.costExpression,
          },
        ]}
      />
      {(q.bucketRules || []).length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
            Bucket Rules
          </Typography>
          <SimpleTable
            data={q.bucketRules!}
            columns={[
              { label: 'Clients', getter: ruleSelectorSummary },
              { label: 'Quota', getter: (r: QuotaRule) => formatQuota(r.quota) },
              {
                label: 'Mode',
                getter: (r: QuotaRule) =>
                  r.shadowMode ? (
                    <Chip size="small" color="warning" variant="outlined" label="Shadow" />
                  ) : (
                    <Chip size="small" color="success" variant="outlined" label="Enforced" />
                  ),
              },
            ]}
          />
        </>
      )}
    </Box>
  );
}

export function QuotaPolicyDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="Quota Policy">
      <DetailsGrid
        resourceType={QuotaPolicy}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            {
              name: 'Targets',
              value:
                item.targetRefs.length > 0
                  ? item.targetRefs.map((ref, i) => <TargetRefChip key={i} targetRef={ref} />)
                  : '-',
            },
            { name: 'Model Quotas', value: String(item.modelCount) },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'serviceQuota',
              section: item.hasServiceQuota && (
                <SectionBox title="Service Quota">
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Not enforced yet: Agent Router (v1.1) accepts a service-wide quota but does not
                    apply it to traffic. Only per-model quotas are enforced.
                  </Alert>
                  <NameValueTable
                    rows={[
                      { name: 'Limit', value: formatQuota(item.spec?.serviceQuota?.quota) },
                      {
                        name: 'Cost Expression',
                        value: (
                          <Typography sx={{ fontFamily: 'monospace' }}>
                            {item.spec?.serviceQuota?.costExpression}
                          </Typography>
                        ),
                        hide: !item.spec?.serviceQuota?.costExpression,
                      },
                    ]}
                  />
                </SectionBox>
              ),
            },
            {
              id: 'perModelQuotas',
              section: item.modelCount > 0 && (
                <SectionBox title="Per-Model Quotas">
                  <ModelCoverageNotice policy={item} />
                  {item.spec!.perModelQuotas!.map((entry, i) => (
                    <ModelQuotaCard key={`${entry.modelName}-${i}`} entry={entry} />
                  ))}
                </SectionBox>
              ),
            },
            {
              id: 'limitedBackends',
              section: <LimitedBackendsSection policy={item} />,
            },
            {
              id: 'conditions',
              section: (
                <SectionBox title="Conditions">
                  <ConditionsTable conditions={item.conditions} />
                </SectionBox>
              ),
            },
          ]
        }
      />
    </WithVersionDiscovery>
  );
}

/**
 * Warns about model quotas that no AI Route can match: a perModelQuota only applies when its
 * modelName equals the modelNameOverride of a route backendRef to a targeted backend.
 */
function ModelCoverageNotice({ policy }: { policy: QuotaPolicy }) {
  const [routes] = AIGatewayRoute.useList();
  if (routes === null) return null;
  const known = new Set(
    modelSuggestions(
      routes,
      policy.targetRefs.map(t => t.name),
      policy.metadata.namespace || ''
    ).map(s => s.model)
  );
  const unmatched = (policy.spec?.perModelQuotas || [])
    .map(pm => pm.modelName)
    .filter(name => !known.has(name));
  if (unmatched.length === 0) return null;
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      Not applied to any traffic: no AI Route sends requests to the targeted Service Backends with a
      model name override of {unmatched.map(m => `“${m}”`).join(', ')}. A model quota only applies
      when its model name equals the route backend&apos;s model name override.
    </Alert>
  );
}

function LimitedBackendsSection({ policy }: { policy: QuotaPolicy }) {
  const [backends] = AIServiceBackend.useList({ namespace: policy.metadata.namespace });
  return (
    <RelatedResourcesSection
      title="Limited Service Backends"
      items={
        backends === null
          ? null
          : backendsForTargetRefs(policy.targetRefs, policy.metadata.namespace, backends)
      }
      emptyMessage="None of the targeted Service Backends exist in this namespace."
      extraColumns={[
        {
          label: 'API Schema',
          getter: item => <SchemaChip schemaName={(item as AIServiceBackend).schemaName} />,
        },
      ]}
    />
  );
}
