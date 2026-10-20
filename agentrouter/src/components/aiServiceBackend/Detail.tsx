import {
  DetailsGrid,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { useParams } from 'react-router-dom';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { BackendSecurityPolicy } from '../../resources/backendSecurityPolicy';
import { HTTPBodyMutation, HTTPHeaderMutation } from '../../resources/common';
import { MCPRoute } from '../../resources/mcpRoute';
import { QuotaPolicy } from '../../resources/quotaPolicy';
import { resolveBackendRelations } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  BackendRefChip,
  ConditionsTable,
  RelatedResourcesSection,
  SchemaChip,
} from '../common/SharedComponents';

export function AIServiceBackendDetail() {
  const { name, namespace } = useParams<{ name: string; namespace: string }>();

  return (
    <WithVersionDiscovery title="Service Backend">
      <DetailsGrid
        resourceType={AIServiceBackend}
        name={name}
        namespace={namespace}
        withEvents
        extraInfo={item =>
          item && [
            { name: 'API Schema', value: <SchemaChip schemaName={item.schemaName} /> },
            { name: 'Schema Version', value: item.schemaVersion || '-', hide: !item.schemaVersion },
            { name: 'Schema Prefix', value: item.schemaPrefix || '-', hide: !item.schemaPrefix },
            {
              name: 'Envoy Backend',
              value: item.spec?.backendRef ? (
                <BackendRefChip backendRef={item.spec.backendRef} />
              ) : (
                '-'
              ),
            },
          ]
        }
        extraSections={item =>
          item && [
            {
              id: 'headerMutation',
              section: item.hasHeaderMutation && (
                <MutationSection title="Header Mutation" mutation={item.spec?.headerMutation} />
              ),
            },
            {
              id: 'bodyMutation',
              section: item.hasBodyMutation && (
                <MutationSection title="Body Mutation" mutation={item.spec?.bodyMutation} />
              ),
            },
            {
              id: 'relations',
              section: <BackendRelationsSections backend={item} />,
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

/** Renders a header or body mutation (set + remove lists). */
export function MutationSection({
  title,
  mutation,
}: {
  title: string;
  mutation?: HTTPHeaderMutation | HTTPBodyMutation;
}) {
  if (!mutation) return null;
  const rows = [
    ...(mutation.set || []).map(entry => {
      const key = 'name' in entry ? entry.name : entry.path;
      return { name: `Set ${key}`, value: entry.value };
    }),
    ...(mutation.remove || []).map(key => ({ name: `Remove ${key}`, value: '—' })),
  ];
  return (
    <SectionBox title={title}>
      <NameValueTable rows={rows} />
    </SectionBox>
  );
}

/** Cross-reference sections: who routes to this backend and which policies attach to it. */
function BackendRelationsSections({ backend }: { backend: AIServiceBackend }) {
  const [routes] = AIGatewayRoute.useList();
  const [mcpRoutes] = MCPRoute.useList({ namespace: backend.metadata.namespace });
  const [securityPolicies] = BackendSecurityPolicy.useList({
    namespace: backend.metadata.namespace,
  });
  const [quotaPolicies] = QuotaPolicy.useList({ namespace: backend.metadata.namespace });

  const relations = resolveBackendRelations(backend, {
    routes,
    mcpRoutes,
    securityPolicies,
    quotaPolicies,
  });

  return (
    <>
      <RelatedResourcesSection
        title="Routed By (AI Routes)"
        items={routes === null ? null : relations.routes}
        emptyMessage="No AI Route sends traffic to this backend."
      />
      <RelatedResourcesSection
        title="Security Policies"
        items={securityPolicies === null ? null : relations.securityPolicies}
        emptyMessage="No Security Policy is attached to this backend."
        extraColumns={[
          {
            label: 'Type',
            getter: item => (item as BackendSecurityPolicy).policyType,
          },
        ]}
      />
      <RelatedResourcesSection
        title="Quota Policies"
        items={quotaPolicies === null ? null : relations.quotaPolicies}
        emptyMessage="No Quota Policy limits this backend."
        extraColumns={[
          {
            label: 'Service Quota',
            getter: item => (item as QuotaPolicy).serviceQuotaSummary,
          },
        ]}
      />
      <RelatedResourcesSection
        title="MCP Routes (Shared Envoy Backend)"
        description="MCP Routes that forward to the same Envoy Gateway backend as this Service Backend."
        items={mcpRoutes === null ? null : relations.mcpRoutes}
        emptyMessage="No MCP Route shares this Envoy Gateway backend."
      />
    </>
  );
}
