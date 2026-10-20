import {
  isSelectorEmpty,
  matchesLabelSelector,
  monitorNamespaceMatches,
  selectorToString,
} from './selectors';

describe('matchesLabelSelector', () => {
  it('treats nil according to the given meaning', () => {
    expect(matchesLabelSelector(undefined, { a: 'b' }, 'all')).toBe(true);
    expect(matchesLabelSelector(null, { a: 'b' }, 'none')).toBe(false);
  });

  it('matches everything with an empty selector regardless of nil meaning', () => {
    expect(matchesLabelSelector({}, {}, 'none')).toBe(true);
    expect(matchesLabelSelector({ matchLabels: {} }, { x: 'y' }, 'none')).toBe(true);
  });

  it('requires all matchLabels', () => {
    const sel = { matchLabels: { app: 'web', release: 'kps' } };
    expect(matchesLabelSelector(sel, { app: 'web', release: 'kps', extra: '1' })).toBe(true);
    expect(matchesLabelSelector(sel, { app: 'web' })).toBe(false);
  });

  it('supports every matchExpressions operator', () => {
    const labels = { tier: 'backend', env: 'prod' };
    expect(
      matchesLabelSelector(
        { matchExpressions: [{ key: 'tier', operator: 'In', values: ['backend'] }] },
        labels
      )
    ).toBe(true);
    expect(
      matchesLabelSelector(
        { matchExpressions: [{ key: 'tier', operator: 'NotIn', values: ['backend'] }] },
        labels
      )
    ).toBe(false);
    expect(
      matchesLabelSelector(
        { matchExpressions: [{ key: 'missing', operator: 'NotIn', values: ['x'] }] },
        labels
      )
    ).toBe(true);
    expect(
      matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'Exists' }] }, labels)
    ).toBe(true);
    expect(
      matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'DoesNotExist' }] }, labels)
    ).toBe(false);
    expect(
      matchesLabelSelector({ matchExpressions: [{ key: 'env', operator: 'Bogus' }] }, labels)
    ).toBe(false);
  });
});

describe('isSelectorEmpty / selectorToString', () => {
  it('detects empty selectors', () => {
    expect(isSelectorEmpty(undefined)).toBe(true);
    expect(isSelectorEmpty({})).toBe(true);
    expect(isSelectorEmpty({ matchLabels: { a: 'b' } })).toBe(false);
  });

  it('renders a kubectl-like string', () => {
    expect(
      selectorToString({
        matchLabels: { app: 'x' },
        matchExpressions: [
          { key: 't', operator: 'In', values: ['a', 'b'] },
          { key: 'k', operator: 'DoesNotExist' },
        ],
      })
    ).toBe('app=x, t in (a,b), !k');
  });
});

describe('monitorNamespaceMatches', () => {
  it('defaults to the monitor namespace', () => {
    expect(monitorNamespaceMatches('mon', undefined, 'mon')).toBe(true);
    expect(monitorNamespaceMatches('mon', {}, 'other')).toBe(false);
  });

  it('supports any and matchNames', () => {
    expect(monitorNamespaceMatches('mon', { any: true }, 'other')).toBe(true);
    expect(monitorNamespaceMatches('mon', { matchNames: ['a', 'b'] }, 'b')).toBe(true);
    expect(monitorNamespaceMatches('mon', { matchNames: ['a'] }, 'mon')).toBe(false);
  });
});
