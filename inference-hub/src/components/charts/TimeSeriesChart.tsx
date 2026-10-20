import { Box, Paper, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PromMatrixSeries } from '../../api/prometheus';
import { t } from '../../common/i18n';

export interface Point {
  ts: number;
  value: number;
}

/** First series of a range query as points (non-numeric samples are dropped). */
export function toPoints(series?: PromMatrixSeries[]): Point[] {
  return (series?.[0]?.values || [])
    .map(([ts, v]) => ({ ts: ts * 1000, value: Number(v) }))
    .filter(p => isFinite(p.value));
}

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Single-series area chart for one measure (the card title names the series, so there is no
 * legend). Values and axes use text colors; only the mark carries the series color.
 */
export function TimeSeriesChart({
  title,
  points,
  unit,
  max,
  format = v => v.toFixed(1),
  height = 160,
  empty,
}: {
  title: string;
  points: Point[];
  unit?: string;
  max?: number;
  format?: (value: number) => string;
  height?: number;
  empty?: React.ReactNode;
}) {
  const theme = useTheme();
  const color = theme.palette.primary.main;
  const last = points[points.length - 1];
  const id = React.useId().replace(/:/g, '');

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        {last && (
          <Typography variant="h6" component="span">
            {format(last.value)}
            {unit}
          </Typography>
        )}
      </Box>
      {points.length < 2 ? (
        <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {empty || t('No data in this time range')}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ height }} role="img" aria-label={t('{{title}} over time', { title })}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke={theme.palette.divider}
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={timeLabel}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                minTickGap={40}
              />
              <YAxis
                domain={[0, max ?? 'auto']}
                tick={{ fill: theme.palette.text.secondary, fontSize: 11 }}
                stroke={theme.palette.divider}
                tickFormatter={v => format(Number(v))}
                width={48}
              />
              <Tooltip
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: number) => [`${format(Number(v))}${unit || ''}`, title]}
                contentStyle={{
                  background: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`,
                  color: theme.palette.text.primary,
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#fill-${id})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: theme.palette.background.paper }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
}
