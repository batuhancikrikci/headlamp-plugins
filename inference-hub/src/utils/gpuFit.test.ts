import {
  buildInventory,
  gpuDraDrivers,
  NodeJson,
  podGpuRequests,
  ResourceSliceJson,
  sharingLabel,
  totals,
} from '../resources/gpu';
import { PodJson } from '../resources/pod';
import { bytesPerParam, checkFit, estimateServingMemory, gpusForMemory } from './gpuFit';

function node(
  name: string,
  gpus: number,
  labels: Record<string, string> = {},
  extra: Partial<NodeJson> = {}
): NodeJson {
  return {
    metadata: {
      name,
      labels: {
        'nvidia.com/gpu.product': 'NVIDIA-H100-80GB-HBM3',
        'nvidia.com/gpu.memory': '81559',
        'nvidia.com/gpu.count': String(gpus),
        'nvidia.com/cuda.driver-version.full': '580.65.06',
        ...labels,
      },
    },
    status: {
      capacity: { cpu: '64', 'nvidia.com/gpu': String(gpus) },
      allocatable: { cpu: '63', 'nvidia.com/gpu': String(gpus) },
      conditions: [{ type: 'Ready', status: 'True' }],
    },
    ...extra,
  };
}

function gpuPod(
  name: string,
  nodeName: string,
  gpus: number,
  phase = 'Running',
  labels = {}
): PodJson {
  return {
    metadata: { name, namespace: 'ai', labels },
    spec: {
      nodeName,
      containers: [{ name: 'main', resources: { limits: { 'nvidia.com/gpu': String(gpus) } } }],
    },
    status: { phase },
  };
}

describe('memory estimates', () => {
  it('uses quantized precision', () => {
    expect(bytesPerParam('FP8')).toBe(1);
    expect(bytesPerParam('AWQ')).toBe(0.5);
    expect(bytesPerParam(undefined)).toBe(2);
  });

  it('estimates an 8B BF16 model at ~20 GiB', () => {
    const est = estimateServingMemory(8, undefined);
    expect(est.weightsGiB).toBeCloseTo(14.9, 1);
    expect(est.requiredGiB).toBeGreaterThan(19);
    expect(est.requiredGiB).toBeLessThan(21);
  });

  it('rounds GPU counts to tensor-parallel sizes', () => {
    expect(gpusForMemory(20, 80)).toBe(1);
    expect(gpusForMemory(150, 80)).toBe(2);
    expect(gpusForMemory(170, 80)).toBe(4);
    expect(gpusForMemory(800, 80)).toBe(16);
  });
});

describe('inventory', () => {
  it('computes requested devices from active pods only', () => {
    const inv = buildInventory(
      [
        node('gpu-1', 8),
        node('cpu-1', 0, {}, { metadata: { name: 'cpu-1' }, status: { capacity: { cpu: '8' } } }),
      ],
      [
        gpuPod('a', 'gpu-1', 2, 'Running', {
          'app.kubernetes.io/part-of': 'llminferenceservice',
          'app.kubernetes.io/name': 'qwen',
        }),
        gpuPod('b', 'gpu-1', 1, 'Pending'),
        gpuPod('done', 'gpu-1', 4, 'Succeeded'),
      ]
    );
    expect(inv).toHaveLength(1);
    const [gpu1] = inv;
    expect(gpu1.resources).toEqual([
      { name: 'nvidia.com/gpu', capacity: 8, allocatable: 8, requested: 3 },
    ]);
    expect(gpu1.driverVersion).toBe('580.65.06');
    expect(gpu1.workloads.find(w => w.pod === 'a')?.endpoint).toEqual({
      kind: 'LLMInferenceService',
      name: 'qwen',
    });
    expect(totals(inv)).toMatchObject({ nodes: 1, physical: 8, allocatable: 8, requested: 3 });
  });

  it('detects time-slicing and MIG', () => {
    const ts = buildInventory(
      [
        node('ts', 2, {
          'nvidia.com/gpu.sharing-strategy': 'time-slicing',
          'nvidia.com/gpu.replicas': '8',
        }),
      ],
      []
    )[0];
    expect(ts.sharing).toBe('time-slicing');
    expect(sharingLabel(ts)).toBe('Time-slicing ×4');

    const mig = buildInventory(
      [
        node(
          'mig',
          1,
          { 'nvidia.com/mig.strategy': 'mixed' },
          {
            status: {
              capacity: { 'nvidia.com/mig-1g.10gb': '7' },
              allocatable: { 'nvidia.com/mig-1g.10gb': '7' },
              conditions: [{ type: 'Ready', status: 'True' }],
            },
          }
        ),
      ],
      []
    )[0];
    expect(mig.sharing).toBe('mig');
    expect(mig.resources[0].name).toBe('nvidia.com/mig-1g.10gb');
  });

  it('reads legacy driver labels', () => {
    const inv = buildInventory(
      [
        node('old', 1, {
          'nvidia.com/cuda.driver-version.full': '',
          'nvidia.com/cuda.driver.major': '535',
          'nvidia.com/cuda.driver.minor': '104',
          'nvidia.com/cuda.driver.rev': '05',
        }),
      ],
      []
    );
    expect(inv[0].driverVersion).toBe('535.104.05');
  });

  it('adds DRA devices from v1 and v1beta1 ResourceSlices', () => {
    const slices: ResourceSliceJson[] = [
      {
        metadata: { name: 's1' },
        spec: {
          driver: 'gpu.nvidia.com',
          nodeName: 'dra-node',
          pool: { name: 'dra-node' },
          devices: [
            {
              name: 'gpu-0',
              attributes: {
                productName: { string: 'NVIDIA A100-SXM4-80GB' },
                type: { string: 'gpu' },
              },
              capacity: { memory: { value: '80Gi' } },
            },
            { name: 'gpu-1', basic: { attributes: { type: { string: 'gpu' } } } },
          ],
        },
      },
      {
        metadata: { name: 'net' },
        spec: { driver: 'net.example.com', nodeName: 'dra-node', devices: [] },
      },
    ];
    const inv = buildInventory([{ metadata: { name: 'dra-node' }, status: {} }], [], slices);
    expect(inv[0].draDevices).toHaveLength(2);
    expect(inv[0].product).toBe('NVIDIA A100-SXM4-80GB');
    expect(inv[0].draDevices[0].memoryBytes).toBe(80 * 2 ** 30);
  });

  it('sums container GPUs and takes the init container peak', () => {
    expect(
      podGpuRequests({
        metadata: { name: 'x' },
        spec: {
          containers: [
            { name: 'a', resources: { limits: { 'nvidia.com/gpu': '1' } } },
            { name: 'b', resources: { requests: { 'nvidia.com/gpu': '1' } } },
          ],
          initContainers: [{ name: 'i', resources: { limits: { 'nvidia.com/gpu': '4' } } }],
        },
      })
    ).toEqual({ 'nvidia.com/gpu': 4 });
  });
});

describe('checkFit', () => {
  const inventory = buildInventory(
    [
      node('big', 8),
      node('small', 4, { 'nvidia.com/gpu.memory': '24576', 'nvidia.com/gpu.product': 'NVIDIA-L4' }),
      node('cordoned', 8, {}, { spec: { unschedulable: true } }),
    ],
    [gpuPod('busy', 'big', 6)]
  );

  it('places replicas on nodes with enough free GPUs', () => {
    const fit = checkFit(inventory, { resource: 'nvidia.com/gpu', gpusPerReplica: 2, replicas: 3 });
    // big: 2 free -> 1 replica, small: 4 free -> 2 replicas.
    expect(fit).toMatchObject({ fits: true, placeable: 3 });
    expect(fit.nodes.find(n => n.node === 'cordoned')?.reason).toBe('unschedulable');
  });

  it('respects GPU memory requirements', () => {
    const fit = checkFit(inventory, {
      resource: 'nvidia.com/gpu',
      gpusPerReplica: 1,
      replicas: 4,
      minGpuMemoryMiB: 40000,
    });
    expect(fit.nodes.find(n => n.node === 'small')?.reason).toBe('gpu-memory');
    expect(fit).toMatchObject({ fits: false, placeable: 2 });
  });

  it('respects node selectors and missing resources', () => {
    const fit = checkFit(inventory, {
      resource: 'nvidia.com/gpu',
      gpusPerReplica: 1,
      replicas: 1,
      nodeSelector: { 'nvidia.com/gpu.product': 'NVIDIA-L4' },
    });
    expect(fit.placeable).toBe(4);
    const mig = checkFit(inventory, {
      resource: 'nvidia.com/mig-1g.10gb',
      gpusPerReplica: 1,
      replicas: 1,
    });
    expect(mig.fits).toBe(false);
    expect(mig.nodes.every(n => n.reason === 'no-resource')).toBe(true);
  });
});

describe('gpuDraDrivers', () => {
  const slice = (driver: string, devices: number): ResourceSliceJson => ({
    metadata: { name: `${driver}-${devices}` },
    spec: {
      driver,
      nodeName: 'n1',
      devices: Array.from({ length: devices }, (_, i) => ({ name: `d${i}` })),
    },
  });

  it('reports GPU drivers that publish devices, ignoring the bare DRA API and other drivers', () => {
    expect(gpuDraDrivers([])).toEqual([]);
    expect(
      gpuDraDrivers([slice('compute-domain.nvidia.com', 1), slice('net.example.com', 2)])
    ).toEqual([]);
    expect(gpuDraDrivers([slice('gpu.nvidia.com', 0)])).toEqual([]);
    expect(gpuDraDrivers([slice('gpu.nvidia.com', 8), slice('gpu.nvidia.com', 4)])).toEqual([
      'gpu.nvidia.com',
    ]);
  });
});
