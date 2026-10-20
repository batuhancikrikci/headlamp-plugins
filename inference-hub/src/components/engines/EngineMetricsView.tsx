import { Icon } from '@iconify/react';
import { Link, NameValueTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Chip, Grid, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { usePromRange } from '../../hooks/usePromQuery';
import { EngineMetricsState } from '../../hooks/useVllmEngines';
import { VllmEngine } from '../../resources/engine';
import { DETAIL_PAGES } from '../../routes';
import {
  aggregate,
  engineRangeQueries,
  formatPercent,
  formatRate,
  formatSeconds,
  VllmMetrics,
} from '../../utils/vllmMetrics';
import { TimeSeriesChart, toPoints } from '../charts/TimeSeriesChart';
import { ExpandableTable } from '../common/ExpandableTable';
import { StatusBadge } from '../common/StatusBadge';
import { SummaryTiles } from '../common/SummaryTiles';
import { UsageBar } from '../common/UsageBar';

export function MetricsSourceNote({
  state,
  intervalLabel,
}: {
  state: EngineMetricsState;
  intervalLabel?: string;
}) {
  if (state.source === 'prometheus') {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<Icon icon="mdi:chart-line" />}
        label={t('Metrics from Prometheus (5 min window)')}
      />
    );
  }
  if (state.source === 'direct') {
    return (
      <Tooltip
        title={t(
          'Prometheus has no vLLM series, so Inference Hub reads /metrics of each engine through the Kubernetes pod proxy. Rates cover the time between two reads.'
        )}
      >
        <Chip
          size="small"
          variant="outlined"
          icon={<Icon icon="mdi:lan-connect" />}
          label={
            intervalLabel ? t('Read from pods {{i}}', { i: intervalLabel }) : t('Read from pods')
          }
        />
      </Tooltip>
    );
  }
  return null;
}

/** Charts over the last hour for the engines selected by a PromQL label matcher. */
export function EngineCharts({ matcher }: { matcher: string }) {
  const q = engineRangeQueries(matcher);
  const tps = usePromRange(q.tps, 3600, 60);
  const kv = usePromRange(q.kv, 3600, 60);
  const ttft = usePromRange(q.ttft, 3600, 60);
  const queue = usePromRange(q.queue, 3600, 60);
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6} xl={3}>
        <TimeSeriesChart
          title={t('Generated tokens / s')}
          points={toPoints(tps.data)}
          format={v => formatRate(v, '')}
        />
      </Grid>
      <Grid item xs={12} md={6} xl={3}>
        <TimeSeriesChart
          title={t('KV cache usage')}
          points={toPoints(kv.data)}
          unit="%"
          max={100}
          format={v => v.toFixed(0)}
        />
      </Grid>
      <Grid item xs={12} md={6} xl={3}>
        <TimeSeriesChart
          title={t('Time to first token')}
          points={toPoints(ttft.data)}
          format={v => formatSeconds(v)}
        />
      </Grid>
      <Grid item xs={12} md={6} xl={3}>
        <TimeSeriesChart
          title={t('Waiting requests')}
          points={toPoints(queue.data)}
          format={v => v.toFixed(0)}
        />
      </Grid>
    </Grid>
  );
}

function MetricsDetail({
  engine,
  metrics,
  error,
}: {
  engine: VllmEngine;
  metrics?: VllmMetrics;
  error?: string;
}) {
  return (
    <Box sx={{ py: 1 }}>
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {t('Could not read metrics from {{pod}}: {{e}}', { pod: engine.pod, e: error })}
        </Alert>
      )}
      <NameValueTable
        rows={[
          { name: t('Image'), value: engine.image },
          {
            name: t('Metrics endpoint'),
            value: `${engine.scheme}://${engine.pod}:${engine.port}/metrics`,
          },
          { name: t('Served model'), value: metrics?.modelName || engine.servedModelName || '—' },
          {
            name: t('Requests running / waiting'),
            value: `${metrics?.running ?? '—'} / ${metrics?.waiting ?? '—'}`,
          },
          { name: t('KV cache usage'), value: formatPercent(metrics?.kvCachePercent) },
          { name: t('Time to first token (mean)'), value: formatSeconds(metrics?.ttftSeconds) },
          { name: t('Inter-token latency (mean)'), value: formatSeconds(metrics?.itlSeconds) },
          { name: t('End-to-end latency (mean)'), value: formatSeconds(metrics?.e2eSeconds) },
          { name: t('Prompt tokens / s'), value: formatRate(metrics?.promptTps) },
          { name: t('Generated tokens / s'), value: formatRate(metrics?.generationTps) },
          { name: t('Finished requests / s'), value: formatRate(metrics?.requestRate) },
          { name: t('Prefix cache hit rate'), value: formatPercent(metrics?.prefixHitPercent) },
          { name: t('Preemptions (total)'), value: metrics?.preemptions ?? '—' },
        ]}
      />
      {metrics && !metrics.windowed && (
        <Typography variant="caption" color="text.secondary">
          {t('Latencies are averages since the engine started; rates appear after the next read.')}
        </Typography>
      )}
    </Box>
  );
}

export function EngineTiles({
  engines,
  state,
}: {
  engines: VllmEngine[];
  state: EngineMetricsState;
}) {
  const all = aggregate(
    engines.map(e => state.metrics.get(e.key)).filter((m): m is VllmMetrics => !!m)
  );
  const ready = engines.filter(e => e.health.health === 'ready').length;
  return (
    <SummaryTiles
      tiles={[
        {
          id: 'engines',
          label: t('Engines ready'),
          value: `${ready}/${engines.length}`,
          icon: 'mdi:engine-outline',
          color: 'primary.main',
        },
        {
          id: 'running',
          label: t('Running requests'),
          value: all.running ?? '—',
          icon: 'mdi:play-circle-outline',
          color: 'info.main',
        },
        {
          id: 'waiting',
          label: t('Waiting requests'),
          value: all.waiting ?? '—',
          icon: 'mdi:timer-sand',
          color: (all.waiting || 0) > 0 ? 'warning.main' : 'text.secondary',
        },
        {
          id: 'kv',
          label: t('Avg. KV cache'),
          value: formatPercent(all.kvCachePercent),
          icon: 'mdi:memory',
          color: 'text.secondary',
        },
        {
          id: 'tps',
          label: t('Tokens / s'),
          value: formatRate(all.generationTps, ''),
          icon: 'mdi:speedometer',
          color: 'text.secondary',
        },
        {
          id: 'ttft',
          label: t('Avg. TTFT'),
          value: formatSeconds(all.ttftSeconds),
          icon: 'mdi:timer-outline',
          color: 'text.secondary',
        },
        {
          id: 'prefix',
          label: t('Prefix cache hits'),
          value: formatPercent(all.prefixHitPercent),
          icon: 'mdi:cached',
          color: 'text.secondary',
        },
      ]}
    />
  );
}

export function EnginesTable({
  engines,
  state,
  showEndpoint = true,
}: {
  engines: VllmEngine[];
  state: EngineMetricsState;
  showEndpoint?: boolean;
}) {
  const m = (e: VllmEngine) => state.metrics.get(e.key);
  return (
    <ExpandableTable<VllmEngine>
      rows={engines}
      getRowId={e => e.key}
      emptyMessage={t('No vLLM engines.')}
      renderDetail={row => (
        <MetricsDetail engine={row} metrics={m(row)} error={state.errors.get(row.key)} />
      )}
      columns={[
        {
          id: 'pod',
          header: t('Engine pod'),
          value: e => e.pod,
          render: row => (
            <Box>
              <Link routeName="pod" params={{ namespace: row.namespace, name: row.pod }}>
                {row.pod}
              </Link>
              <Typography variant="caption" color="text.secondary" component="div">
                {row.namespace} · {row.role}
              </Typography>
            </Box>
          ),
        },
        ...(showEndpoint
          ? [
              {
                id: 'endpoint',
                header: t('Endpoint'),
                value: (e: VllmEngine) => e.endpoint?.name || '',
                render: (row: VllmEngine) =>
                  row.endpoint ? (
                    <Link
                      routeName={DETAIL_PAGES.endpoint.name}
                      params={{
                        slug: row.endpoint.slug,
                        namespace: row.namespace,
                        name: row.endpoint.name,
                      }}
                    >
                      {row.endpoint.name}
                    </Link>
                  ) : (
                    <>—</>
                  ),
              },
            ]
          : []),
        {
          id: 'model',
          header: t('Model'),
          value: e => m(e)?.modelName || e.servedModelName || '',
          render: row => (
            <Box>
              <Typography variant="body2" noWrap sx={{ maxWidth: 220 }}>
                {m(row)?.modelName || row.servedModelName || '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.flavor === 'kserve-hf' ? t('KServe HF runtime') : 'vLLM'} {row.version || ''}
              </Typography>
            </Box>
          ),
        },
        {
          id: 'status',
          header: t('Status'),
          value: e => e.health.health,
          render: row => <StatusBadge summary={row.health} />,
        },
        {
          id: 'requests',
          header: t('Running / waiting'),
          value: e => m(e)?.running ?? -1,
          render: row => {
            const metrics = m(row);
            if (!metrics) {
              return state.errors.has(row.key) ? (
                <Tooltip title={state.errors.get(row.key) || ''}>
                  <Chip size="small" color="warning" variant="outlined" label={t('Unreachable')} />
                </Tooltip>
              ) : (
                <>—</>
              );
            }
            return (
              <Typography
                variant="body2"
                color={(metrics.waiting || 0) > 0 ? 'warning.main' : undefined}
              >
                {metrics.running ?? '—'} / {metrics.waiting ?? '—'}
              </Typography>
            );
          },
        },
        {
          id: 'kv',
          header: t('KV cache'),
          value: e => m(e)?.kvCachePercent ?? -1,
          render: row => {
            const v = m(row)?.kvCachePercent;
            return v !== undefined ? (
              <UsageBar used={v} total={100} width={70} label={formatPercent(v)} />
            ) : (
              <>—</>
            );
          },
        },
        {
          id: 'ttft',
          header: t('TTFT'),
          value: e => m(e)?.ttftSeconds ?? -1,
          render: row => formatSeconds(m(row)?.ttftSeconds),
        },
        {
          id: 'itl',
          header: t('ITL'),
          value: e => m(e)?.itlSeconds ?? -1,
          render: row => formatSeconds(m(row)?.itlSeconds),
        },
        {
          id: 'tps',
          header: t('Tokens / s'),
          value: e => m(e)?.generationTps ?? -1,
          render: row => formatRate(m(row)?.generationTps, ''),
        },
        {
          id: 'prefix',
          header: t('Prefix hits'),
          value: e => m(e)?.prefixHitPercent ?? -1,
          render: row => formatPercent(m(row)?.prefixHitPercent),
        },
        {
          id: 'node',
          header: t('Node / GPUs'),
          value: e => e.node || '',
          render: row =>
            row.node ? (
              <Box>
                <Link routeName="node" params={{ name: row.node }}>
                  {row.node}
                </Link>
                <Typography variant="caption" color="text.secondary" component="div">
                  {t('{{n}} GPU', { n: row.gpus })}
                </Typography>
              </Box>
            ) : (
              <>—</>
            ),
        },
      ]}
    />
  );
}
