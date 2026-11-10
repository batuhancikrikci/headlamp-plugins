import { describe, expect, it } from 'vitest';
import { backtest, backtestStep } from './backtest';

const STEP = 60;

/** A series returned at the given minutes (relative to 0). */
function series(minutes: number[], labels: Record<string, string> = { pod: 'a' }) {
  return { metric: labels, values: minutes.map(m => [m * 60, '1'] as [number, string]) };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('backtest', () => {
  it('fires once the condition held for the `for` duration', () => {
    const result = backtest([series(range(0, 9))], {
      stepSeconds: STEP,
      forSeconds: 5 * 60,
      end: 3600,
    });
    expect(result.episodes).toEqual([{ labels: { pod: 'a' }, start: 300, end: 540 }]);
    expect(result.firingSeconds).toBe(240);
  });

  it('does not fire for spikes shorter than `for`, and a gap resets the wait', () => {
    const result = backtest([series([...range(0, 3), ...range(5, 8)])], {
      stepSeconds: STEP,
      forSeconds: 5 * 60,
      end: 3600,
    });
    expect(result.episodes).toEqual([]);
  });

  it('fires at the first evaluation without `for`, and counts series separately', () => {
    const result = backtest([series([10]), series([10, 11], { pod: 'b' })], {
      stepSeconds: STEP,
      forSeconds: 0,
      end: 3600,
    });
    expect(result.episodes).toHaveLength(2);
    expect(result.series).toBe(2);
  });

  it('keeps firing for keep_firing_for and bridges short gaps with it', () => {
    const result = backtest([series([...range(0, 2), ...range(5, 6)])], {
      stepSeconds: STEP,
      forSeconds: 0,
      keepFiringForSeconds: 5 * 60,
      end: 3600,
    });
    expect(result.episodes).toEqual([{ labels: { pod: 'a' }, start: 0, end: 660 }]);
  });

  it('ignores NaN samples', () => {
    const nan = { metric: { pod: 'a' }, values: [[0, 'NaN'] as [number, string]] };
    expect(backtest([nan], { stepSeconds: STEP, forSeconds: 0, end: 60 }).episodes).toEqual([]);
  });
});

describe('backtestStep', () => {
  it('uses the evaluation interval unless that gives too many points', () => {
    expect(backtestStep(86400, 60)).toBe(87);
    expect(backtestStep(3600, 30)).toBe(30);
  });
});
