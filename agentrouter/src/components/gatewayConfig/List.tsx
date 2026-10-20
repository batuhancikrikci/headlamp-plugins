import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import React from 'react';
import { GatewayConfig } from '../../resources/gatewayConfig';
import { ROUTE_NAMES } from '../../routes';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CreateButton, PolicyStatusSummary } from '../common/SharedComponents';

function EnabledChip({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Chip size="small" color="success" variant="outlined" label="Configured" />
  ) : (
    <Chip size="small" variant="outlined" label="Default" />
  );
}

export function GatewayConfigList() {
  return (
    <WithVersionDiscovery title="Gateway Config">
      <ResourceListView
        title="Gateway Config"
        headerProps={{
          titleSideActions: [
            <CreateButton
              key="create"
              sidebar={ROUTE_NAMES.config}
              resourceClass={GatewayConfig}
              label="Create Gateway Config"
            />,
          ],
        }}
        resourceClass={GatewayConfig}
        columns={[
          'name',
          'namespace',
          {
            id: 'extProc',
            label: 'External Processor',
            render: (item: GatewayConfig) => <EnabledChip enabled={item.hasExtProc} />,
            getValue: (item: GatewayConfig) => (item.hasExtProc ? 'Configured' : 'Default'),
          },
          {
            id: 'forwardProxy',
            label: 'Forward Proxy',
            getValue: (item: GatewayConfig) => item.forwardProxyAddress,
          },
          {
            id: 'costs',
            label: 'Global Cost Metrics',
            getValue: (item: GatewayConfig) => item.costCount,
          },
          {
            id: 'status',
            label: 'Status',
            render: (item: GatewayConfig) => <PolicyStatusSummary conditions={item.conditions} />,
            getValue: (item: GatewayConfig) => {
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
