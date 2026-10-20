/** Kubernetes resource.Quantity helpers. */

const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};
const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

/** Parses a quantity ("16Gi", "500m", "1.5", "2e3") to a number; NaN when invalid. */
export function parseQuantity(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number') return value;
  const match = /^([+-]?\d*\.?\d+)(?:([eE][+-]?\d+)|(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E))?$/.exec(
    value.trim()
  );
  if (!match) return NaN;
  const num = Number(match[1]);
  if (match[2]) return num * 10 ** Number(match[2].slice(1));
  const suffix = match[3] || '';
  return num * (BINARY[suffix] ?? DECIMAL[suffix] ?? 1);
}

/** Formats bytes with binary units, e.g. 17179869184 -> "16 GiB". */
export function formatBytes(bytes: number, digits = 1): string {
  if (!isFinite(bytes)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let v = bytes;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number.isInteger(v) ? v : v.toFixed(digits)} ${units[i]}`;
}

/** Resource names that count as whole NVIDIA GPUs or GPU slices. */
export function isGpuResource(name: string): boolean {
  return (
    name === 'nvidia.com/gpu' ||
    name === 'nvidia.com/gpu.shared' ||
    name.startsWith('nvidia.com/mig-') ||
    name === 'amd.com/gpu' ||
    name === 'gpu.intel.com/i915' ||
    name === 'gpu.intel.com/xe'
  );
}

/** Sums the GPU devices of a resource list (limits or requests). */
export function gpuCount(resources?: Record<string, string | number>): number {
  if (!resources) return 0;
  return Object.entries(resources)
    .filter(([k]) => isGpuResource(k))
    .reduce((sum, [, v]) => sum + (parseQuantity(v) || 0), 0);
}
