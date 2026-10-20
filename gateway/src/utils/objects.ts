/**
 * Small helpers for reading and immutably updating loosely-shaped resource objects.
 *
 * Paths are dot separated; numeric segments index arrays (`spec.listeners.0.port`). Keys that
 * themselves contain dots (labels, annotations, TLS options) are never addressed by path: the
 * forms edit those maps as a whole.
 */

export type Path = string;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the value when it is an array, an empty array otherwise. */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Returns the value when it is a plain object, an empty object otherwise. */
export function asRecord<T = Record<string, unknown>>(value: unknown): T {
  return (isPlainObject(value) ? value : {}) as T;
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Converts a string map with possibly non-string values (YAML numbers, booleans) to strings. */
export function asStringMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isPlainObject(value)) return result;
  for (const [key, entry] of Object.entries(value)) {
    result[key] = asString(entry);
  }
  return result;
}

function segments(path: Path): string[] {
  return path === '' ? [] : path.split('.');
}

export function joinPath(...parts: Array<string | number>): Path {
  return parts.filter(part => part !== '').join('.');
}

const INDEX = /^\d+$/;

export function getIn(obj: unknown, path: Path): unknown {
  let current: unknown = obj;
  for (const segment of segments(path)) {
    if (Array.isArray(current)) {
      if (!INDEX.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function isEmptyContainer(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function setRecursive(current: unknown, parts: string[], value: unknown, depth: number): unknown {
  const [head, ...rest] = parts;
  const isIndex = INDEX.test(head);

  if (Array.isArray(current) || (current === undefined && isIndex)) {
    const copy = Array.isArray(current) ? [...current] : [];
    if (!isIndex) return copy;
    const index = Number(head);
    copy[index] = rest.length === 0 ? value : setRecursive(copy[index], rest, value, depth + 1);
    return copy;
  }

  const copy: Record<string, unknown> = isPlainObject(current) ? { ...current } : {};
  const next = rest.length === 0 ? value : setRecursive(copy[head], rest, value, depth + 1);
  // Objects that became empty because their last field was cleared are dropped, so clearing an
  // optional field does not leave `tls: {}` behind. Array elements and top-level fields stay.
  const removable = next === undefined || (rest.length > 0 && depth > 0 && isEmptyContainer(next));
  if (removable) {
    delete copy[head];
  } else {
    copy[head] = next;
  }
  return copy;
}

/**
 * Returns a copy of `obj` with `path` set to `value`. Setting `undefined` removes the key and any
 * parent objects that became empty as a result (but never array elements or top-level fields).
 */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  const parts = segments(path);
  if (parts.length === 0) return value as T;
  return setRecursive(obj, parts, value, 0) as T;
}

/** Returns a copy of `obj` with the array at `path` lacking the element at `index`. */
export function removeAt<T>(obj: T, path: Path, index: number): T {
  const items = asArray(getIn(obj, path)).filter((_, i) => i !== index);
  return setIn(obj, path, items);
}

/** Returns a copy of `obj` with `item` appended to the array at `path`. */
export function appendTo<T>(obj: T, path: Path, item: unknown): T {
  return setIn(obj, path, [...asArray(getIn(obj, path)), item]);
}

/** Moves an array element; out-of-range moves are ignored. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items;
  }
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Recursively drops `undefined` values, so the object serializes to clean YAML. */
export function dropUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => dropUndefined(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) result[key] = dropUndefined(entry);
    }
    return result as T;
  }
  return value;
}

/** Structural equality for JSON-like values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a).filter(key => a[key] !== undefined);
    const keysB = Object.keys(b).filter(key => b[key] !== undefined);
    return keysA.length === keysB.length && keysA.every(key => deepEqual(a[key], b[key]));
  }
  return false;
}
