import { ResourceListView } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip } from '@mui/material';
import React from 'react';
import { BackendSecurityPolicy } from '../../resources/backendSecurityPolicy';
import { ROUTE_NAMES } from '../../routes';
import { WithVersionDiscovery } from '../../utils/versionDiscovery';
import { CreateButton, PolicyStatusSummary, StringArray } from '../common/SharedComponents';

export function BackendSecurityPolicyList() {
  return (
    <WithVersionDiscovery title="Security Policies">
      <ResourceListView
        title="Security Policies"
        headerProps={{
          titleSideActions: [
            <CreateButton
              key="create"
              sidebar={ROUTE_NAMES.security}
              resourceClass={BackendSecurityPolicy}
              label="Create Policy"
            />,
          ],
        }}
        resourceClass={BackendSecurityPolicy}
        columns={[
          'name',
          'namespace',
          {
            id: 'type',
            label: 'Type',
            render: (item: BackendSecurityPolicy) => (
              <Chip size="small" color="primary" variant="outlined" label={item.policyType} />
            ),
            getValue: (item: BackendSecurityPolicy) => item.policyType,
          },
          {
            id: 'credential',
            label: 'Credential Source',
            getValue: (item: BackendSecurityPolicy) => item.credentialSummary,
          },
          {
            id: 'targets',
            label: 'Targets',
            render: (item: BackendSecurityPolicy) => <StringArray items={item.targetRefNames} />,
            getValue: (item: BackendSecurityPolicy) => item.targetRefNames.join(', ') || '-',
          },
          {
            id: 'status',
            label: 'Status',
            render: (item: BackendSecurityPolicy) => (
              <PolicyStatusSummary conditions={item.conditions} />
            ),
            getValue: (item: BackendSecurityPolicy) => {
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
