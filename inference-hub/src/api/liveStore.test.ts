import * as store from './liveStore';

// Only the Kubernetes API is replaced: it answers every path with the path itself.
const { request } = vi.hoisted(() => ({
  request: vi.fn(async (path: string) => ({ path })),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({ ApiProxy: { request } }));

describe('liveStore eviction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.evictIdle(Number.MAX_SAFE_INTEGER);
  });
  afterEach(() => vi.useRealTimers());

  it('keeps an unused entry for quick remounts, then drops it', async () => {
    const unsubscribe = store.subscribe('c', '/api/v1/pods', 0, () => {});
    await vi.runOnlyPendingTimersAsync();
    expect(store.getSnapshot('c', '/api/v1/pods').data).toEqual({ path: '/api/v1/pods' });

    unsubscribe();
    expect(store.evictIdle(Date.now() + 1000)).toBe(0);
    expect(store.cachedPaths()).toBe(1);

    await vi.advanceTimersByTimeAsync(store.EVICT_AFTER_MS);
    expect(store.cachedPaths()).toBe(0);
    expect(store.getSnapshot('c', '/api/v1/pods').loading).toBe(true);
  });

  it('never drops an entry that still has subscribers', async () => {
    const unsubscribe = store.subscribe('c', '/api/v1/nodes', 0, () => {});
    await vi.runOnlyPendingTimersAsync();
    expect(store.evictIdle(Date.now() + store.EVICT_AFTER_MS * 10)).toBe(0);
    unsubscribe();
    expect(store.evictIdle(Date.now() + store.EVICT_AFTER_MS)).toBe(1);
  });
});
