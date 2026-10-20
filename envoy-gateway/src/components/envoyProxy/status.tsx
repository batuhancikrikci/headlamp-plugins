import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import type { KubeObject, KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ObjectJson } from '../../resources/types';
import {
  envoyProxyHealth,
  EnvoyProxyReference,
  envoyProxyReferences,
} from '../../utils/envoyProxyStatus';

function rc(kind: string): KubeObjectClass {
  return (K8s.ResourceClasses as Record<string, KubeObjectClass>)[kind];
}

/**
 * Loads GatewayClasses and Gateways once and returns a lookup of the objects that use a given
 * EnvoyProxy. Pass a namespace to only list the Gateways of that namespace.
 */
export function useEnvoyProxyReferences(namespace?: string) {
  const [classes, classesError] = rc('GatewayClass').useList();
  const [gateways, gatewaysError] = rc('Gateway').useList(namespace ? { namespace } : {});
  const loading = (classes === null && !classesError) || (gateways === null && !gatewaysError);
  const classJson: ObjectJson[] = ((classes as KubeObject[] | null) || []).map(c => c.jsonData);
  const gatewayJson: ObjectJson[] = ((gateways as KubeObject[] | null) || []).map(g => g.jsonData);
  return {
    loading,
    referencesOf: (name: string, ns?: string): EnvoyProxyReference[] =>
      envoyProxyReferences({ name, namespace: ns }, classJson, gatewayJson),
  };
}

const HEALTH_STATUS = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: '',
} as const;
const HEALTH_RANK = { error: 0, warning: 1, unknown: 2, success: 3 } as const;

/** Sort value for the status column (failures first). */
export function envoyProxyStatusSortValue(refs: EnvoyProxyReference[]) {
  return `${HEALTH_RANK[envoyProxyHealth(refs).health]}-${refs.length}`;
}

/** Status of an EnvoyProxy, derived from the GatewayClasses / Gateways that reference it. */
export function EnvoyProxyStatusLabel({
  refs,
  loading,
}: {
  refs: EnvoyProxyReference[];
  loading?: boolean;
}) {
  const { t } = useText();
  if (loading) {
    return <StatusLabel status="">{t('Loading…')}</StatusLabel>;
  }
  const h = envoyProxyHealth(refs);
  const tooltip =
    refs.length === 0 ? (
      t('No GatewayClass or Gateway references this EnvoyProxy.')
    ) : (
      <Box>
        {refs.map(r => (
          <Typography key={`${r.kind}/${r.namespace}/${r.name}`} variant="caption" component="div">
            {r.kind} {r.namespace ? `${r.namespace}/` : ''}
            {r.name}:{' '}
            {r.condition
              ? `${r.condition.type}=${r.condition.status}${
                  r.condition.reason ? ` (${r.condition.reason})` : ''
                }`
              : t('No status reported yet')}
          </Typography>
        ))}
      </Box>
    );
  return (
    <Tooltip title={tooltip}>
      <span>
        <StatusLabel status={HEALTH_STATUS[h.health]}>{t(h.key, h.params)}</StatusLabel>
      </span>
    </Tooltip>
  );
}

/** Self-contained status cell for detail pages. */
export function EnvoyProxyStatus({ name, namespace }: { name: string; namespace?: string }) {
  const { loading, referencesOf } = useEnvoyProxyReferences();
  return <EnvoyProxyStatusLabel loading={loading} refs={referencesOf(name, namespace)} />;
}
