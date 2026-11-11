import { reuseUnchanged } from './stableList';

describe('reuseUnchanged', () => {
  const a = { id: 'a', status: 'ready' };
  const b = { id: 'b', status: 'ready' };

  it('returns the previous array when nothing changed', () => {
    const previous = [a, b];
    expect(reuseUnchanged(previous, [{ ...a }, { ...b }])).toBe(previous);
  });

  it('keeps unchanged objects and takes changed ones', () => {
    const next = reuseUnchanged([a, b], [{ ...a }, { id: 'b', status: 'failed' }]);
    expect(next[0]).toBe(a);
    expect(next[1]).toEqual({ id: 'b', status: 'failed' });
  });

  it('follows a new order and removed items', () => {
    expect(reuseUnchanged([a, b], [{ ...b }, { ...a }])).toEqual([b, a]);
    expect(reuseUnchanged([a, b], [{ ...b }])[0]).toBe(b);
  });
});
