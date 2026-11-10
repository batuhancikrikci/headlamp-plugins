/**
 * "Usage trend" panel of the cluster and namespace dashboards: CPU and memory used over the last
 * hour to week, from Prometheus. Shown only when a Prometheus compatible service answers; the
 * service can also be entered by hand for the session.
 */
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Box, CircularProgress, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cardGrid, Panel } from './blocks';
import { formatCores, formatGiB } from './clusterHealth';
import { PrometheusEndpoint, promRange } from './prometheus';
import {
  RANGES,
  rangeWindow,
  summarize,
  timeLabel,
  toPoints,
  TrendPoint,
  trendQueries,
  TrendRange,
} from './trends';
import { ServicePicker, usePrometheus } from './usePrometheus';

/** Categorical slot 1 of the reference palette, stepped per mode. */
const SERIES_COLOR = { light: '#2a78d6', dark: '#3987e5' };

interface Trends {
  cpu: TrendPoint[];
  memory: TrendPoint[];
}

function useTrends(
  endpoint: PrometheusEndpoint | undefined,
  cluster: string,
  range: TrendRange,
  namespace?: string,
  node?: string
): { data?: Trends; error?: string; loading: boolean } {
  const [state, setState] = React.useState<{ data?: Trends; error?: string; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  React.useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    const { start, end, step } = rangeWindow(range);
    const queries = trendQueries(namespace, step, node);
    setState(s => ({ ...s, loading: true }));
    Promise.all([
      promRange(endpoint, queries.cpu, start, end, step, cluster),
      promRange(endpoint, queries.memory, start, end, step, cluster),
    ])
      .then(
        ([cpu, memory]) =>
          !cancelled &&
          setState({ data: { cpu: toPoints(cpu), memory: toPoints(memory) }, loading: false })
      )
      .catch(err => !cancelled && setState({ error: (err as Error).message, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [endpoint?.base, cluster, range, namespace, node, tick]);
  return state;
}

function TrendChart({
  title,
  points,
  range,
  format,
  unit,
  capacity,
  capacityLabel,
}: {
  title: string;
  points: TrendPoint[];
  range: TrendRange;
  format: (value: number) => string;
  unit: string;
  capacity?: number;
  capacityLabel: string;
}) {
  const theme = useTheme();
  const color = SERIES_COLOR[theme.palette.mode === 'dark' ? 'dark' : 'light'];
  const summary = summarize(points);
  const id = React.useId().replace(/:/g, '');
  const top = Math.max(summary?.max ?? 0, capacity ?? 0) * 1.05 || 1;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {summary && (
          <Typography variant="body2" color="text.secondary">
            now{' '}
            <Box component="strong" sx={{ color: 'text.primary' }}>
              {format(summary.last)} {unit}
            </Box>{' '}
            · peak {format(summary.max)} {unit}
          </Typography>
        )}
      </Box>
      {points.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
          No samples in this range. The trend needs the kubelet's cAdvisor metrics in Prometheus.
        </Typography>
      ) : (
        <Box sx={{ height: 180 }} role="img" aria-label={`${title} over the last ${range}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={theme.palette.divider} strokeDasharray="0" vertical={false} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={ts => timeLabel(ts, range)}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                minTickGap={40}
              />
              <YAxis
                domain={[0, top]}
                tickFormatter={v => format(v)}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                width={48}
              />
              <Tooltip
                cursor={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }}
                contentStyle={{
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  color: theme.palette.text.primary,
                  fontSize: 12,
                }}
                labelFormatter={ts => new Date(Number(ts)).toLocaleString()}
                formatter={(v: number) => [`${format(v)} ${unit}`, title]}
              />
              {capacity !== undefined && (
                <ReferenceLine
                  y={capacity}
                  stroke={theme.palette.text.secondary}
                  strokeDasharray="4 4"
                  label={{
                    value: `${capacityLabel} ${format(capacity)}`,
                    position: 'insideTopLeft',
                    fill: theme.palette.text.secondary,
                    fontSize: 11,
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#fill-${id})`}
                isAnimationActive={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
  );
}

/**
 * CPU and memory used over time by the whole cluster or by one namespace, with the allocatable
 * capacity or the quota as a dashed line.
 */
export function UsageTrends({
  namespace,
  node,
  cpuCapacity,
  memoryCapacity,
  capacityLabel,
}: {
  namespace?: string;
  node?: string;
  /** Cores. */
  cpuCapacity?: number;
  /** Bytes. */
  memoryCapacity?: number;
  /** Name of the dashed line, e.g. "allocatable" or "quota". */
  capacityLabel: string;
}) {
  const cluster = K8s.useCluster() || '';
  const [prom, choose] = usePrometheus(cluster);
  const [range, setRange] = React.useState<TrendRange>('6h');
  const trends = useTrends(
    prom.status === 'ready' ? prom.endpoint : undefined,
    cluster,
    range,
    namespace,
    node
  );

  return (
    <Panel
      title="Usage trend"
      icon="mdi:chart-areaspline"
      action={
        prom.status === 'ready' && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={range}
            onChange={(_, v) => v && setRange(v)}
            aria-label="Time range"
          >
            {RANGES.map(r => (
              <ToggleButton key={r} value={r} sx={{ py: 0.25, px: 1 }}>
                {r}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )
      }
    >
      {prom.status === 'loading' ? (
        <CircularProgress size={20} />
      ) : prom.status === 'missing' ? (
        <ServicePicker onChoose={choose} needs="the kubelet's cAdvisor metrics" />
      ) : trends.error ? (
        <Typography variant="body2" color="error">
          <Icon icon="mdi:alert-circle" width={16} style={{ verticalAlign: 'middle' }} />{' '}
          {trends.error}
        </Typography>
      ) : !trends.data ? (
        <CircularProgress size={20} />
      ) : (
        <>
          <Box sx={cardGrid(320)}>
            <TrendChart
              title="CPU used"
              points={trends.data.cpu}
              range={range}
              format={formatCores}
              unit="cores"
              capacity={cpuCapacity}
              capacityLabel={capacityLabel}
            />
            <TrendChart
              title="Memory used"
              points={trends.data.memory}
              range={range}
              format={formatGiB}
              unit="GiB"
              capacity={memoryCapacity}
              capacityLabel={capacityLabel}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            From {prom.endpoint.label}: container usage reported by the kubelets (cAdvisor).
          </Typography>
        </>
      )}
    </Panel>
  );
}
