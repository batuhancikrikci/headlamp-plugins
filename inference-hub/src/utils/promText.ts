/**
 * Minimal parser for the Prometheus text exposition format (what /metrics endpoints return).
 * Comments, TYPE/HELP lines, timestamps and exemplars are ignored.
 */

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    labels[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

function parseValue(text: string): number {
  switch (text) {
    case '+Inf':
      return Infinity;
    case '-Inf':
      return -Infinity;
    case 'NaN':
      return NaN;
    default:
      return Number(text);
  }
}

export function parsePromText(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Drop OpenMetrics exemplars ("... # {trace_id="x"} 1").
    const withoutExemplar = line.split(' # ')[0];
    const brace = withoutExemplar.indexOf('{');
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;
    if (brace >= 0) {
      const close = withoutExemplar.lastIndexOf('}');
      if (close < brace) continue;
      name = withoutExemplar.slice(0, brace).trim();
      labels = parseLabels(withoutExemplar.slice(brace + 1, close));
      rest = withoutExemplar.slice(close + 1).trim();
    } else {
      const space = withoutExemplar.search(/\s/);
      if (space < 0) continue;
      name = withoutExemplar.slice(0, space);
      rest = withoutExemplar.slice(space + 1).trim();
    }
    const value = parseValue(rest.split(/\s+/)[0]);
    if (!name || (Number.isNaN(value) && rest.split(/\s+/)[0] !== 'NaN')) continue;
    samples.push({ name, labels, value });
  }
  return samples;
}

/** Sum of all series of the first metric name that exists. */
export function sumOf(samples: MetricSample[], names: string[]): number | undefined {
  for (const name of names) {
    const matching = samples.filter(s => s.name === name && isFinite(s.value));
    if (matching.length > 0) return matching.reduce((sum, s) => sum + s.value, 0);
  }
  return undefined;
}

/** Maximum of all series of the first metric name that exists. */
export function maxOf(samples: MetricSample[], names: string[]): number | undefined {
  for (const name of names) {
    const matching = samples.filter(s => s.name === name && isFinite(s.value));
    if (matching.length > 0) return Math.max(...matching.map(s => s.value));
  }
  return undefined;
}

/** First value of a label across series of the given names. */
export function labelOf(
  samples: MetricSample[],
  names: string[],
  label: string
): string | undefined {
  for (const s of samples) if (names.includes(s.name) && s.labels[label]) return s.labels[label];
  return undefined;
}
