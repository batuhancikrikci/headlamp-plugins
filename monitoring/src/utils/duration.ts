/** Prometheus duration: one or more <number><unit> with units y,w,d,h,m,s,ms. */
const PROM_DURATION_RE = /^((\d+)(y|w|d|h|ms|m|s))+$/;

export function isValidPromDuration(value: string | undefined | null): boolean {
  if (!value) return false;
  return PROM_DURATION_RE.test(value.trim()) && value.trim() !== '0';
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
};

/** Parses a Prometheus duration into milliseconds, or null if invalid. */
export function parsePromDuration(value: string | undefined | null): number | null {
  if (!value || !PROM_DURATION_RE.test(value.trim())) return null;
  let total = 0;
  const re = /(\d+)(ms|y|w|d|h|m|s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value.trim())) !== null) {
    total += Number(match[1]) * UNIT_MS[match[2]];
  }
  return total;
}

/** Formats seconds (as returned by the Prometheus API) as a compact duration. */
export function formatSeconds(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return '-';
  if (seconds === 0) return '0s';
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  const units: Array<[string, number]> = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let rest = Math.round(seconds);
  const parts: string[] = [];
  for (const [unit, size] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  return parts.slice(0, 2).join('');
}

/** "3m ago" style relative time. Returns '-' for missing/invalid dates. */
export function timeAgo(iso: string | undefined | null, now: number = Date.now()): string {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t <= 0) return '-';
  const diff = Math.max(0, (now - t) / 1000);
  return formatSeconds(diff);
}

/** Converts a Date into the value format expected by <input type="datetime-local">. */
export function toDatetimeLocal(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}
