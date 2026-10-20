import { AMCMatcher, AMMatcher, Labels } from '../types';

export type MatchOperator = '=' | '!=' | '=~' | '!~';

// Label names: Prometheus classic charset. Values may be quoted (any char but an
// unescaped quote) or bare (no whitespace/quotes).
const MATCHER_RE =
  /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*(?:"((?:[^"\\]|\\.)*)"|([^"\s]+))\s*$/;

/** Parses `name="value"`, `name=~"re.*"`, `name!=value` ... into an Alertmanager matcher. */
export function parseMatcher(input: string): AMMatcher {
  const match = input.match(MATCHER_RE);
  if (!match) {
    throw new Error(`Invalid matcher: ${input}`);
  }
  const op = match[2] as MatchOperator;
  const raw = match[3] !== undefined ? match[3].replace(/\\(.)/g, '$1') : match[4];
  const isRegex = op === '=~' || op === '!~';
  if (isRegex) {
    // Surface bad regexes early instead of letting Alertmanager reject them.
    // eslint-disable-next-line no-new
    new RegExp(`^(?:${raw})$`);
  }
  return {
    name: match[1],
    value: raw,
    isRegex,
    isEqual: op === '=' || op === '=~',
  };
}

export function matcherOperator(m: { isRegex: boolean; isEqual?: boolean }): MatchOperator {
  const equal = m.isEqual !== false;
  if (m.isRegex) return equal ? '=~' : '!~';
  return equal ? '=' : '!=';
}

export function formatMatcher(m: AMMatcher): string {
  const escaped = m.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${m.name}${matcherOperator(m)}"${escaped}"`;
}

/** Whether a single Alertmanager matcher matches a label set. */
export function matcherMatches(m: AMMatcher, labels: Labels): boolean {
  const value = labels[m.name] ?? '';
  let hit: boolean;
  if (m.isRegex) {
    try {
      hit = new RegExp(`^(?:${m.value})$`).test(value);
    } catch {
      return false;
    }
  } else {
    hit = value === m.value;
  }
  return m.isEqual === false ? !hit : hit;
}

export function matchersMatch(matchers: AMMatcher[], labels: Labels): boolean {
  return matchers.every(m => matcherMatches(m, labels));
}

/** AlertmanagerConfig (CRD) matcher -> display string; handles v1alpha1 `regex` and `matchType`. */
export function formatAMCMatcher(m: AMCMatcher): string {
  const op = m.matchType || (m.regex ? '=~' : '=');
  return `${m.name}${op}"${m.value ?? ''}"`;
}

/** Matchers that pin a silence to exactly this alert (all labels, equality). */
export function matchersFromLabels(labels: Labels, skip: string[] = []): AMMatcher[] {
  return Object.entries(labels)
    .filter(([k]) => !skip.includes(k))
    .map(([name, value]) => ({ name, value, isRegex: false, isEqual: true }));
}
