import { Icon } from '@iconify/react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { PromSeriesResult } from '../../types';
import { backtest, BacktestResult, backtestStep } from '../../utils/backtest';
import { formatSeconds, parsePromDuration } from '../../utils/duration';
import { promQueryRange } from '../../utils/monitoringApi';

const RANGES = [
  { id: '1h', seconds: 3600 },
  { id: '6h', seconds: 6 * 3600 },
  { id: '24h', seconds: 86400 },
  { id: '7d', seconds: 7 * 86400 },
];

/** The Prometheus Operator's default evaluation interval, used when the group sets none. */
const DEFAULT_INTERVAL_SECONDS = 30;
const SHOWN_EPISODES = 10;

const seconds = (duration?: string) => (parsePromDuration(duration) ?? 0) / 1000;

/**
 * "Backtest": when an alerting rule would have fired over a past window, from a range query of
 * its expression. Nothing is saved or sent to Alertmanager.
 */
export function RuleBacktest({
  expr,
  forDuration,
  keepFiringFor,
  interval,
  baseUrl,
}: {
  expr: string;
  forDuration?: string;
  keepFiringFor?: string;
  /** Evaluation interval of the rule group. */
  interval?: string;
  baseUrl: string;
}) {
  const { t } = useText();
  const [range, setRange] = React.useState('24h');
  const [state, setState] = React.useState<{
    loading: boolean;
    error?: string;
    result?: BacktestResult;
    rangeId?: string;
    step?: number;
  }>({ loading: false });

  const run = async () => {
    const window = RANGES.find(r => r.id === range)!;
    const step = backtestStep(window.seconds, seconds(interval) || DEFAULT_INTERVAL_SECONDS);
    const end = Math.floor(Date.now() / 1000);
    setState({ loading: true });
    try {
      const data = await promQueryRange(baseUrl, expr, end - window.seconds, end, step);
      const series = data.resultType === 'matrix' ? (data.result as PromSeriesResult[]) : [];
      setState({
        loading: false,
        rangeId: window.id,
        step,
        result: backtest(series, {
          stepSeconds: step,
          forSeconds: seconds(forDuration),
          keepFiringForSeconds: seconds(keepFiringFor),
          end,
        }),
      });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  };

  const result = state.result;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          select
          size="small"
          label={t('Window')}
          value={range}
          onChange={e => setRange(e.target.value)}
          sx={{ width: 110 }}
        >
          {RANGES.map(r => (
            <MenuItem key={r.id} value={r.id}>
              {r.id}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:history" />}
          onClick={run}
          disabled={!baseUrl || !expr.trim() || state.loading}
        >
          {state.loading ? t('Backtesting…') : t('Backtest')}
        </Button>
      </Box>
      {state.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {state.error}
        </Alert>
      )}
      {result && !state.error && (
        <Alert severity={result.episodes.length ? 'warning' : 'success'} sx={{ mt: 1 }}>
          <Typography variant="body2">
            {result.episodes.length
              ? t(
                  'Would have fired {{count}} time(s) on {{series}} series in the last {{range}}, for {{total}} in total.',
                  {
                    count: result.episodes.length,
                    series: result.series,
                    range: state.rangeId,
                    total: formatSeconds(result.firingSeconds),
                  }
                )
              : t('Would not have fired in the last {{range}}.', { range: state.rangeId })}
          </Typography>
          {result.episodes.slice(-SHOWN_EPISODES).map((e, i) => (
            <Typography
              key={i}
              variant="caption"
              display="block"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
            >
              {new Date(e.start * 1000).toLocaleString()} · {formatSeconds(e.end - e.start)} ·{' '}
              {JSON.stringify(e.labels)}
            </Typography>
          ))}
          {result.episodes.length > SHOWN_EPISODES && (
            <Typography variant="caption" color="text.secondary" display="block">
              {t('The last {{n}} are shown.', { n: SHOWN_EPISODES })}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            {t(
              'Evaluated every {{step}}, as Prometheus would at the group interval; spikes shorter than that may be missed. Nothing is sent to Alertmanager.',
              { step: formatSeconds(state.step) }
            )}
          </Typography>
        </Alert>
      )}
    </Box>
  );
}
