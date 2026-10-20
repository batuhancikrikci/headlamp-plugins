import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import React from 'react';
import { MCPRoute } from '../../resources/mcpRoute';
import { ROUTE_NAMES } from '../../routes';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CreateButton, PolicyStatusSummary, StringArray } from '../common/SharedComponents';

export function MCPRouteList() {
  return (
    <WithVersionDiscovery title="MCP Routes">
      <ResourceListView
        title="MCP Routes"
        headerProps={{
          titleSideActions: [
            <CreateButton
              key="create"
              sidebar={ROUTE_NAMES.mcp}
              resourceClass={MCPRoute}
              label="Create MCP Route"
            />,
          ],
        }}
        resourceClass={MCPRoute}
        columns={[
          'name',
          'namespace',
          {
            id: 'path',
            label: 'Path',
            getValue: (item: MCPRoute) => item.path,
          },
          {
            id: 'gateways',
            label: 'Gateways',
            render: (item: MCPRoute) => <StringArray items={item.parentRefNames} />,
            getValue: (item: MCPRoute) => item.parentRefNames.join(', ') || '-',
          },
          {
            id: 'servers',
            label: 'MCP Servers',
            render: (item: MCPRoute) => <StringArray items={item.backendNames} />,
            getValue: (item: MCPRoute) => item.backendNames.join(', ') || '-',
          },
          {
            id: 'auth',
            label: 'Auth',
            render: (item: MCPRoute) =>
              item.hasSecurityPolicy ? (
                <Chip size="small" color="success" variant="outlined" label="Secured" />
              ) : (
                <Chip size="small" variant="outlined" label="Open" />
              ),
            getValue: (item: MCPRoute) => (item.hasSecurityPolicy ? 'Secured' : 'Open'),
          },
          {
            id: 'status',
            label: 'Status',
            render: (item: MCPRoute) => <PolicyStatusSummary conditions={item.conditions} />,
            getValue: (item: MCPRoute) => {
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
