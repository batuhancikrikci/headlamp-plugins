import { describe, expect, it } from 'vitest';
import {
  cleanForEdit,
  getIn,
  isValidDNSLabel,
  isValidDuration,
  isValidResourceName,
  pruneEmpty,
  setIn,
  splitList,
} from './objects';

describe('setIn / getIn', () => {
  it('creates intermediate objects immutably', () => {
    const base = { spec: { a: 1 } };
    const next = setIn(base, ['spec', 'b', 'c'], 'x');
    expect(next).toEqual({ spec: { a: 1, b: { c: 'x' } } });
    expect(base).toEqual({ spec: { a: 1 } });
    expect(getIn(next, ['spec', 'b', 'c'])).toBe('x');
  });

  it('removes a key when set to an empty value but keeps its parents', () => {
    const next = setIn({ spec: { cors: { maxAge: '1h' } } }, ['spec', 'cors', 'maxAge'], '');
    expect(next).toEqual({ spec: { cors: {} } });
  });

  it('keeps explicit empty objects (e.g. selector: {})', () => {
    expect(setIn({ spec: {} }, ['spec', 'selector'], {})).toEqual({ spec: { selector: {} } });
  });

  it('removes array elements set to undefined', () => {
    expect(setIn({ l: ['a', 'b'] }, ['l', 0], undefined)).toEqual({ l: ['b'] });
  });

  it('removes empty arrays', () => {
    expect(setIn({ spec: { l: ['a'] } }, ['spec', 'l'], [])).toEqual({ spec: {} });
  });
});

describe('pruneEmpty', () => {
  it('removes objects that became empty, deepest first', () => {
    expect(pruneEmpty({ spec: { a: {} }, kind: 'X' }, ['spec', 'a'])).toEqual({ kind: 'X' });
    expect(pruneEmpty({ spec: { a: {}, b: 1 } }, ['spec', 'a'])).toEqual({ spec: { b: 1 } });
  });
});

describe('cleanForEdit', () => {
  it('drops status and server managed metadata', () => {
    const cleaned = cleanForEdit({
      metadata: { name: 'x', managedFields: [], uid: 'u', resourceVersion: '1' },
      status: { conditions: [] },
    });
    expect(cleaned).toEqual({ metadata: { name: 'x', resourceVersion: '1' } });
  });

  it('drops the last-applied annotation, and the resourceVersion for display', () => {
    const cleaned = cleanForEdit(
      {
        metadata: {
          name: 'x',
          resourceVersion: '1',
          annotations: { 'kubectl.kubernetes.io/last-applied-configuration': '{}' },
        },
      },
      true
    );
    expect(cleaned).toEqual({ metadata: { name: 'x' } });
  });
});

describe('validators', () => {
  it('validates Gateway API durations', () => {
    for (const ok of ['10s', '500ms', '1h30m', '1m30s', undefined, ''])
      expect(isValidDuration(ok)).toBe(true);
    for (const bad of ['10', '1.5s', '10 s', 's', '1d']) expect(isValidDuration(bad)).toBe(false);
  });

  it('validates resource names and DNS labels', () => {
    expect(isValidResourceName('my-policy.v1')).toBe(true);
    expect(isValidResourceName('My_Policy')).toBe(false);
    expect(isValidResourceName('')).toBe(false);
    expect(isValidDNSLabel('cluster-1')).toBe(true);
    expect(isValidDNSLabel('a.b')).toBe(false);
  });
});

describe('splitList', () => {
  it('trims and de-duplicates', () => {
    expect(splitList('a, b ,a\nc,')).toEqual(['a', 'b', 'c']);
  });
});
