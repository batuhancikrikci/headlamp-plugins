/** Time formatting of the dashboards. */

/** "3 hours ago" style age of a timestamp. */
export function age(timestamp: string | undefined, now = Date.now()): string {
  const time = Date.parse(timestamp ?? '');
  if (Number.isNaN(time)) return '—';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Duration in seconds as "45s", "12m", "3h 5m", "2d 4h". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
