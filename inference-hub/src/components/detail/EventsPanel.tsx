import { DateLabel, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Chip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '../../common/States';
import { useCoreList } from '../../hooks/useLive';
import { KubeJson } from '../../resources/types';

export interface EventJson extends KubeJson {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  firstTimestamp?: string;
  involvedObject?: { kind?: string; name?: string; namespace?: string };
  series?: { count?: number; lastObservedTime?: string };
}

export function eventTime(e: EventJson): string {
  return (
    e.series?.lastObservedTime ||
    e.lastTimestamp ||
    e.eventTime ||
    e.firstTimestamp ||
    e.metadata.creationTimestamp ||
    ''
  );
}

/**
 * Events of a namespace whose involved object matches `match` (e.g. the endpoint and its
 * pods and child objects), newest first.
 */
export function EventsPanel({
  namespace,
  match,
  limit = 100,
}: {
  namespace: string;
  match: (e: EventJson) => boolean;
  limit?: number;
}) {
  const events = useCoreList<EventJson>('v1', 'events', true, { namespace });
  if (events.forbidden) return <ForbiddenState what={t('events')} />;
  if (events.loading) return <LoadingState title={t('Loading events…')} />;
  if (events.error && events.items.length === 0) return <ErrorState error={events.error} />;

  const rows = events.items
    .filter(match)
    .sort((a, b) => eventTime(b).localeCompare(eventTime(a)))
    .slice(0, limit);
  if (rows.length === 0) {
    return (
      <EmptyState
        dense
        icon="mdi:calendar-blank-outline"
        title={t('No recent events')}
        description={t('Kubernetes keeps events for about an hour by default.')}
      />
    );
  }
  return (
    <SimpleTable
      data={rows}
      columns={[
        {
          label: t('Type'),
          getter: (e: EventJson) => (
            <Chip
              size="small"
              variant="outlined"
              color={e.type === 'Warning' ? 'warning' : 'default'}
              label={e.type || 'Normal'}
            />
          ),
        },
        { label: t('Reason'), getter: (e: EventJson) => e.reason || '—' },
        {
          label: t('Object'),
          getter: (e: EventJson) =>
            `${e.involvedObject?.kind || ''}/${e.involvedObject?.name || ''}`,
        },
        {
          label: t('Message'),
          getter: (e: EventJson) => (
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {e.message}
            </Typography>
          ),
        },
        { label: t('Count'), getter: (e: EventJson) => e.series?.count || e.count || 1 },
        {
          label: t('Last seen'),
          getter: (e: EventJson) =>
            eventTime(e) ? <DateLabel date={eventTime(e)} format="mini" /> : '—',
        },
      ]}
    />
  );
}
