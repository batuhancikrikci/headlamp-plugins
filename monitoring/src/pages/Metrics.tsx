import { Icon } from '@iconify/react';
import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CategoricalChartState } from 'recharts/types/chart/types';
import { useText } from '../common/i18n';
import { EmptyState } from '../common/States';
import { CodeBlock } from '../components/common/CodeBlock';
import { ApiErrorAlert } from '../components/common/Feedback';
import { EndpointGate, InstanceBar } from '../components/common/InstanceBar';
import { usePrometheusEndpoint } from '../hooks/useMonitoringEndpoint';
import { usePolling } from '../hooks/usePolling';
import { useQueryParam } from '../hooks/useQueryParam';
import { PromQueryData, PromSeriesResult } from '../types';
import { promLabelValues, promQuery, promQueryRange } from '../utils/monitoringApi';

const { SectionBox, SimpleTable } = CommonComponents;

/** Categorical data colors (distinguishable in light and dark themes). */
const SERIES_COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
];
const MAX_CHART_SERIES = 50;
const HISTORY_KEY = 'monitoring.queryHistory';

const RANGES = [
  { value: '5m', seconds: 300 },
  { value: '15m', seconds: 900 },
  { value: '30m', seconds: 1800 },
  { value: '1h', seconds: 3600 },
  { value: '3h', seconds: 10800 },
  { value: '6h', seconds: 21600 },
  { value: '12h', seconds: 43200 },
  { value: '1d', seconds: 86400 },
  { value: '7d', seconds: 604800 },
];

const REFRESH = [0, 10, 30, 60, 300];

function loadHistory(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function pushHistory(query: string): string[] {
  const next = [query, ...loadHistory().filter(q => q !== query)].slice(0, 15);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: history just isn't persisted.
  }
  return next;
}

export function seriesName(metric: Record<string, string>): string {
  const { __name__: name, ...rest } = metric || {};
  const labels = Object.entries(rest)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');
  if (!name && !labels) return '{}';
  return `${name || ''}{${labels}}`;
}

/** Token under the cursor at the end of the input (for metric name completion). */
function lastToken(input: string): string {
  const m = input.match(/[a-zA-Z_:][a-zA-Z0-9_:]*$/);
  return m ? m[0] : '';
}

function formatTick(ts: number, rangeSeconds: number) {
  const d = new Date(ts * 1000);
  if (rangeSeconds > 86400) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatValue(v: number | string | undefined): string {
  if (v === undefined || v === null) return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) return n.toExponential(3);
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

interface ChartModel {
  data: Array<Record<string, number>>;
  series: Array<{ key: string; name: string; color: string }>;
  truncated: boolean;
}

function toChartModel(result: PromSeriesResult[]): ChartModel {
  const truncated = result.length > MAX_CHART_SERIES;
  const shown = result.slice(0, MAX_CHART_SERIES);
  const points = new Map<number, Record<string, number>>();
  const series = shown.map((s, i) => {
    const key = `s${i}`;
    for (const [ts, val] of s.values || []) {
      const row = points.get(ts) || { time: ts };
      row[key] = Number(val);
      points.set(ts, row);
    }
    return { key, name: seriesName(s.metric), color: SERIES_COLORS[i % SERIES_COLORS.length] };
  });
  const data = [...points.values()].sort((a, b) => a.time - b.time);
  return { data, series, truncated };
}

interface PinnedPoint {
  id: number;
  time: number;
  values: Array<{ name: string; value: number; color: string }>;
}

export default function Metrics() {
  const { t } = useText();
  const theme = useTheme();
  const prom = usePrometheusEndpoint();

  const [urlQuery, setUrlQuery] = useQueryParam('q', 'up');
  const [rangeParam, setRangeParam] = useQueryParam('range', '1h');
  const [view, setView] = useQueryParam('view', 'graph');
  const [draft, setDraft] = useState(urlQuery);
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pins, setPins] = useState<PinnedPoint[]>([]);

  // Keep the editor in sync when the URL changes (back/forward, shared link).
  useEffect(() => setDraft(urlQuery), [urlQuery]);

  const rangeSeconds = RANGES.find(r => r.value === rangeParam)?.seconds || 3600;

  const metricNames = usePolling(
    prom.baseUrl ? () => promLabelValues(prom.baseUrl, '__name__') : null,
    [prom.baseUrl]
  );

  const result = usePolling<{ instant: PromQueryData; range: PromQueryData | null }>(
    prom.baseUrl && urlQuery
      ? async () => {
          const end = Math.floor(Date.now() / 1000);
          const step = Math.max(1, Math.ceil(rangeSeconds / 250));
          const [instant, range] = await Promise.all([
            promQuery(prom.baseUrl, urlQuery),
            view === 'graph'
              ? promQueryRange(prom.baseUrl, urlQuery, end - rangeSeconds, end, step)
              : Promise.resolve(null),
          ]);
          return { instant, range };
        }
      : null,
    [prom.baseUrl, urlQuery, rangeSeconds, view],
    refresh * 1000
  );

  useEffect(() => {
    setHidden(new Set());
    setPins([]);
  }, [urlQuery]);

  const run = () => {
    const q = draft.trim();
    if (!q) return;
    setHistory(pushHistory(q));
    if (q === urlQuery) result.refresh();
    else setUrlQuery(q);
  };

  const chart = useMemo(() => {
    const range = result.data?.range;
    if (!range || range.resultType !== 'matrix') return null;
    return toChartModel(range.result as PromSeriesResult[]);
  }, [result.data]);

  const instant = result.data?.instant;
  const vector: PromSeriesResult[] =
    instant && (instant.resultType === 'vector' || instant.resultType === 'matrix')
      ? (instant.result as PromSeriesResult[])
      : [];
  const scalar =
    instant && (instant.resultType === 'scalar' || instant.resultType === 'string')
      ? (instant.result as [number, string])[1]
      : null;
  const colorFor = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

  const token = lastToken(draft);
  const suggestions = useMemo(() => {
    if (token.length < 2) return [];
    const lower = token.toLowerCase();
    return (metricNames.data || [])
      .filter(n => n.toLowerCase().includes(lower) && n !== token)
      .slice(0, 50);
  }, [metricNames.data, token]);

  const gate = <EndpointGate kind="Prometheus" ep={prom} />;
  const blocked = prom.loading || prom.error || prom.notFound || !prom.baseUrl;

  return (
    <SectionBox title={t('Metrics Explorer')}>
      {blocked ? (
        gate
      ) : (
        <>
          <InstanceBar
            kind="Prometheus"
            ep={prom}
            onRefresh={result.refresh}
            refreshing={result.refreshing}
            lastUpdated={result.lastUpdated}
          />
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Autocomplete
              freeSolo
              disableClearable
              options={suggestions}
              filterOptions={o => o}
              inputValue={draft}
              onInputChange={(_, value, reason) => {
                if (reason === 'input') setDraft(value);
              }}
              onChange={(_, value) => {
                if (typeof value === 'string' && value) {
                  setDraft(prev => prev.slice(0, prev.length - lastToken(prev).length) + value);
                }
              }}
              sx={{ flex: 1, minWidth: 320 }}
              renderInput={params => (
                <TextField
                  {...params}
                  label={t('PromQL expression')}
                  size="small"
                  multiline
                  maxRows={6}
                  onKeyDown={e => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !params.inputProps['aria-activedescendant']
                    ) {
                      e.preventDefault();
                      run();
                    }
                  }}
                  inputProps={{ ...params.inputProps, style: { fontFamily: 'monospace' } }}
                  helperText={t(
                    'Enter to run, Shift+Enter for a new line. Type 2+ characters for metric names.'
                  )}
                />
              )}
            />
            <TextField
              select
              size="small"
              label={t('Range')}
              value={rangeParam}
              onChange={e => setRangeParam(e.target.value)}
              sx={{ width: 110 }}
            >
              {RANGES.map(r => (
                <MenuItem key={r.value} value={r.value}>
                  {r.value}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('Auto refresh')}
              value={refresh}
              onChange={e => setRefresh(Number(e.target.value))}
              sx={{ width: 130 }}
            >
              {REFRESH.map(s => (
                <MenuItem key={s} value={s}>
                  {s === 0 ? t('Off') : s < 60 ? `${s}s` : `${s / 60}m`}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              onClick={run}
              disabled={!draft.trim()}
              startIcon={<Icon icon="mdi:play" />}
              sx={{ height: 40 }}
            >
              {t('Run')}
            </Button>
          </Box>

          {history.length > 0 && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
              <Icon icon="mdi:history" aria-label={t('Recent queries')} />
              {history.slice(0, 6).map(q => (
                <Chip
                  key={q}
                  size="small"
                  variant="outlined"
                  label={q.length > 60 ? `${q.slice(0, 57)}…` : q}
                  title={q}
                  onClick={() => {
                    setDraft(q);
                    setUrlQuery(q);
                  }}
                  sx={{ fontFamily: 'monospace' }}
                />
              ))}
            </Box>
          )}

          <ApiErrorAlert error={result.error} />

          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs
              value={
                ['graph', 'table', 'raw'].indexOf(view) < 0
                  ? 0
                  : ['graph', 'table', 'raw'].indexOf(view)
              }
              onChange={(_, v) => setView(['graph', 'table', 'raw'][v])}
            >
              <Tab
                label={t('Graph')}
                icon={<Icon icon="mdi:chart-timeline-variant" />}
                iconPosition="start"
              />
              <Tab label={t('Table')} icon={<Icon icon="mdi:table-large" />} iconPosition="start" />
              <Tab label={t('Raw')} icon={<Icon icon="mdi:code-json" />} iconPosition="start" />
            </Tabs>
          </Box>

          {result.loading && !result.data ? (
            <Typography color="text.secondary">{t('Loading…')}</Typography>
          ) : view === 'raw' ? (
            <CodeBlock code={JSON.stringify(result.data || {}, null, 2)} maxHeight={500} />
          ) : scalar !== null ? (
            <Typography variant="h4" sx={{ fontFamily: 'monospace', my: 2 }}>
              {formatValue(scalar)}
            </Typography>
          ) : view === 'table' ? (
            <SimpleTable
              data={vector.map((s, i) => ({ ...s, i }))}
              emptyMessage={t('Empty query result')}
              columns={[
                {
                  label: t('Series'),
                  getter: (s: PromSeriesResult & { i: number }) => (
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: '2px',
                          flexShrink: 0,
                          bgcolor: colorFor(s.i),
                        }}
                      />
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                      >
                        {seriesName(s.metric)}
                      </Typography>
                    </Box>
                  ),
                  sort: (a: PromSeriesResult, b: PromSeriesResult) =>
                    seriesName(a.metric).localeCompare(seriesName(b.metric)),
                },
                {
                  label: t('Value'),
                  getter: (s: PromSeriesResult) => formatValue(s.value?.[1]),
                  cellProps: { align: 'right' },
                  sort: (a: PromSeriesResult, b: PromSeriesResult) =>
                    Number(a.value?.[1] ?? 0) - Number(b.value?.[1] ?? 0),
                },
              ]}
            />
          ) : !chart || chart.series.length === 0 ? (
            <EmptyState
              icon="mdi:chart-line"
              title={t('Empty query result')}
              description={t('The query returned no series in the selected range.')}
            />
          ) : (
            <>
              {chart.truncated && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  {t(
                    'Showing the first {{count}} series. Narrow the query (e.g. with topk or label filters) to see all.',
                    {
                      count: MAX_CHART_SERIES,
                    }
                  )}
                </Alert>
              )}
              <Typography variant="caption" color="text.secondary">
                {t('Click the chart to pin values; click a legend entry to hide/show a series.')}
              </Typography>
              <Box sx={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chart.data}
                    margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                    onClick={(e: CategoricalChartState) => {
                      const payload = e?.activePayload as PinnedPoint['values'] | undefined;
                      if (!payload?.length) return;
                      setPins(prev =>
                        [
                          {
                            id: Date.now(),
                            time: Number(e.activeLabel),
                            values: payload.map(p => ({
                              name: p.name,
                              value: p.value,
                              color: p.color,
                            })),
                          },
                          ...prev,
                        ].slice(0, 5)
                      );
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                    <XAxis
                      dataKey="time"
                      type="number"
                      scale="time"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={v => formatTick(v, rangeSeconds)}
                      tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                      stroke={theme.palette.divider}
                      minTickGap={40}
                    />
                    <YAxis
                      tickFormatter={v => formatValue(v)}
                      tick={{ fontSize: 11, fill: theme.palette.text.secondary }}
                      stroke={theme.palette.divider}
                      width={70}
                    />
                    <Tooltip
                      labelFormatter={v => new Date(Number(v) * 1000).toLocaleString()}
                      formatter={(v: number) => formatValue(v)}
                      wrapperStyle={{ zIndex: 10, maxWidth: 420 }}
                      contentStyle={{
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        color: theme.palette.text.primary,
                        fontSize: 12,
                        whiteSpace: 'normal',
                        maxHeight: 260,
                        overflow: 'auto',
                      }}
                    />
                    {chart.series.map(s => (
                      <Line
                        key={s.key}
                        name={s.name}
                        dataKey={s.key}
                        stroke={s.color}
                        strokeWidth={1.75}
                        dot={false}
                        isAnimationActive={false}
                        hide={hidden.has(s.key)}
                        connectNulls={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.25,
                  mt: 1,
                  maxHeight: 180,
                  overflow: 'auto',
                }}
              >
                {chart.series.map(s => {
                  const off = hidden.has(s.key);
                  return (
                    <Box
                      key={s.key}
                      component="button"
                      type="button"
                      onClick={() =>
                        setHidden(prev => {
                          const next = new Set(prev);
                          if (next.has(s.key)) next.delete(s.key);
                          else next.add(s.key);
                          return next;
                        })
                      }
                      aria-pressed={!off}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        border: 0,
                        background: 'none',
                        p: 0.25,
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'text.primary',
                        opacity: off ? 0.4 : 1,
                      }}
                    >
                      <Box sx={{ width: 12, height: 3, bgcolor: s.color, flexShrink: 0 }} />
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                      >
                        {s.name}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
              {pins.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('Pinned values')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {pins.map(pin => (
                      <Box
                        key={pin.id}
                        sx={{
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1,
                          minWidth: 240,
                          maxWidth: 420,
                          maxHeight: 220,
                          overflow: 'auto',
                        }}
                      >
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Typography variant="caption" fontWeight={600}>
                            {new Date(pin.time * 1000).toLocaleString()}
                          </Typography>
                          <MuiTooltip title={t('Unpin')}>
                            <IconButton
                              size="small"
                              aria-label={t('Unpin')}
                              onClick={() => setPins(prev => prev.filter(p => p.id !== pin.id))}
                            >
                              <Icon icon="mdi:pin-off" width={16} />
                            </IconButton>
                          </MuiTooltip>
                        </Box>
                        {pin.values.map(v => (
                          <Typography
                            key={v.name}
                            variant="caption"
                            display="block"
                            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                          >
                            <Box component="span" sx={{ color: v.color }}>
                              ■
                            </Box>{' '}
                            {formatValue(v.value)} — {v.name}
                          </Typography>
                        ))}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </>
      )}
    </SectionBox>
  );
}
