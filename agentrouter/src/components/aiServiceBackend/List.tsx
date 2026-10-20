import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { AIServiceBackend } from '../../resources/aiServiceBackend';
import { ROUTE_NAMES } from '../../routes';
import { routeReferencesBackend } from '../../utils/crossReference';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import {
  BackendRefChip,
  CreateButton,
  PolicyStatusSummary,
  SchemaChip,
} from '../common/SharedComponents';

export function AIServiceBackendList() {
  return (
    <WithVersionDiscovery title="Service Backends">
      <AIServiceBackendListContent />
    </WithVersionDiscovery>
  );
}

function AIServiceBackendListContent() {
  const [routes] = AIGatewayRoute.useList();

  const routeCount = (item: AIServiceBackend) =>
    routes ? routes.filter(r => routeReferencesBackend(r, item)).length : null;

  return (
    <ResourceListView
      title="Service Backends"
      headerProps={{
        titleSideActions: [
          <CreateButton
            key="create"
            sidebar={ROUTE_NAMES.backends}
            resourceClass={AIServiceBackend}
            label="Connect Provider"
          />,
        ],
      }}
      resourceClass={AIServiceBackend}
      columns={[
        'name',
        'namespace',
        {
          id: 'schema',
          label: 'API Schema',
          render: (item: AIServiceBackend) => <SchemaChip schemaName={item.schemaName} />,
          getValue: (item: AIServiceBackend) => item.schemaName,
        },
        {
          id: 'backendRef',
          label: 'Envoy Backend',
          render: (item: AIServiceBackend) =>
            item.spec?.backendRef ? <BackendRefChip backendRef={item.spec.backendRef} /> : '-',
          getValue: (item: AIServiceBackend) => item.backendRefName,
        },
        {
          id: 'routes',
          label: 'Used by Routes',
          getValue: (item: AIServiceBackend) => {
            const count = routeCount(item);
            return count === null ? '…' : String(count);
          },
        },
        {
          id: 'status',
          label: 'Status',
          render: (item: AIServiceBackend) => <PolicyStatusSummary conditions={item.conditions} />,
          getValue: (item: AIServiceBackend) => {
            const c = item.conditions[0];
            return c ? `${c.type}:${c.status}` : '-';
          },
        },
        'age',
      ]}
    />
  );
}
