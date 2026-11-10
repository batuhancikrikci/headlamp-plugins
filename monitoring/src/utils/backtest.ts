/**
 * Backtest of an alerting rule: when it would have fired over a past window, worked out from a
 * range query of its expression. Pure functions; the range query is made by the caller.
 *
 * Prometheus evaluates a rule at every group interval. A series that the expression returns is
 * pending, and fires once it has been returned at every evaluation for `for`; a missing sample
 * resets it. `keep_firing_for` keeps a firing alert active for that long after the series is
 * gone. The range query step plays the role of the evaluation interval here.
 */
import type { Labels, PromSeriesResult } from '../types';

export interface FiringEpisode {
  labels: Labels;
  /** Unix seconds. */
  start: number;
  end: number;
}

export interface BacktestResult {
  episodes: FiringEpisode[];
  /** Series that fired at least once. */
  series: number;
  /** Seconds of firing, summed over the episodes. */
  firingSeconds: number;
}

/** Step of the range query: the evaluation interval, but at most about 1,000 points per series. */
export function backtestStep(rangeSeconds: number, intervalSeconds: number): number {
  return Math.max(intervalSeconds, Math.ceil(rangeSeconds / 1000));
}

export function backtest(
  series: PromSeriesResult[],
  options: { stepSeconds: number; forSeconds: number; keepFiringForSeconds?: number; end: number }
): BacktestResult {
  const { stepSeconds, forSeconds, keepFiringForSeconds = 0, end } = options;
  const episodes: FiringEpisode[] = [];
  for (const s of series) {
    const times = (s.values || [])
      .filter(([, v]) => v !== 'NaN')
      .map(([t]) => t)
      .sort((a, b) => a - b);
    const runs: Array<[number, number]> = [];
    for (const t of times) {
      const last = runs[runs.length - 1];
      // Samples one step apart (with some slack) are consecutive evaluations.
      if (last && t - last[1] <= stepSeconds * 1.5) last[1] = t;
      else runs.push([t, t]);
    }
    const own: FiringEpisode[] = [];
    for (const [first, last] of runs) {
      const firesAt = first + forSeconds;
      if (firesAt > last) continue;
      const stop = Math.min(end, last + keepFiringForSeconds);
      const previous = own[own.length - 1];
      // keep_firing_for can bridge a gap: the alert never resolved in between.
      if (previous && firesAt <= previous.end) previous.end = Math.max(previous.end, stop);
      else own.push({ labels: s.metric, start: firesAt, end: stop });
    }
    episodes.push(...own);
  }
  episodes.sort((a, b) => a.start - b.start);
  return {
    episodes,
    series: new Set(episodes.map(e => JSON.stringify(e.labels))).size,
    firingSeconds: episodes.reduce((sum, e) => sum + (e.end - e.start), 0),
  };
}
