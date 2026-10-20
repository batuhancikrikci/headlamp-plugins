import { groupDcgm, metricsForNode, seriesNode } from './dcgm';

const sample = (metric: Record<string, string>, value: number) => ({
  metric,
  value: [1700000000, String(value)] as [number, string],
});

describe('DCGM metrics', () => {
  it('groups series by node and GPU and averages per node', () => {
    const grouped = groupDcgm({
      util: [
        sample({ Hostname: 'gpu-1', gpu: '0', UUID: 'GPU-a', modelName: 'NVIDIA H100' }, 80),
        sample({ Hostname: 'gpu-1', gpu: '1', UUID: 'GPU-b' }, 40),
        sample({ node: 'gpu-2', gpu: '0', UUID: 'GPU-c', pod: 'qwen-0', namespace: 'ai' }, 10),
      ],
      memUsed: [sample({ Hostname: 'gpu-1', gpu: '0', UUID: 'GPU-a' }, 1000)],
      memFree: [sample({ Hostname: 'gpu-1', gpu: '0', UUID: 'GPU-a' }, 3000)],
      power: [sample({ Hostname: 'gpu-1', gpu: '0', UUID: 'GPU-a' }, 'NaN' as unknown as number)],
    });
    const node1 = grouped.get('gpu-1');
    expect(node1?.gpus.map(g => g.id)).toEqual(['0', '1']);
    expect(node1?.avg.util).toBe(60);
    expect(node1?.avg.memUsedMiB).toBe(1000);
    expect(node1?.gpus[0]).toMatchObject({ model: 'NVIDIA H100', memFreeMiB: 3000 });
    expect(node1?.avg.powerW).toBeUndefined();
    expect(grouped.get('gpu-2')?.gpus[0]).toMatchObject({ pod: 'qwen-0', namespace: 'ai' });
  });

  it('matches short and fully qualified node names', () => {
    const grouped = groupDcgm({ util: [sample({ Hostname: 'gpu-1.example.com', gpu: '0' }, 5)] });
    expect(metricsForNode(grouped, 'gpu-1')?.avg.util).toBe(5);
    expect(metricsForNode(grouped, 'gpu-2')).toBeUndefined();
  });

  it('falls back to the instance label', () => {
    expect(seriesNode({ instance: '10.0.0.5:9400' })).toBe('10.0.0.5');
  });
});
