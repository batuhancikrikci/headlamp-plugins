import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import React from 'react';
import { AIGatewayRoute } from '../../resources/aiGatewayRoute';
import { ROUTE_NAMES } from '../../routes';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CreateButton, PolicyStatusSummary, StringArray } from '../common/SharedComponents';

export function AIGatewayRouteList() {
  return (
    <WithVersionDiscovery title="AI Routes">
      <ResourceListView
        title="AI Routes"
        headerProps={{
          titleSideActions: [
            <CreateButton
              key="create"
              sidebar={ROUTE_NAMES.routes}
              resourceClass={AIGatewayRoute}
              label="Create AI Route"
            />,
          ],
        }}
        resourceClass={AIGatewayRoute}
        columns={[
          'name',
          'namespace',
          {
            id: 'gateways',
            label: 'Gateways',
            render: (item: AIGatewayRoute) => <StringArray items={item.parentRefNames} />,
            getValue: (item: AIGatewayRoute) => item.parentRefNames.join(', ') || '-',
          },
          {
            id: 'hostnames',
            label: 'Hostnames',
            render: (item: AIGatewayRoute) =>
              item.hostnames.length > 0 ? <StringArray items={item.hostnames} /> : '*',
            getValue: (item: AIGatewayRoute) => item.hostnames.join(', ') || '*',
          },
          {
            id: 'rules',
            label: 'Rules',
            render: (item: AIGatewayRoute) => <Chip size="small" label={item.ruleCount} />,
            getValue: (item: AIGatewayRoute) => item.ruleCount,
          },
          {
            id: 'backends',
            label: 'Backends',
            render: (item: AIGatewayRoute) => <StringArray items={item.backendNames} />,
            getValue: (item: AIGatewayRoute) => item.backendNames.join(', ') || '-',
          },
          {
            id: 'status',
            label: 'Status',
            render: (item: AIGatewayRoute) => <PolicyStatusSummary conditions={item.conditions} />,
            getValue: (item: AIGatewayRoute) => {
              const c = item.conditions[0];
              return c ? `${c.type}:${c.status}` : '-';
            },
          },
          'age',
        ]}
      />
    </WithVersionDiscovery>
  );
}
