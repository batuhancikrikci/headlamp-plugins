/** Pure form helpers shared by the wizards (no Headlamp runtime imports). */

/** DNS-1123 subdomain, the naming rule for all resources the wizards create. */
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** Returns an error message for an invalid Kubernetes object name, or null when valid. */
export function validateName(name: string, field = 'Name'): string | null {
  if (!name) return `${field} is required.`;
  if (name.length > 253) return `${field} must be at most 253 characters.`;
  if (!DNS_SUBDOMAIN.test(name)) {
    return `${field} must consist of lowercase letters, digits, '-' or '.', and start and end with an alphanumeric character.`;
  }
  return null;
}

/** Recursively drops undefined values, empty strings, empty arrays and empty objects. */
export function prune<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => prune(v)).filter(v => v !== undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = prune(v);
      if (pruned === undefined || pruned === '') continue;
      if (Array.isArray(pruned) && pruned.length === 0) continue;
      if (
        pruned &&
        typeof pruned === 'object' &&
        !Array.isArray(pruned) &&
        Object.keys(pruned).length === 0
      ) {
        continue;
      }
      out[k] = pruned;
    }
    return out as T;
  }
  return value;
}

/** Splits a comma/newline separated string into trimmed, non-empty unique values. */
export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map(v => v.trim())
        .filter(Boolean)
    )
  );
}
