import { fireEvent, render, screen } from '@testing-library/react';
import { RuleBacktest } from './RuleBacktest';

// Prometheus is the external dependency: the range query returns one series that held for
// ten minutes, sampled at the step the backtest asked for.
const prometheus = vi.hoisted(() => ({ calls: [] as Array<{ query: string; step: number }> }));
vi.mock('../../utils/monitoringApi', () => ({
  promQueryRange: async (
    _base: string,
    query: string,
    _start: number,
    end: number,
    step: number
  ) => {
    prometheus.calls.push({ query, step });
    const from = end - 3600;
    return {
      resultType: 'matrix',
      result: [
        {
          metric: { pod: 'web-1' },
          values: Array.from({ length: Math.floor(600 / step) + 1 }, (_, i) => [
            from + i * step,
            '1',
          ]),
        },
      ],
    };
  },
}));

beforeEach(() => {
  prometheus.calls = [];
});

describe('RuleBacktest', () => {
  it('reports when the alert would have fired, evaluated at the group interval', async () => {
    render(<RuleBacktest expr="up == 0" forDuration="5m" interval="1m" baseUrl="/prometheus" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backtest' }));
    expect(
      await screen.findByText(/Would have fired 1 time\(s\) on 1 series in the last 24h/)
    ).toBeTruthy();
    expect(prometheus.calls).toEqual([{ query: 'up == 0', step: 87 }]);
  });

  it('says so when the alert would not have fired', async () => {
    render(<RuleBacktest expr="up == 0" forDuration="1h" interval="1m" baseUrl="/prometheus" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backtest' }));
    expect(await screen.findByText('Would not have fired in the last 24h.')).toBeTruthy();
  });

  it('needs a Prometheus and an expression', () => {
    render(<RuleBacktest expr="" baseUrl="" />);
    expect((screen.getByRole('button', { name: 'Backtest' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
