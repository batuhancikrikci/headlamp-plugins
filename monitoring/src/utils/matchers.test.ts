import {
  formatAMCMatcher,
  formatMatcher,
  matcherOperator,
  matchersMatch,
  parseMatcher,
} from './matchers';

describe('parseMatcher', () => {
  it.each([
    ['env="prod"', { name: 'env', value: 'prod', isRegex: false, isEqual: true }],
    ['env!="prod"', { name: 'env', value: 'prod', isRegex: false, isEqual: false }],
    ['env=~"prod.*"', { name: 'env', value: 'prod.*', isRegex: true, isEqual: true }],
    ['env!~"dev|qa"', { name: 'env', value: 'dev|qa', isRegex: true, isEqual: false }],
    ['severity=critical', { name: 'severity', value: 'critical', isRegex: false, isEqual: true }],
    ['  job = "a b"  ', { name: 'job', value: 'a b', isRegex: false, isEqual: true }],
    ['msg="say \\"hi\\""', { name: 'msg', value: 'say "hi"', isRegex: false, isEqual: true }],
  ])('parses %s', (input, expected) => {
    expect(parseMatcher(input)).toEqual(expected);
  });

  it.each(['', 'env', '1abc="x"', 'env=="x"', 'env=~"("'])('rejects %s', input => {
    expect(() => parseMatcher(input)).toThrow();
  });
});

describe('formatMatcher', () => {
  it('round-trips every operator (including !~)', () => {
    for (const input of ['a="1"', 'a!="1"', 'a=~"1.*"', 'a!~"1.*"']) {
      expect(formatMatcher(parseMatcher(input))).toBe(input);
    }
  });

  it('treats a missing isEqual as equality', () => {
    expect(matcherOperator({ isRegex: true })).toBe('=~');
  });
});

describe('matchersMatch', () => {
  const labels = { alertname: 'HighCPU', severity: 'warning', namespace: 'prod' };

  it('requires every matcher', () => {
    expect(
      matchersMatch(
        [parseMatcher('alertname="HighCPU"'), parseMatcher('severity=~"warn.*"')],
        labels
      )
    ).toBe(true);
    expect(
      matchersMatch(
        [parseMatcher('alertname="HighCPU"'), parseMatcher('severity="critical"')],
        labels
      )
    ).toBe(false);
  });

  it('anchors regexes and supports negation', () => {
    expect(matchersMatch([parseMatcher('namespace=~"pro"')], labels)).toBe(false);
    expect(matchersMatch([parseMatcher('namespace!~"dev.*"')], labels)).toBe(true);
    expect(matchersMatch([parseMatcher('missing!="x"')], labels)).toBe(true);
  });
});

describe('formatAMCMatcher', () => {
  it('supports v1alpha1 regex and matchType', () => {
    expect(formatAMCMatcher({ name: 'a', value: 'b', regex: true })).toBe('a=~"b"');
    expect(formatAMCMatcher({ name: 'a', value: 'b', matchType: '!=' })).toBe('a!="b"');
    expect(formatAMCMatcher({ name: 'a', value: 'b' })).toBe('a="b"');
  });
});
