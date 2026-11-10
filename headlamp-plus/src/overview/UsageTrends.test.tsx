import { render, screen } from '@testing-library/react';

// The Prometheus service behind the Kubernetes API proxy is the external dependency.
const proxy = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  ApiProxy: {
    request: async (path: string) => {
      proxy.requests.push(path);
      if (path === '/api/v1/services') {
        return {
          items: [
            {
              metadata: { namespace: 'monitoring', name: 'prometheus-operated' },
              spec: { ports: [{ port: 9090 }] },
            },
          ],
        };
      }
      if (path.includes('/query?')) {
        return { status: 'success', data: { result: [{ metric: {}, value: [0, '1'] }] } };
      }
      const memory = path.includes('memory');
      return {
        status: 'success',
        data: {
          result: [
            {
              metric: {},
              values: [
                [1000, memory ? String(8 * 2 ** 30) : '1.5'],
                [1060, memory ? String(12 * 2 ** 30) : '2.25'],
              ],
            },
          ],
        },
      };
    },
  },
  K8s: { useCluster: () => 'trend-test' },
}));

// recharts measures the DOM, which jsdom does not lay out; the chart itself is not under test.
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>();
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ...actual,
    ResponsiveContainer: Passthrough,
    AreaChart: Passthrough,
    Area: Empty,
    CartesianGrid: Empty,
    ReferenceLine: Empty,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

import { UsageTrends } from './UsageTrends';

describe('UsageTrends', () => {
  it('finds Prometheus and shows the latest and peak usage', async () => {
    render(
      <UsageTrends cpuCapacity={16} memoryCapacity={64 * 2 ** 30} capacityLabel="allocatable" />
    );
    expect(await screen.findByText('2.3 cores')).toBeTruthy();
    expect(screen.getByText('12 GiB')).toBeTruthy();
    expect(screen.getByText(/From monitoring\/prometheus-operated:9090/)).toBeTruthy();
    const range = proxy.requests.find(p => p.includes('query_range'))!;
    expect(decodeURIComponent(range)).toContain('container_cpu_usage_seconds_total');
  });
});
