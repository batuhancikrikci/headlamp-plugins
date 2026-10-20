/**
 * GPU inventory from node labels (GPU Feature Discovery), node capacity/allocatable (device
 * plugin), pod requests and DRA ResourceSlices.
 */
import { isGpuResource, parseQuantity } from '../utils/quantity';
import { PodJson } from './pod';
import { KubeJson } from './types';

export interface NodeJson extends KubeJson {
  spec?: {
    unschedulable?: boolean;
    taints?: Array<{ key: string; effect: string; value?: string }>;
  };
  status?: {
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
    conditions?: Array<{ type: string; status: string }>;
    nodeInfo?: { kubeletVersion?: string; osImage?: string };
  };
}

export type SharingMode = 'exclusive' | 'time-slicing' | 'mps' | 'mig';

export interface GpuResource {
  /** Extended resource name, e.g. nvidia.com/gpu, nvidia.com/gpu.shared, nvidia.com/mig-1g.10gb. */
  name: string;
  capacity: number;
  allocatable: number;
  requested: number;
}

export interface GpuWorkload {
  namespace: string;
  pod: string;
  node: string;
  /** Requested devices per resource name. */
  requests: Record<string, number>;
  phase?: string;
  /** Owning endpoint (KServe labels), when the pod belongs to one. */
  endpoint?: { kind: 'LLMInferenceService' | 'InferenceService'; name: string };
  owner?: { kind: string; name: string };
}

export interface DraDevice {
  name: string;
  pool: string;
  driver: string;
  type?: string;
  product?: string;
  memoryBytes?: number;
  uuid?: string;
}

export interface GpuNode {
  name: string;
  ready: boolean;
  unschedulable: boolean;
  product?: string;
  family?: string;
  /** Memory of one GPU (or MIG slice with mig.strategy=single) in MiB. */
  memoryMiB?: number;
  /** Physical GPUs (gpu.count label). */
  physicalGpus?: number;
  computeCapability?: string;
  driverVersion?: string;
  cudaVersion?: string;
  migCapable: boolean;
  migStrategy?: string;
  migConfig?: string;
  migConfigState?: string;
  sharing: SharingMode;
  /** Replicas per GPU for time-slicing / MPS. */
  replicas?: number;
  resources: GpuResource[];
  workloads: GpuWorkload[];
  draDevices: DraDevice[];
  labels: Record<string, string>;
}

const L = 'nvidia.com/';

function label(labels: Record<string, string>, key: string): string | undefined {
  return labels[L + key];
}

function num(value?: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return isFinite(n) ? n : undefined;
}

/** Driver version from the current (cuda.driver-version.*) or legacy (cuda.driver.*) labels. */
export function driverVersion(labels: Record<string, string>): string | undefined {
  const full = label(labels, 'cuda.driver-version.full');
  if (full) return full;
  const major = label(labels, 'cuda.driver-version.major') || label(labels, 'cuda.driver.major');
  if (!major) return undefined;
  const minor = label(labels, 'cuda.driver-version.minor') || label(labels, 'cuda.driver.minor');
  const rev = label(labels, 'cuda.driver-version.revision') || label(labels, 'cuda.driver.rev');
  return [major, minor, rev].filter(v => v !== undefined && v !== '').join('.');
}

export function cudaVersion(labels: Record<string, string>): string | undefined {
  const full = label(labels, 'cuda.runtime-version.full');
  if (full) return full;
  const major = label(labels, 'cuda.runtime-version.major') || label(labels, 'cuda.runtime.major');
  const minor = label(labels, 'cuda.runtime-version.minor') || label(labels, 'cuda.runtime.minor');
  return major ? [major, minor].filter(Boolean).join('.') : undefined;
}

export function sharingMode(labels: Record<string, string>, resources: string[]): SharingMode {
  const strategy = label(labels, 'gpu.sharing-strategy');
  if (strategy === 'time-slicing') return 'time-slicing';
  if (strategy === 'mps') return 'mps';
  const mig = label(labels, 'mig.strategy');
  if ((mig && mig !== 'none') || resources.some(r => r.startsWith(`${L}mig-`))) return 'mig';
  if (resources.includes(`${L}gpu.shared`)) return 'time-slicing';
  const replicas = num(label(labels, 'gpu.replicas'));
  const count = num(label(labels, 'gpu.count'));
  if (replicas && count && replicas > count) return 'time-slicing';
  return 'exclusive';
}

function isActivePod(pod: PodJson): boolean {
  const phase = pod.status?.phase;
  return phase !== 'Succeeded' && phase !== 'Failed';
}

/** Extended resources are requested through limits (requests default to limits). */
export function podGpuRequests(pod: PodJson): Record<string, number> {
  const result: Record<string, number> = {};
  for (const c of pod.spec?.containers || []) {
    const res = { ...(c.resources?.requests || {}), ...(c.resources?.limits || {}) };
    for (const [k, v] of Object.entries(res)) {
      if (isGpuResource(k)) result[k] = (result[k] || 0) + (parseQuantity(v) || 0);
    }
  }
  // Init containers run before app containers; their peak counts if higher.
  for (const c of pod.spec?.initContainers || []) {
    const res = { ...(c.resources?.requests || {}), ...(c.resources?.limits || {}) };
    for (const [k, v] of Object.entries(res)) {
      if (isGpuResource(k)) result[k] = Math.max(result[k] || 0, parseQuantity(v) || 0);
    }
  }
  return result;
}

export function workloadOf(pod: PodJson): GpuWorkload {
  const labels = pod.metadata.labels || {};
  let endpoint: GpuWorkload['endpoint'];
  if (
    labels['app.kubernetes.io/part-of'] === 'llminferenceservice' &&
    labels['app.kubernetes.io/name']
  ) {
    endpoint = { kind: 'LLMInferenceService', name: labels['app.kubernetes.io/name'] };
  } else if (labels['serving.kserve.io/inferenceservice']) {
    endpoint = { kind: 'InferenceService', name: labels['serving.kserve.io/inferenceservice'] };
  }
  const owner =
    pod.metadata.ownerReferences?.find(o => o.controller) || pod.metadata.ownerReferences?.[0];
  return {
    namespace: pod.metadata.namespace || '',
    pod: pod.metadata.name,
    node: pod.spec?.nodeName || '',
    requests: podGpuRequests(pod),
    phase: pod.status?.phase,
    endpoint,
    owner: owner ? { kind: owner.kind, name: owner.name } : undefined,
  };
}

export interface ResourceSliceJson extends KubeJson {
  spec?: {
    driver?: string;
    nodeName?: string;
    pool?: { name?: string };
    devices?: Array<{
      name: string;
      // resource.k8s.io/v1 puts attributes on the device, v1beta1 under "basic".
      attributes?: Record<string, DraAttribute>;
      capacity?: Record<string, { value?: string } | string>;
      basic?: {
        attributes?: Record<string, DraAttribute>;
        capacity?: Record<string, { value?: string } | string>;
      };
    }>;
  };
}

type DraAttribute = { string?: string; int?: number; bool?: boolean; version?: string };

function attr(a?: DraAttribute): string | undefined {
  if (!a) return undefined;
  if (a.string !== undefined) return a.string;
  if (a.version !== undefined) return a.version;
  if (a.int !== undefined) return String(a.int);
  if (a.bool !== undefined) return String(a.bool);
  return undefined;
}

/**
 * GPU DRA drivers that publish devices (e.g. "gpu.nvidia.com"). The resource.k8s.io API itself is
 * built into Kubernetes, so its presence says nothing about a GPU driver being installed.
 */
export function gpuDraDrivers(slices: ResourceSliceJson[]): string[] {
  return Array.from(
    new Set(
      slices
        .filter(s => (s.spec?.devices || []).length > 0)
        .map(s => s.spec?.driver || '')
        .filter(d => /gpu/i.test(d))
    )
  ).sort();
}

/** GPU devices of DRA ResourceSlices (drivers whose name contains "gpu"). */
export function draDevices(slices: ResourceSliceJson[]): Map<string, DraDevice[]> {
  const byNode = new Map<string, DraDevice[]>();
  for (const slice of slices) {
    const driver = slice.spec?.driver || '';
    const node = slice.spec?.nodeName;
    if (!node || !/gpu/i.test(driver)) continue;
    for (const device of slice.spec?.devices || []) {
      const attributes = device.attributes || device.basic?.attributes || {};
      const capacity = device.capacity || device.basic?.capacity || {};
      const memory = capacity.memory;
      const memoryValue = typeof memory === 'string' ? memory : memory?.value;
      const list = byNode.get(node) || [];
      list.push({
        name: device.name,
        pool: slice.spec?.pool?.name || '',
        driver,
        type: attr(attributes.type),
        product: attr(attributes.productName),
        uuid: attr(attributes.uuid),
        memoryBytes: memoryValue ? parseQuantity(memoryValue) : undefined,
      });
      byNode.set(node, list);
    }
  }
  return byNode;
}

/** Builds the GPU inventory. Nodes without any GPU resource, GPU label or DRA device are skipped. */
export function buildInventory(
  nodes: NodeJson[],
  pods: PodJson[],
  slices: ResourceSliceJson[] = []
): GpuNode[] {
  const workloads = pods
    .filter(isActivePod)
    .map(workloadOf)
    .filter(w => Object.keys(w.requests).length > 0);
  const dra = draDevices(slices);

  return nodes
    .map((node): GpuNode | null => {
      const labels = node.metadata.labels || {};
      const capacity = node.status?.capacity || {};
      const allocatable = node.status?.allocatable || {};
      const names = Array.from(
        new Set([...Object.keys(capacity), ...Object.keys(allocatable)])
      ).filter(isGpuResource);
      const nodeWorkloads = workloads.filter(w => w.node === node.metadata.name);
      const devices = dra.get(node.metadata.name) || [];
      const hasGpuLabels =
        label(labels, 'gpu.present') === 'true' || !!label(labels, 'gpu.product');
      if (names.length === 0 && devices.length === 0 && !hasGpuLabels) return null;

      const resources: GpuResource[] = names.map(name => ({
        name,
        capacity: parseQuantity(capacity[name]) || 0,
        allocatable: parseQuantity(allocatable[name]) || 0,
        requested: nodeWorkloads.reduce((sum, w) => sum + (w.requests[name] || 0), 0),
      }));
      const ready = (node.status?.conditions || []).some(
        c => c.type === 'Ready' && c.status === 'True'
      );
      const compute = [label(labels, 'gpu.compute.major'), label(labels, 'gpu.compute.minor')];

      return {
        name: node.metadata.name,
        ready,
        unschedulable: !!node.spec?.unschedulable,
        product: label(labels, 'gpu.product') || devices.find(d => d.product)?.product,
        family: label(labels, 'gpu.family'),
        memoryMiB: num(label(labels, 'gpu.memory')),
        physicalGpus: num(label(labels, 'gpu.count')),
        computeCapability: compute[0] ? compute.filter(Boolean).join('.') : undefined,
        driverVersion: driverVersion(labels),
        cudaVersion: cudaVersion(labels),
        migCapable: label(labels, 'mig.capable') === 'true',
        migStrategy: label(labels, 'mig.strategy'),
        migConfig: label(labels, 'mig.config'),
        migConfigState: label(labels, 'mig.config.state'),
        sharing: sharingMode(labels, names),
        replicas: num(label(labels, 'gpu.replicas')),
        resources,
        workloads: nodeWorkloads,
        draDevices: devices,
        labels,
      };
    })
    .filter((n): n is GpuNode => n !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Physical GPUs: the GFD count label, else whole nvidia.com/gpu devices of exclusive nodes. */
export function physicalGpus(node: GpuNode): number {
  if (node.physicalGpus !== undefined) return node.physicalGpus;
  if (node.sharing !== 'exclusive') return 0;
  return node.resources.find(r => r.name === 'nvidia.com/gpu')?.capacity || node.draDevices.length;
}

export function totals(nodes: GpuNode[]) {
  const sum = (pick: (r: GpuResource) => number) =>
    nodes.reduce((s, n) => s + n.resources.reduce((t, r) => t + pick(r), 0), 0);
  return {
    nodes: nodes.length,
    physical: nodes.reduce((s, n) => s + physicalGpus(n), 0),
    allocatable: sum(r => r.allocatable),
    requested: sum(r => r.requested),
    draDevices: nodes.reduce((s, n) => s + n.draDevices.length, 0),
  };
}

export function sharingLabel(node: GpuNode): string {
  switch (node.sharing) {
    case 'time-slicing':
      return node.replicas && node.physicalGpus
        ? `Time-slicing ×${Math.round(node.replicas / node.physicalGpus)}`
        : 'Time-slicing';
    case 'mps':
      return 'MPS';
    case 'mig':
      return `MIG (${node.migStrategy || 'mixed'})`;
    default:
      return 'Exclusive';
  }
}
