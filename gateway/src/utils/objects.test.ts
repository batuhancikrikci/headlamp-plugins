import { describe, expect, it } from 'vitest';
import {
  appendTo,
  asArray,
  asRecord,
  asStringMap,
  deepEqual,
  dropUndefined,
  getIn,
  joinPath,
  moveItem,
  removeAt,
  setIn,
} from './objects';

describe('getIn', () => {
  const obj = { spec: { listeners: [{ name: 'http', port: 80 }] } };

  it('reads nested object and array paths', () => {
    expect(getIn(obj, 'spec.listeners.0.port')).toBe(80);
    expect(getIn(obj, 'spec.listeners')).toHaveLength(1);
    expect(getIn(obj, '')).toBe(obj);
  });

  it('returns undefined for missing or mistyped paths', () => {
    expect(getIn(obj, 'spec.listeners.3.port')).toBeUndefined();
    expect(getIn(obj, 'spec.listeners.name')).toBeUndefined();
    expect(getIn(obj, 'spec.listeners.0.port.deep')).toBeUndefined();
    expect(getIn(undefined, 'a.b')).toBeUndefined();
  });
});

describe('setIn', () => {
  it('sets nested values without mutating the input', () => {
    const obj = { spec: { listeners: [{ name: 'http', port: 80 }] } };
    const next = setIn(obj, 'spec.listeners.0.port', 8080);
    expect(next.spec.listeners[0].port).toBe(8080);
    expect(obj.spec.listeners[0].port).toBe(80);
    expect(next.spec.listeners).not.toBe(obj.spec.listeners);
  });

  it('creates intermediate objects and arrays', () => {
    expect(setIn({}, 'spec.tls.mode', 'Terminate')).toEqual({
      spec: { tls: { mode: 'Terminate' } },
    });
    expect(setIn({}, 'spec.rules.0.name', 'a')).toEqual({ spec: { rules: [{ name: 'a' }] } });
  });

  it('removes the key when the value is undefined', () => {
    const obj = { spec: { hostname: 'a.example.com', port: 80 } };
    expect(setIn(obj, 'spec.hostname', undefined)).toEqual({ spec: { port: 80 } });
  });

  it('prunes parent objects that became empty', () => {
    const obj = { spec: { listeners: [{ name: 'https', tls: { mode: 'Terminate' } }] } };
    expect(setIn(obj, 'spec.listeners.0.tls.mode', undefined)).toEqual({
      spec: { listeners: [{ name: 'https' }] },
    });
  });

  it('keeps array elements and top-level fields even when they become empty', () => {
    expect(setIn({ spec: { rules: [{ name: 'a' }] } }, 'spec.rules.0.name', undefined)).toEqual({
      spec: { rules: [{}] },
    });
    expect(setIn({ metadata: { name: 'x' } }, 'metadata.name', undefined)).toEqual({
      metadata: {},
    });
  });

  it('keeps an explicitly set empty object', () => {
    expect(setIn({ spec: {} }, 'spec.rules.0.filters.0.cors', {})).toEqual({
      spec: { rules: [{ filters: [{ cors: {} }] }] },
    });
  });
});

describe('array helpers', () => {
  it('appends and removes items at a path', () => {
    const obj = { spec: { hostnames: ['a'] } };
    const appended = appendTo(obj, 'spec.hostnames', 'b');
    expect(appended.spec.hostnames).toEqual(['a', 'b']);
    expect(removeAt(appended, 'spec.hostnames', 0).spec.hostnames).toEqual(['b']);
    expect(appendTo({}, 'spec.hostnames', 'a')).toEqual({ spec: { hostnames: ['a'] } });
  });

  it('moves items and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    const items = ['a', 'b'];
    expect(moveItem(items, 0, 5)).toBe(items);
    expect(moveItem(items, 1, 1)).toBe(items);
  });
});

describe('coercion helpers', () => {
  it('tolerates values of the wrong type', () => {
    expect(asArray('nope')).toEqual([]);
    expect(asArray([1])).toEqual([1]);
    expect(asRecord([1])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asStringMap({ a: 1, b: true, c: 'x' })).toEqual({ a: '1', b: 'true', c: 'x' });
  });

  it('joins path segments', () => {
    expect(joinPath('spec', 'listeners', 0, 'port')).toBe('spec.listeners.0.port');
    expect(joinPath('', 'kind')).toBe('kind');
  });
});

describe('dropUndefined and deepEqual', () => {
  it('drops undefined values recursively', () => {
    expect(dropUndefined({ a: undefined, b: [{ c: undefined, d: 1 }] })).toEqual({ b: [{ d: 1 }] });
  });

  it('compares structurally, ignoring undefined keys', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: '1' })).toBe(false);
  });
});
