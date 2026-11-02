import { describe, expect, it } from 'vitest';
import {
  estimateArchitecture,
  formatTokens,
  kvBytesPerToken,
  maxConcurrency,
  maxContext,
  measuredCache,
  plan,
  PlanInput,
  smallestTensorParallel,
  vllmArgsFor,
} from './capacity';

const llama8b = { layers: 32, kvHeads: 8, headDim: 128 };

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    paramsB: 8,
    arch: llama8b,
    kvDtype: 'auto',
    gpuMemoryGiB: 80,
    gpus: 1,
    gpuMemoryUtilization: 0.9,
    ...overrides,
  };
}

describe('architecture and KV size', () => {
  it('estimates typical architectures by size', () => {
    expect(estimateArchitecture(8)).toEqual(llama8b);
    expect(estimateArchitecture(7)).toEqual(llama8b);
    expect(estimateArchitecture(72)).toEqual({ layers: 80, kvHeads: 8, headDim: 128 });
    expect(estimateArchitecture(0.01).layers).toBe(24);
  });

  it('computes the KV cache of one token', () => {
    // Llama 3.1 8B: 2 × 32 × 8 × 128 × 2 bytes = 128 KiB per token.
    expect(kvBytesPerToken(llama8b, 'auto')).toBe(131072);
    expect(kvBytesPerToken(llama8b, 'fp8')).toBe(65536);
  });
});

describe('plan', () => {
  it('splits an 80 GiB GPU into weights, reserve and KV cache', () => {
    const p = plan(input());
    expect(p.usablePerGpuGiB).toBe(72);
    expect(p.weightsPerGpuGiB).toBe(14.9);
    expect(p.reservePerGpuGiB).toBe(2);
    expect(p.kvPerGpuGiB).toBe(55.1);
    // 55.1 GiB / 128 KiB per token ≈ 451K tokens.
    expect(p.kvTokens).toBeGreaterThan(450_000);
    expect(p.kvTokens).toBeLessThan(452_000);
    expect(p.fits).toBe(true);
  });

  it('splits the weights and adds up the KV cache over tensor parallel GPUs', () => {
    const one = plan(input({ paramsB: 70, arch: estimateArchitecture(70), gpuMemoryGiB: 80 }));
    expect(one.fits).toBe(false);
    const four = plan(
      input({ paramsB: 70, arch: estimateArchitecture(70), gpuMemoryGiB: 80, gpus: 4 })
    );
    expect(four.weightsPerGpuGiB).toBe(32.6);
    expect(four.fits).toBe(true);
    // 4 × 37.4 GiB of KV cache / 320 KiB per token ≈ 490K tokens.
    expect(four.kvTokens).toBeGreaterThan(480_000);
    expect(four.kvTokens).toBeLessThan(500_000);
  });

  it('accounts for quantized weights and an FP8 KV cache', () => {
    const fp16 = plan(input({ gpuMemoryGiB: 24 }));
    const fp8 = plan(input({ gpuMemoryGiB: 24, quantization: 'FP8', kvDtype: 'fp8' }));
    expect(fp8.weightsPerGpuGiB).toBeCloseTo(fp16.weightsPerGpuGiB / 2, 0);
    expect(fp8.kvTokens).toBeGreaterThan(fp16.kvTokens * 2);
  });

  it('picks the smallest tensor parallel size that holds the load', () => {
    const base = { ...input({ paramsB: 70, arch: estimateArchitecture(70) }) };
    // 2 GPUs leave only ~31K tokens of KV cache after the 130 GiB of weights.
    expect(smallestTensorParallel(base, 32768, 8)).toBe(4);
    expect(smallestTensorParallel(base, 4096, 4)).toBe(2);
    expect(smallestTensorParallel(base, 131072, 64)).toBeUndefined();
    expect(smallestTensorParallel(input(), 8192, 4)).toBe(1);
  });

  it('derives concurrency, context and vLLM arguments', () => {
    expect(maxConcurrency(100_000, 8192)).toBe(12);
    expect(maxContext(100_000, 4)).toBe(25_000);
    expect(maxConcurrency(100, 0)).toBe(0);
    expect(vllmArgsFor(32768, 16, 'fp8')).toBe(
      '--max-model-len=32768 --max-num-seqs=16 --kv-cache-dtype=fp8'
    );
    expect(vllmArgsFor(8192, 0, 'auto')).toBe('--max-model-len=8192 --max-num-seqs=1');
  });
});

describe('measuredCache', () => {
  it('reads vLLM cache_config_info labels', () => {
    expect(
      measuredCache({
        block_size: '16',
        num_gpu_blocks: '27000',
        cache_dtype: 'auto',
        gpu_memory_utilization: '0.9',
      })
    ).toEqual({
      kvTokens: 432000,
      blockSize: 16,
      numGpuBlocks: 27000,
      cacheDtype: 'auto',
      gpuMemoryUtilization: 0.9,
    });
    expect(measuredCache({ block_size: '16', num_gpu_blocks: 'None' })).toBeUndefined();
  });

  it('formats token counts', () => {
    expect(formatTokens(131072)).toBe('128K');
    expect(formatTokens(1_500_000)).toBe('1.4M');
    expect(formatTokens(900)).toBe('900');
  });
});
