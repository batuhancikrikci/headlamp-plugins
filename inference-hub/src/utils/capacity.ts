/**
 * Capacity planning for LLM serving: how much GPU memory the weights and the KV cache of a model
 * need, how many concurrent sequences of a given context length fit, and on which GPUs.
 *
 * The KV cache of one token takes 2 (key and value) × layers × KV heads × head size × bytes per
 * value. These architecture numbers live in the model's config.json, which Inference Hub does
 * not download (it makes no requests outside the cluster), so they are estimated from the
 * parameter count of typical dense models and can be corrected by the user. A model that already
 * runs in the cluster gives the exact KV cache capacity through vLLM's cache_config_info metric.
 */
import { bytesPerParam } from './gpuFit';

const GIB = 2 ** 30;

export interface ModelArchitecture {
  layers: number;
  /** Key/value heads (grouped-query attention). */
  kvHeads: number;
  headDim: number;
}

/** Typical dense decoder architectures by size (Llama / Qwen / Mistral families). */
const TYPICAL: Array<{ paramsB: number; arch: ModelArchitecture }> = [
  { paramsB: 0.5, arch: { layers: 24, kvHeads: 2, headDim: 64 } },
  { paramsB: 1.5, arch: { layers: 28, kvHeads: 2, headDim: 128 } },
  { paramsB: 3, arch: { layers: 36, kvHeads: 2, headDim: 128 } },
  { paramsB: 8, arch: { layers: 32, kvHeads: 8, headDim: 128 } },
  { paramsB: 14, arch: { layers: 48, kvHeads: 8, headDim: 128 } },
  { paramsB: 32, arch: { layers: 64, kvHeads: 8, headDim: 128 } },
  { paramsB: 70, arch: { layers: 80, kvHeads: 8, headDim: 128 } },
  { paramsB: 123, arch: { layers: 88, kvHeads: 8, headDim: 128 } },
  { paramsB: 405, arch: { layers: 126, kvHeads: 8, headDim: 128 } },
];

/** Architecture of a typical dense model of this size (closest on a log scale). */
export function estimateArchitecture(paramsB: number): ModelArchitecture {
  const target = Math.log(Math.max(0.1, paramsB));
  return TYPICAL.reduce((best, entry) =>
    Math.abs(Math.log(entry.paramsB) - target) < Math.abs(Math.log(best.paramsB) - target)
      ? entry
      : best
  ).arch;
}

export type KvCacheDtype = 'auto' | 'fp8';

/** Bytes of the KV cache of one token. */
export function kvBytesPerToken(arch: ModelArchitecture, dtype: KvCacheDtype): number {
  return 2 * arch.layers * arch.kvHeads * arch.headDim * (dtype === 'fp8' ? 1 : 2);
}

/**
 * GPU memory per GPU that vLLM does not use for weights or KV cache: activations of a forward
 * pass, CUDA graphs and the CUDA context. vLLM profiles it at start-up; 2 GiB is a conservative
 * figure for the default batch sizes.
 */
export const RESERVE_PER_GPU_GIB = 2;
export const DEFAULT_GPU_MEMORY_UTILIZATION = 0.9;

export interface PlanInput {
  paramsB: number;
  quantization?: string;
  arch: ModelArchitecture;
  kvDtype: KvCacheDtype;
  /** Memory of one GPU in GiB. */
  gpuMemoryGiB: number;
  /** GPUs per replica (tensor parallelism). */
  gpus: number;
  gpuMemoryUtilization: number;
}

export interface Plan {
  /** Weights per GPU (they are split across the GPUs of a replica). */
  weightsPerGpuGiB: number;
  reservePerGpuGiB: number;
  /** KV cache per GPU. */
  kvPerGpuGiB: number;
  /** Memory vLLM may use per GPU (memory × utilization). */
  usablePerGpuGiB: number;
  /** Tokens the KV cache of one replica holds. */
  kvTokens: number;
  /** The weights fit and leave room for at least one sequence of 1024 tokens. */
  fits: boolean;
}

export function plan(input: PlanInput): Plan {
  const gpus = Math.max(1, input.gpus);
  const usablePerGpuGiB = input.gpuMemoryGiB * input.gpuMemoryUtilization;
  const weightsGiB = (input.paramsB * 1e9 * bytesPerParam(input.quantization)) / GIB;
  const weightsPerGpuGiB = weightsGiB / gpus;
  const kvPerGpuGiB = Math.max(0, usablePerGpuGiB - weightsPerGpuGiB - RESERVE_PER_GPU_GIB);
  const perToken = kvBytesPerToken(input.arch, input.kvDtype);
  // KV heads are split across the GPUs too, so the cache of all GPUs adds up.
  const kvTokens = perToken > 0 ? Math.floor((kvPerGpuGiB * gpus * GIB) / perToken) : 0;
  return {
    weightsPerGpuGiB: round1(weightsPerGpuGiB),
    reservePerGpuGiB: RESERVE_PER_GPU_GIB,
    kvPerGpuGiB: round1(kvPerGpuGiB),
    usablePerGpuGiB: round1(usablePerGpuGiB),
    kvTokens,
    fits: kvPerGpuGiB > 0 && kvTokens >= 1024,
  };
}

/** Concurrent sequences of `contextTokens` that fit in the KV cache. */
export function maxConcurrency(kvTokens: number, contextTokens: number): number {
  return contextTokens > 0 ? Math.floor(kvTokens / contextTokens) : 0;
}

/** Longest context when `concurrency` sequences share the KV cache. */
export function maxContext(kvTokens: number, concurrency: number): number {
  return concurrency > 0 ? Math.floor(kvTokens / concurrency) : 0;
}

/** Tensor parallel sizes vLLM supports well. */
export const TP_SIZES = [1, 2, 4, 8];

/**
 * The smallest tensor parallel size whose KV cache holds `concurrency` sequences of
 * `contextTokens`; undefined when even 8 GPUs are not enough.
 */
export function smallestTensorParallel(
  input: Omit<PlanInput, 'gpus'>,
  contextTokens: number,
  concurrency: number,
  available = TP_SIZES
): number | undefined {
  return available.find(gpus => {
    const p = plan({ ...input, gpus });
    return p.fits && p.kvTokens >= contextTokens * Math.max(1, concurrency);
  });
}

/** vLLM arguments that match a plan. */
export function vllmArgsFor(contextTokens: number, concurrency: number, kvDtype: KvCacheDtype) {
  return [
    `--max-model-len=${contextTokens}`,
    `--max-num-seqs=${Math.max(1, concurrency)}`,
    ...(kvDtype === 'fp8' ? ['--kv-cache-dtype=fp8'] : []),
  ].join(' ');
}

export interface MeasuredCache {
  /** Tokens the KV cache holds: num_gpu_blocks × block_size. */
  kvTokens: number;
  blockSize: number;
  numGpuBlocks: number;
  cacheDtype?: string;
  gpuMemoryUtilization?: number;
}

/** Reads the labels of vLLM's cache_config_info metric. */
export function measuredCache(labels: Record<string, string>): MeasuredCache | undefined {
  const blocks = Number(labels.num_gpu_blocks);
  const blockSize = Number(labels.block_size);
  if (!isFinite(blocks) || !isFinite(blockSize) || blocks <= 0 || blockSize <= 0) return undefined;
  const utilization = Number(labels.gpu_memory_utilization);
  return {
    kvTokens: blocks * blockSize,
    blockSize,
    numGpuBlocks: blocks,
    cacheDtype: labels.cache_dtype || undefined,
    gpuMemoryUtilization: isFinite(utilization) && utilization > 0 ? utilization : undefined,
  };
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

/** Human readable token count, e.g. 131072 -> "128K". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1024 * 1024) return `${round1(tokens / (1024 * 1024))}M`;
  if (tokens >= 1024) return `${Math.floor(tokens / 1024)}K`;
  return String(tokens);
}
