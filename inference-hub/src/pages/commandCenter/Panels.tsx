import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { DateLabel, Link, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { t } from '../../common/i18n';
import { ModelCell } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { UsageBar } from '../../components/common/UsageBar';
import { EventJson, eventTime } from '../../components/detail/EventsPanel';
import { ModelEndpoint } from '../../resources/endpoint';
import { DETAIL_PAGES, PAGES } from '../../routes';
import { Health, HEALTH_META } from '../../utils/health';
import { formatPercent, formatRate, formatSeconds } from '../../utils/vllmMetrics';
import { TrafficRow } from './overview';

const SEGMENT_COLORS: Record<Health, string> = {
  ready: 'success.main',
  progressing: 'info.main',
  failed: 'error.main',
  stopped: 'grey.500',
  unknown: 'warning.main',
};

/** Card with a title, an optional "open" link and content. */
export function Panel({
  title,
  icon,
  to,
  children,
}: {
  title: string;
  icon: string;
  to?: string;
  children: React.ReactNode;
}) {
  const history = useHistory();
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Icon icon={icon} width={20} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {title}
        </Typography>
        {to && (
          <Button
            size="small"
            endIcon={<Icon icon="mdi:arrow-right" />}
            onClick={() => history.push(Router.createRouteURL(to))}
          >
            {t('Open')}
          </Button>
        )}
      </Box>
      <Box sx={{ flexGrow: 1 }}>{children}</Box>
    </Paper>
  );
}

/** Stacked bar of endpoint states with a labeled legend (status is never color alone). */
export function HealthBar({ counts }: { counts: Record<Health, number> }) {
  const total = Object.values(counts).reduce((s, v) => s + v, 0);
  const order: Health[] = ['ready', 'progressing', 'failed', 'stopped', 'unknown'];
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          gap: '2px',
          height: 12,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        {total > 0 &&
          order
            .filter(h => counts[h] > 0)
            .map(h => (
              <Tooltip key={h} title={`${t(HEALTH_META[h].label)}: ${counts[h]}`}>
                <Box sx={{ flex: counts[h], bgcolor: SEGMENT_COLORS[h] }} />
              </Tooltip>
            ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
        {order
          .filter(h => counts[h] > 0 || h === 'ready' || h === 'failed')
          .map(h => (
            <Box key={h} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: SEGMENT_COLORS[h] }}
              />
              <Typography variant="body2">
                {t(HEALTH_META[h].label)} <strong>{counts[h]}</strong>
              </Typography>
            </Box>
          ))}
      </Box>
    </Box>
  );
}

/** Endpoints that need attention: failed first, then deploying. */
export function AttentionList({ endpoints }: { endpoints: ModelEndpoint[] }) {
  const items = endpoints
    .filter(
      e =>
        e.status.health === 'failed' ||
        e.status.health === 'progressing' ||
        e.status.health === 'unknown'
    )
    .sort(
      (a, b) => (a.status.health === 'failed' ? -1 : 0) - (b.status.health === 'failed' ? -1 : 0)
    )
    .slice(0, 6);
  if (items.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'success.main', mt: 2 }}>
        <Icon icon="mdi:check-circle-outline" />
        <Typography variant="body2">{t('All endpoints are ready or stopped.')}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map(e => (
        <Box
          key={`${e.slug}/${e.namespace}/${e.name}`}
          sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
        >
          <StatusBadge summary={e.status} />
          <Box sx={{ minWidth: 0 }}>
            <Link
              routeName={DETAIL_PAGES.endpoint.name}
              params={{ slug: e.slug, namespace: e.namespace, name: e.name }}
            >
              {e.namespace}/{e.name}
            </Link>
            {(e.status.message || e.status.reason) && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ wordBreak: 'break-word' }}
              >
                {e.status.message || e.status.reason}
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function TrafficTable({ rows }: { rows: TrafficRow[] }) {
  return (
    <SimpleTable
      data={rows.slice(0, 6)}
      columns={[
        {
          label: t('Endpoint'),
          getter: (r: TrafficRow) =>
            r.endpoint ? (
              <Box>
                <Link
                  routeName={DETAIL_PAGES.endpoint.name}
                  params={{ slug: r.endpoint.slug, namespace: r.namespace, name: r.name }}
                >
                  {r.name}
                </Link>
                <ModelCell model={r.endpoint.model} servedName={r.model} />
              </Box>
            ) : (
              <Box>
                <Link routeName="pod" params={{ namespace: r.namespace, name: r.name }}>
                  {r.name}
                </Link>
                <Typography variant="caption" color="text.secondary" component="div">
                  {r.model}
                </Typography>
              </Box>
            ),
        },
        {
          label: t('Tokens / s'),
          getter: (r: TrafficRow) => formatRate(r.metrics.generationTps, ''),
        },
        {
          label: t('Requests / s'),
          getter: (r: TrafficRow) => formatRate(r.metrics.requestRate, ''),
        },
        {
          label: t('Running / waiting'),
          getter: (r: TrafficRow) => (
            <Typography
              variant="body2"
              color={(r.metrics.waiting || 0) > 0 ? 'warning.main' : undefined}
            >
              {r.metrics.running ?? '—'} / {r.metrics.waiting ?? '—'}
            </Typography>
          ),
        },
        {
          label: t('KV cache'),
          getter: (r: TrafficRow) =>
            r.metrics.kvCachePercent !== undefined ? (
              <UsageBar
                used={r.metrics.kvCachePercent}
                total={100}
                width={40}
                label={formatPercent(r.metrics.kvCachePercent)}
              />
            ) : (
              '—'
            ),
        },
        { label: t('TTFT'), getter: (r: TrafficRow) => formatSeconds(r.metrics.ttftSeconds) },
      ]}
    />
  );
}

export function WarningsList({ events }: { events: EventJson[] }) {
  if (events.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
        <Icon icon="mdi:check-circle-outline" />
        <Typography variant="body2">{t('No recent warnings from AI workloads.')}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {events.map(e => (
        <Box key={e.metadata.uid || e.metadata.name} sx={{ display: 'flex', gap: 1 }}>
          <Box sx={{ color: 'warning.main', pt: 0.25 }}>
            <Icon icon="mdi:alert-outline" width={18} />
          </Box>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {e.reason}{' '}
              <Typography component="span" variant="caption" color="text.secondary">
                {e.involvedObject?.kind}/{e.involvedObject?.name}
                {e.involvedObject?.namespace ? ` · ${e.involvedObject.namespace}` : ''}
              </Typography>
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              {e.message}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {eventTime(e) ? <DateLabel date={eventTime(e)} format="mini" /> : ''}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export const COMMAND_CENTER_LINKS = {
  endpoints: PAGES.endpoints.name,
  gpu: PAGES.gpuFleet.name,
  engines: PAGES.engines.name,
  catalog: PAGES.catalog.name,
  gateway: PAGES.gateway.name,
};
