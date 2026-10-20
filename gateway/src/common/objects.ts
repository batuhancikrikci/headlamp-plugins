/**
 * Immutable object helpers used by the forms. Empty values are pruned so that the generated
 * YAML only contains the fields the user actually set.
 */

export type Path = Array<string | number>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>;

export function getIn<T = unknown>(obj: unknown, path: Path): T | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as AnyObject)[key as string];
  }
  return cur as T | undefined;
}

/**
 * Whether a leaf value should be removed from the object tree. Empty objects are kept on
 * purpose: `{}` is meaningful in many APIs (an empty label selector selects everything,
 * `http3: {}` enables a feature).
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Returns a copy of `obj` with `value` set at `path`. Setting an empty value removes the key
 * (or the array element) at the end of the path; intermediate objects are left untouched so that
 * form sections do not disappear while the user is editing them.
 */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const base: AnyObject = Array.isArray(obj)
    ? [...obj]
    : obj && typeof obj === 'object'
    ? { ...(obj as AnyObject) }
    : typeof head === 'number'
    ? []
    : {};

  if (rest.length > 0) {
    base[head as string] = setIn(base[head as string], rest, value);
  } else if (isEmptyValue(value)) {
    if (Array.isArray(base)) {
      (base as unknown[]).splice(head as number, 1);
    } else {
      delete base[head as string];
    }
  } else {
    base[head as string] = value;
  }
  return base as T;
}

/** Removes the objects along `path` that became empty, deepest first. */
export function pruneEmpty<T>(obj: T, path: Path): T {
  let result = obj;
  for (let i = path.length; i > 0; i--) {
    const sub = path.slice(0, i);
    const value = getIn(result, sub);
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      result = setIn(result, sub, undefined);
    } else {
      break;
    }
  }
  return result;
}

/**
 * Prepares a live object for editing: drops status and server-managed metadata that must not be
 * sent back on apply. `forDisplay` also drops the resourceVersion.
 */
export function cleanForEdit<T extends AnyObject>(json: T, forDisplay = false): T {
  const copy = JSON.parse(JSON.stringify(json)) as AnyObject;
  delete copy.status;
  if (copy.metadata) {
    delete copy.metadata.managedFields;
    delete copy.metadata.creationTimestamp;
    delete copy.metadata.generation;
    delete copy.metadata.uid;
    if (forDisplay) delete copy.metadata.resourceVersion;
    if (copy.metadata.annotations) {
      delete copy.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
      if (Object.keys(copy.metadata.annotations).length === 0) delete copy.metadata.annotations;
    }
  }
  return copy as T;
}

const DNS_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const DNS_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** RFC 1123 subdomain (metadata.name of most objects). */
export function isValidResourceName(value?: string): boolean {
  return !!value && value.length <= 253 && DNS_SUBDOMAIN_RE.test(value);
}

/** RFC 1123 label (namespaces and other names limited to 63 characters). */
export function isValidDNSLabel(value?: string): boolean {
  return !!value && value.length <= 63 && DNS_LABEL_RE.test(value);
}

/** Gateway API Duration format (e.g. "1h", "10s", "500ms", "1m30s"); empty is valid. */
const DURATION_RE = /^([0-9]{1,5}(h|m|s|ms)){1,4}$/;

export function isValidDuration(value?: string): boolean {
  if (!value) return true;
  return DURATION_RE.test(value);
}

/** Parses "a, b ,c" style input into a trimmed, de-duplicated list. */
export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean)
    )
  );
}
