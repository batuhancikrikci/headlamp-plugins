import { DateLabel, Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EmptyState, ForbiddenState } from '../../common/States';
import { podRole } from '../../resources/endpoint';
import { podGpus, podHealth, PodJson, podReadyCount, podRestarts } from '../../resources/pod';
import { StatusBadge } from '../common/StatusBadge';

export function PodsTable({
  pods,
  forbidden,
  emptyHint,
}: {
  pods: PodJson[];
  forbidden?: boolean;
  emptyHint?: string;
}) {
  if (forbidden) return <ForbiddenState what={t('pods')} />;
  if (pods.length === 0) {
    return (
      <EmptyState
        dense
        icon="mdi:cube-off-outline"
        title={t('No pods')}
        description={emptyHint || t('The controller has not created any pods yet.')}
      />
    );
  }
  const sorted = [...pods].sort(
    (a, b) =>
      podRole(a.metadata.labels).localeCompare(podRole(b.metadata.labels)) ||
      a.metadata.name.localeCompare(b.metadata.name)
  );
  return (
    <SimpleTable
      data={sorted}
      columns={[
        {
          label: t('Name'),
          getter: (p: PodJson) => (
            <Link
              routeName="pod"
              params={{ namespace: p.metadata.namespace || '', name: p.metadata.name }}
            >
              {p.metadata.name}
            </Link>
          ),
        },
        {
          label: t('Role'),
          getter: (p: PodJson) => (
            <Chip size="small" variant="outlined" label={podRole(p.metadata.labels)} />
          ),
        },
        { label: t('Status'), getter: (p: PodJson) => <StatusBadge summary={podHealth(p)} /> },
        {
          label: t('Ready'),
          getter: (p: PodJson) => {
            const [ready, total] = podReadyCount(p);
            return `${ready}/${total}`;
          },
        },
        {
          label: t('Restarts'),
          getter: (p: PodJson) => {
            const restarts = podRestarts(p);
            return (
              <Typography variant="body2" color={restarts > 0 ? 'warning.main' : undefined}>
                {restarts}
              </Typography>
            );
          },
        },
        { label: t('GPUs'), getter: (p: PodJson) => podGpus(p) || '—' },
        {
          label: t('Node'),
          getter: (p: PodJson) =>
            p.spec?.nodeName ? (
              <Link routeName="node" params={{ name: p.spec.nodeName }}>
                {p.spec.nodeName}
              </Link>
            ) : (
              '—'
            ),
        },
        {
          label: t('Age'),
          getter: (p: PodJson) =>
            p.metadata.creationTimestamp ? (
              <DateLabel date={p.metadata.creationTimestamp} format="mini" />
            ) : (
              '—'
            ),
        },
      ]}
    />
  );
}
