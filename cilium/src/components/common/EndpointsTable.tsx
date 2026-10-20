import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Tooltip } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { CiliumEndpoint, endpointStateHealth } from '../../resources/runtime';
import { CiliumLink, ResourceRefLink } from './ResourceRefLink';
import { HealthLabel } from './Shared';

/** "Ingress" / "Egress" chips showing in which directions policy is enforced. */
export function EnforcementChips({ ingress, egress }: { ingress: boolean; egress: boolean }) {
  const { t } = useText();
  if (!ingress && !egress) {
    return (
      <Tooltip title={t('No policy applies: all traffic is allowed')}>
        <Chip size="small" variant="outlined" label={t('None')} />
      </Tooltip>
    );
  }
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {ingress && <Chip size="small" color="primary" variant="outlined" label={t('Ingress')} />}
      {egress && <Chip size="small" color="primary" variant="outlined" label={t('Egress')} />}
    </Box>
  );
}

export function EndpointState({ state }: { state?: string }) {
  return <HealthLabel health={endpointStateHealth(state)} label={state || 'unknown'} />;
}

/** Table of Cilium endpoints used by the relationship sections. */
export function EndpointsTable({
  endpoints,
  emptyMessage,
  showNamespace = true,
}: {
  endpoints: CiliumEndpoint[];
  emptyMessage?: string;
  showNamespace?: boolean;
}) {
  const { t } = useText();
  return (
    <SimpleTable
      rowsPerPage={[10, 25, 50]}
      emptyMessage={emptyMessage || t('No endpoints.')}
      data={endpoints}
      columns={[
        {
          label: t('Endpoint'),
          getter: (e: CiliumEndpoint) => (
            <CiliumLink
              kind="CiliumEndpoint"
              name={e.metadata.name}
              namespace={e.metadata.namespace}
            />
          ),
          sort: (a: CiliumEndpoint, b: CiliumEndpoint) =>
            a.metadata.name.localeCompare(b.metadata.name),
        },
        ...(showNamespace
          ? [
              {
                label: t('Namespace'),
                getter: (e: CiliumEndpoint) => e.metadata.namespace || '-',
                sort: (a: CiliumEndpoint, b: CiliumEndpoint) =>
                  (a.metadata.namespace || '').localeCompare(b.metadata.namespace || ''),
              },
            ]
          : []),
        {
          label: t('Pod'),
          getter: (e: CiliumEndpoint) => (
            <ResourceRefLink kind="Pod" name={e.metadata.name} namespace={e.metadata.namespace} />
          ),
        },
        {
          label: t('Identity'),
          getter: (e: CiliumEndpoint) =>
            e.identityId !== undefined ? (
              <CiliumLink kind="CiliumIdentity" name={String(e.identityId)} />
            ) : (
              '-'
            ),
        },
        { label: t('IPs'), getter: (e: CiliumEndpoint) => e.addresses.join(', ') || '-' },
        {
          label: t('Enforcement'),
          getter: (e: CiliumEndpoint) => (
            <EnforcementChips ingress={e.ingressEnforcing} egress={e.egressEnforcing} />
          ),
        },
        { label: t('State'), getter: (e: CiliumEndpoint) => <EndpointState state={e.state} /> },
      ]}
    />
  );
}
