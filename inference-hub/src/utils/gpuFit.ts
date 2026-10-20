/**
 * GPU memory estimates for LLM serving and placement checks against the GPU inventory.
 *
 * Estimates are deliberately simple and conservative: weights at the quantized precision plus
 * a KV cache and runtime reserve, sized for vLLM's default gpu_memory_utilization of 0.9.
 */
import { GpuNode } from '../resources/gpu';

const GIB = 2 ** 30;

/** Bytes per parameter for a quantization label (BF16/FP16 when unknown). */
export function bytesPerParam(quantization?: string): number {
  switch ((quantization || '').toUpperCase()) {
    case 'FP8':
    case 'INT8':
    case 'W8A8':
    case 'W8A16':
      return 1;
    case 'AWQ':
    case 'GPTQ':
    case 'INT4':
    case 'W4A16':
    case 'NVFP4':
    case 'MXFP4':
    case 'GGUF':
      return 0.5;
    default:
      return 2;
  }
}

export interface MemoryEstimate {
  weightsGiB: number;
  /** KV cache / activation reserve assumed on top of the weights. */
  reserveGiB: number;
  /** Total GPU memory to provision across the GPUs of one replica. */
  requiredGiB: number;
}

export const VLLM_GPU_MEMORY_UTILIZATION = 0.9;

export function estimateServingMemory(paramsB: number, quantization?: string): MemoryEstimate {
  const weightsGiB = (paramsB * 1e9 * bytesPerParam(quantization)) / GIB;
  // At least 2 GiB, or 20% of the weights, for KV cache, activations and CUDA graphs.
  const reserveGiB = Math.max(2, weightsGiB * 0.2);
  const requiredGiB = (weightsGiB + reserveGiB) / VLLM_GPU_MEMORY_UTILIZATION;
  return {
    weightsGiB: round1(weightsGiB),
    reserveGiB: round1(reserveGiB),
    requiredGiB: round1(requiredGiB),
  };
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/**
 * GPUs per replica for a memory requirement, rounded up to a tensor-parallel friendly size
 * (1, 2, 4, 8, then multiples of 8).
 */
export function gpusForMemory(requiredGiB: number, gpuMemoryGiB: number): number {
  if (gpuMemoryGiB <= 0) return 1;
  const raw = Math.max(1, Math.ceil(requiredGiB / gpuMemoryGiB));
  if (raw <= 8) return 2 ** Math.ceil(Math.log2(raw));
  return Math.ceil(raw / 8) * 8;
}

export interface FitRequest {
  /** Extended resource requested by the model server, e.g. nvidia.com/gpu. */
  resource: string;
  gpusPerReplica: number;
  replicas: number;
  /** Memory each GPU must have (MiB); skipped when undefined. */
  minGpuMemoryMiB?: number;
  nodeSelector?: Record<string, string>;
}

export type NodeFitReason =
  | 'ok'
  | 'not-ready'
  | 'unschedulable'
  | 'selector'
  | 'no-resource'
  | 'gpu-memory'
  | 'insufficient';

export interface NodeFit {
  node: string;
  product?: string;
  free: number;
  /** Replicas this node can host on its own. */
  replicas: number;
  reason: NodeFitReason;
}

export interface FitResult {
  /** All requested replicas can be placed right now. */
  fits: boolean;
  /** Replicas that can be placed with the currently free devices. */
  placeable: number;
  /** Replicas that could be placed on an empty cluster (capacity check). */
  capacityReplicas: number;
  nodes: NodeFit[];
}

export function checkFit(nodes: GpuNode[], req: FitRequest): FitResult {
  const perReplica = Math.max(1, req.gpusPerReplica);
  let placeable = 0;
  let capacityReplicas = 0;
  const results = nodes.map((node): NodeFit => {
    const res = node.resources.find(r => r.name === req.resource);
    const free = res ? Math.max(0, res.allocatable - res.requested) : 0;
    const base = { node: node.name, product: node.product, free };
    if (
      req.nodeSelector &&
      Object.entries(req.nodeSelector).some(([k, v]) => node.labels[k] !== v)
    ) {
      return { ...base, replicas: 0, reason: 'selector' };
    }
    if (!res || res.allocatable === 0) return { ...base, replicas: 0, reason: 'no-resource' };
    if (
      req.minGpuMemoryMiB !== undefined &&
      node.memoryMiB !== undefined &&
      node.memoryMiB < req.minGpuMemoryMiB
    ) {
      return { ...base, replicas: 0, reason: 'gpu-memory' };
    }
    if (!node.ready) return { ...base, replicas: 0, reason: 'not-ready' };
    if (node.unschedulable) return { ...base, replicas: 0, reason: 'unschedulable' };
    capacityReplicas += Math.floor(res.allocatable / perReplica);
    const replicas = Math.floor(free / perReplica);
    placeable += replicas;
    return { ...base, replicas, reason: replicas > 0 ? 'ok' : 'insufficient' };
  });
  return {
    fits: placeable >= req.replicas,
    placeable,
    capacityReplicas,
    nodes: results.sort((a, b) => b.replicas - a.replicas || b.free - a.free),
  };
}

export const FIT_REASON_TEXT: Record<NodeFitReason, string> = {
  ok: 'Fits',
  'not-ready': 'Node not ready',
  unschedulable: 'Node cordoned',
  selector: 'Excluded by node selector',
  'no-resource': 'Resource not offered',
  'gpu-memory': 'GPU memory too small',
  insufficient: 'Not enough free GPUs',
};
