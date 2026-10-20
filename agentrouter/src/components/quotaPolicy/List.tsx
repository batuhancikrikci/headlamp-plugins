import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import React from 'react';
import { QuotaPolicy } from '../../resources/quotaPolicy';
import { ROUTE_NAMES } from '../../routes';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CreateButton, PolicyStatusSummary, StringArray } from '../common/SharedComponents';

export function QuotaPolicyList() {
  return (
    <WithVersionDiscovery title="Quota Policies">
      <ResourceListView
        title="Quota Policies"
        headerProps={{
          titleSideActions: [
            <CreateButton
              key="create"
              sidebar={ROUTE_NAMES.quotas}
              resourceClass={QuotaPolicy}
              label="Create Quota Policy"
            />,
          ],
        }}
        resourceClass={QuotaPolicy}
        columns={[
          'name',
          'namespace',
          {
            id: 'targets',
            label: 'Targets',
            render: (item: QuotaPolicy) => <StringArray items={item.targetRefNames} />,
            getValue: (item: QuotaPolicy) => item.targetRefNames.join(', ') || '-',
          },
          {
            id: 'serviceQuota',
            label: 'Service Quota',
            getValue: (item: QuotaPolicy) => item.serviceQuotaSummary,
          },
          {
            id: 'models',
            label: 'Model Quotas',
            getValue: (item: QuotaPolicy) => item.modelCount,
          },
          {
            id: 'status',
            label: 'Status',
            render: (item: QuotaPolicy) => <PolicyStatusSummary conditions={item.conditions} />,
            getValue: (item: QuotaPolicy) => {
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
