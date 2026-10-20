import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Typography } from '@mui/material';
import React from 'react';
import { useParams } from 'react-router-dom';
import {
  AIGatewayRoute,
  AIGatewayRouteRule,
  AIGatewayRouteRuleBackendRef,
} from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { InferencePool } from '../../resources/external';
import { detailRoute, ROUTE_NAMES } from '../../routes';
import { isAIServiceBackendRef, isInferencePoolRef } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  ConditionsTable,
  LLMRequestCostsSection,
  ParentRefChip,
  PluginResourceLink,
  PolicyStatusSummary,
  SchemaChip,
  StringArray,
} from '../common/SharedComponents';

export function AIGatewayRouteDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="AI Route">
      <DetailsGrid
        resourceType={AIGatewayRoute}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            {
              name: 'Gateways',
              value:
                (item.spec?.parentRefs || []).length > 0 ? (
                  <Box>
                    {item.spec!.parentRefs!.map((ref, i) => (
                      <ParentRefChip key={i} parentRef={ref} />
                    ))}
                  </Box>
                ) : (
                  '-'
                ),
            },
            {
              name: 'Hostnames',
              value: item.hostnames.length > 0 ? <StringArray items={item.hostnames} /> : '*',
            },
            { name: 'Rules', value: String(item.ruleCount) },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'rules',
              section: <RulesSection route={item} />,
            },
            {
              id: 'llmRequestCosts',
              section: item.costCount > 0 && (
                <LLMRequestCostsSection costs={item.spec?.llmRequestCosts || []} />
              ),
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

/** InferencePool list state; null when the route references no pool (nothing is fetched). */
type PoolState = { items: InferencePool[] | null; error: unknown } | null;

/** Fetches InferencePools; mounted only when needed since the CRD may not be installed. */
function WithInferencePools({ children }: { children: (pools: PoolState) => React.ReactNode }) {
  const [items, error] = InferencePool.useList();
  return <>{children({ items, error })}</>;
}

/** Shows every rule with its matches, timeouts and resolved backends. */
function RulesSection({ route }: { route: AIGatewayRoute }) {
  const rules = route.spec?.rules || [];
  const [backends] = AIServiceBackend.useList();
  const usesPools = rules.some(r => (r.backendRefs || []).some(isInferencePoolRef));

  const renderRules = (pools: PoolState) =>
    rules.map((rule, i) => (
      <RuleCard
        key={i}
        index={i}
        rule={rule}
        routeNamespace={route.metadata.namespace}
        backends={backends}
        pools={pools}
      />
    ));

  return (
    <SectionBox title="Routing Rules">
      {rules.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No rules defined.
        </Typography>
      )}
      {usesPools ? <WithInferencePools>{renderRules}</WithInferencePools> : renderRules(null)}
    </SectionBox>
  );
}

function RuleCard({
  index,
  rule,
  routeNamespace,
  backends,
  pools,
}: {
  index: number;
  rule: AIGatewayRouteRule;
  routeNamespace?: string;
  backends: AIServiceBackend[] | null;
  pools: PoolState;
}) {
  const usesPool = (rule.backendRefs || []).some(isInferencePoolRef);
  const matchRows = (rule.matches || []).flatMap((m, mi) =>
    (m.headers || []).map(h => ({
      name: `Match #${mi + 1}`,
      value: (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {h.name} {h.type === 'RegularExpression' ? '~=' : '=='} {h.value}
        </Typography>
      ),
    }))
  );

  const findBackend = (ref: AIGatewayRouteRuleBackendRef) => {
    if (!isAIServiceBackendRef(ref)) return undefined;
    const ns = ref.namespace || routeNamespace;
    return backends?.find(b => b.metadata.name === ref.name && b.metadata.namespace === ns);
  };

  const findPool = (ref: AIGatewayRouteRuleBackendRef) => {
    const ns = ref.namespace || routeNamespace;
    return pools?.items?.find(p => p.metadata.name === ref.name && p.metadata.namespace === ns);
  };

  return (
    <Box
      sx={{
        mb: 2,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {rule.name ? `Rule ${index + 1}: ${rule.name}` : `Rule ${index + 1}`}
      </Typography>

      <NameValueTable
        rows={[
          ...(matchRows.length > 0
            ? matchRows
            : [{ name: 'Matches', value: 'All requests (no match conditions)' }]),
          {
            name: 'Request Timeout',
            value: rule.timeouts?.request || '-',
            hide: !rule.timeouts?.request,
          },
          {
            name: 'Backend Request Timeout',
            value: rule.timeouts?.backendRequest || '-',
            hide: !rule.timeouts?.backendRequest,
          },
          {
            name: 'Stream Idle Timeout',
            value: rule.streamIdleTimeout || '-',
            hide: !rule.streamIdleTimeout,
          },
          { name: 'Models Owned By', value: rule.modelsOwnedBy || '-', hide: !rule.modelsOwnedBy },
        ]}
      />

      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Backends
      </Typography>
      {usesPool && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Load balancing and fallback for this rule are handled by the InferencePool&apos;s endpoint
          picker; weight, priority and model override do not apply.
        </Typography>
      )}
      <SimpleTable
        data={rule.backendRefs || []}
        emptyMessage="No backends configured for this rule."
        columns={[
          {
            label: 'Backend',
            getter: (ref: AIGatewayRouteRuleBackendRef) =>
              isAIServiceBackendRef(ref) ? (
                <PluginResourceLink
                  routeName={detailRoute(ROUTE_NAMES.backends)}
                  name={ref.name}
                  namespace={ref.namespace || routeNamespace}
                />
              ) : (
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {ref.namespace ? `${ref.namespace}/` : ''}
                  {ref.name}
                </Typography>
              ),
          },
          {
            label: 'Type',
            getter: (ref: AIGatewayRouteRuleBackendRef) => (
              <Chip
                size="small"
                variant="outlined"
                color={isInferencePoolRef(ref) ? 'info' : 'default'}
                label={isAIServiceBackendRef(ref) ? 'Service Backend' : ref.kind || '-'}
              />
            ),
          },
          {
            label: 'Schema',
            getter: (ref: AIGatewayRouteRuleBackendRef) => {
              const b = findBackend(ref);
              return b ? <SchemaChip schemaName={b.schemaName} /> : '-';
            },
          },
          {
            label: 'Weight',
            getter: (ref: AIGatewayRouteRuleBackendRef) => ref.weight ?? 1,
          },
          {
            label: 'Priority',
            getter: (ref: AIGatewayRouteRuleBackendRef) => ref.priority ?? 0,
          },
          {
            label: 'Model Override',
            getter: (ref: AIGatewayRouteRuleBackendRef) => ref.modelNameOverride || '-',
          },
          {
            label: 'Status',
            getter: (ref: AIGatewayRouteRuleBackendRef) => {
              if (isInferencePoolRef(ref)) {
                if (pools?.error) return 'Unknown';
                if (!pools?.items) return '…';
                const pool = findPool(ref);
                return pool ? (
                  <Typography variant="body2" title={pool.summary}>
                    Found
                  </Typography>
                ) : (
                  <Typography variant="body2" color="error">
                    Not found
                  </Typography>
                );
              }
              if (!isAIServiceBackendRef(ref)) return '-';
              if (backends === null) return '…';
              const b = findBackend(ref);
              return b ? (
                <PolicyStatusSummary conditions={b.conditions} />
              ) : (
                <Typography variant="body2" color="error">
                  Not found
                </Typography>
              );
            },
          },
        ]}
      />
    </Box>
  );
}
