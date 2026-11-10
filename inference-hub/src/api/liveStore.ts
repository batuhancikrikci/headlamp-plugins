/**
 * Shared polling store for Kubernetes API reads.
 *
 * Every (cluster, path) pair is fetched by at most one request at a time and by one timer,
 * however many components use it. Polling pauses while the window is hidden and stops when
 * the last subscriber leaves. The last value stays cached for quick remounts and is dropped
 * after EVICT_AFTER_MS without subscribers, so a long session does not keep every list it opened.
 */
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';

export interface ApiError {
  status?: number;
  message: string;
}

export interface Snapshot<T> {
  data?: T;
  error?: ApiError;
  /** True until the first response (success or failure) arrived. */
  loading: boolean;
  updatedAt?: number;
}

interface Entry {
  cluster: string;
  path: string;
  snapshot: Snapshot<unknown>;
  listeners: Map<symbol, { intervalMs: number; notify: () => void }>;
  timer?: ReturnType<typeof setTimeout>;
  inflight?: Promise<void>;
  /** When the last subscriber left (or the entry was created without one). */
  idleSince?: number;
}

const entries = new Map<string, Entry>();

export const EVICT_AFTER_MS = 5 * 60 * 1000;
let sweepTimer: ReturnType<typeof setTimeout> | undefined;

/** Drops entries without subscribers that have been idle for EVICT_AFTER_MS; returns how many. */
export function evictIdle(now = Date.now()): number {
  let evicted = 0;
  entries.forEach((entry, key) => {
    if (
      entry.listeners.size === 0 &&
      !entry.inflight &&
      entry.idleSince !== undefined &&
      now - entry.idleSince >= EVICT_AFTER_MS
    ) {
      entries.delete(key);
      evicted++;
    }
  });
  return evicted;
}

/** Number of cached paths (for tests). */
export function cachedPaths(): number {
  return entries.size;
}

function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = undefined;
    evictIdle();
    if (Array.from(entries.values()).some(e => e.listeners.size === 0)) scheduleSweep();
  }, EVICT_AFTER_MS);
}

export function toApiError(err: unknown): ApiError {
  const e = err as { status?: number; message?: string };
  return { status: e?.status, message: e?.message || String(err) };
}

export function isForbidden(error?: ApiError): boolean {
  return error?.status === 403;
}

export function isNotFound(error?: ApiError): boolean {
  return error?.status === 404;
}

function entryKey(cluster: string, path: string) {
  return `${cluster}\u0000${path}`;
}

function interval(entry: Entry): number {
  let min = Infinity;
  entry.listeners.forEach(l => (min = Math.min(min, l.intervalMs)));
  return min;
}

function notifyAll(entry: Entry) {
  entry.listeners.forEach(l => l.notify());
}

function fetchEntry(entry: Entry): Promise<void> {
  if (entry.inflight) return entry.inflight;
  const params = entry.cluster ? { cluster: entry.cluster } : {};
  entry.inflight = (ApiProxy.request(entry.path, params) as Promise<unknown>)
    .then(data => {
      entry.snapshot = { data, loading: false, updatedAt: Date.now() };
    })
    .catch((err: unknown) => {
      // Keep the last good data on transient errors so tables do not flicker.
      entry.snapshot = {
        data: entry.snapshot.data,
        error: toApiError(err),
        loading: false,
        updatedAt: Date.now(),
      };
    })
    .finally(() => {
      entry.inflight = undefined;
      notifyAll(entry);
      schedule(entry);
    });
  return entry.inflight;
}

function schedule(entry: Entry) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = undefined;
  const ms = interval(entry);
  if (entry.listeners.size === 0 || !isFinite(ms)) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (typeof document !== 'undefined' && document.hidden) {
      schedule(entry);
      return;
    }
    fetchEntry(entry);
  }, ms);
}

function getEntry(cluster: string, path: string): Entry {
  const k = entryKey(cluster, path);
  let entry = entries.get(k);
  if (!entry) {
    entry = {
      cluster,
      path,
      snapshot: { loading: true },
      listeners: new Map(),
      idleSince: Date.now(),
    };
    entries.set(k, entry);
    scheduleSweep();
  }
  return entry;
}

export function getSnapshot<T>(cluster: string, path: string): Snapshot<T> {
  return (entries.get(entryKey(cluster, path))?.snapshot as Snapshot<T>) || { loading: true };
}

/**
 * Subscribes to a path. The first subscriber triggers a fetch (unless fresh data is cached);
 * `intervalMs` of 0 disables polling for this subscriber.
 */
export function subscribe(
  cluster: string,
  path: string,
  intervalMs: number,
  notify: () => void
): () => void {
  const entry = getEntry(cluster, path);
  const id = Symbol(path);
  entry.idleSince = undefined;
  entry.listeners.set(id, { intervalMs: intervalMs > 0 ? intervalMs : Infinity, notify });
  const age = entry.snapshot.updatedAt ? Date.now() - entry.snapshot.updatedAt : Infinity;
  if (entry.snapshot.loading || age >= Math.min(interval(entry), 5000)) {
    fetchEntry(entry);
  } else if (!entry.timer && !entry.inflight) {
    schedule(entry);
  }
  return () => {
    entry.listeners.delete(id);
    if (entry.listeners.size === 0) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = undefined;
      entry.idleSince = Date.now();
      scheduleSweep();
    }
  };
}

/** Refetches a path now (e.g. after a create or delete). */
export function refresh(cluster: string, path: string): Promise<void> {
  return fetchEntry(getEntry(cluster, path));
}

/** Refetches every cached path that starts with the prefix. */
export function refreshMatching(cluster: string, prefix: string): Promise<void[]> {
  const matches = Array.from(entries.values()).filter(
    e => e.cluster === cluster && e.path.startsWith(prefix)
  );
  return Promise.all(matches.map(fetchEntry));
}
