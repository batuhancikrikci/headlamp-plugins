import { describe, expect, it } from 'vitest';
import {
  isSelectorEmpty,
  matchesLabelSelector,
  normalizeKey,
  selectorKeys,
  selectorProblems,
  selectorToString,
} from './selectors';

describe('matchesLabelSelector', () => {
  const labels = { app: 'web', tier: 'frontend' };

  it('matches matchLabels and ignores Cilium label source prefixes', () => {
    expect(matchesLabelSelector({ matchLabels: { app: 'web' } }, labels)).toBe(true);
    expect(matchesLabelSelector({ matchLabels: { 'k8s:app': 'web' } }, labels)).toBe(true);
    expect(matchesLabelSelector({ matchLabels: { 'any:app': 'web' } }, labels)).toBe(true);
    expect(matchesLabelSelector({ matchLabels: { app: 'db' } }, labels)).toBe(false);
  });

  it('never matches reserved labels against ordinary label sets', () => {
    expect(matchesLabelSelector({ matchLabels: { 'reserved:host': '' } }, labels)).toBe(false);
  });

  it('evaluates matchExpressions', () => {
    const match = (
      operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist',
      key: string,
      values?: string[]
    ) => matchesLabelSelector({ matchExpressions: [{ key, operator, values }] }, labels);
    expect(match('In', 'app', ['web', 'api'])).toBe(true);
    expect(match('In', 'app', ['api'])).toBe(false);
    expect(match('NotIn', 'app', ['api'])).toBe(true);
    expect(match('NotIn', 'missing', ['x'])).toBe(true);
    expect(match('Exists', 'tier')).toBe(true);
    expect(match('DoesNotExist', 'tier')).toBe(false);
    expect(match('DoesNotExist', 'missing')).toBe(true);
  });

  it('treats an empty selector as "everything" and a missing one per field semantics', () => {
    expect(matchesLabelSelector({}, labels)).toBe(true);
    expect(matchesLabelSelector(undefined, labels)).toBe(true);
    expect(matchesLabelSelector(undefined, labels, 'none')).toBe(false);
    expect(matchesLabelSelector(null, labels, 'none')).toBe(false);
  });
});

describe('selector helpers', () => {
  it('renders a readable string', () => {
    expect(
      selectorToString({
        matchLabels: { app: 'web', flag: '' },
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['a', 'b'] },
          { key: 'legacy', operator: 'DoesNotExist' },
          { key: 'zone', operator: 'Exists' },
        ],
      })
    ).toBe('app=web, flag, tier in (a,b), !legacy, zone');
    expect(selectorToString(undefined)).toBe('');
  });

  it('detects empty selectors and lists keys without prefixes', () => {
    expect(isSelectorEmpty({})).toBe(true);
    expect(isSelectorEmpty({ matchLabels: {} })).toBe(true);
    expect(isSelectorEmpty({ matchLabels: { a: 'b' } })).toBe(false);
    expect(normalizeKey('k8s:io.kubernetes.pod.namespace')).toBe('io.kubernetes.pod.namespace');
    expect(
      selectorKeys({
        matchLabels: { 'k8s:app': 'x' },
        matchExpressions: [{ key: 'tier', operator: 'Exists' }],
      })
    ).toEqual(['app', 'tier']);
  });

  it('reports invalid keys, values and expressions', () => {
    expect(
      selectorProblems({ matchLabels: { app: 'web', 'k8s:io.kubernetes.pod.namespace': 'x' } })
    ).toEqual([]);
    expect(selectorProblems({ matchLabels: { 'bad key': 'x' } })).toHaveLength(1);
    expect(selectorProblems({ matchLabels: { app: 'not valid!' } })).toHaveLength(1);
    expect(selectorProblems({ matchExpressions: [{ key: 'a', operator: 'In' }] })).toHaveLength(1);
    expect(
      selectorProblems({ matchExpressions: [{ key: 'a', operator: 'Exists', values: ['x'] }] })
    ).toHaveLength(1);
  });
});
