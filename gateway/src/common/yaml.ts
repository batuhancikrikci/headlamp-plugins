/**
 * YAML helpers and the two-way synchronization between a guided form and the YAML editor.
 *
 * - Form → YAML: every form change re-serializes the whole object (`dumpYaml`).
 * - YAML → form: every keystroke is parsed (`fromYaml`); while the text is invalid the form keeps
 *   the last valid object and the error is shown. The kind cannot change inside an editor that
 *   was opened for a specific kind (the form would not know how to render it).
 */
import * as yaml from 'js-yaml';
import { t } from './i18n';

/** YAML for one object, without undefined values and without line wrapping. */
export function dumpYaml(value: unknown): string {
  // skipInvalid drops keys whose value is undefined (left behind by some form updates).
  return yaml.dump(value, { noRefs: true, lineWidth: -1, skipInvalid: true });
}

/** Multi-document YAML for several objects. */
export function dumpAllYaml(values: unknown[]): string {
  return values.map(dumpYaml).join('---\n');
}

export type ParseResult<T> = { value: T; error?: undefined } | { value?: undefined; error: string };

/**
 * Parses a single YAML document that must be a mapping. Returns the error message instead of
 * throwing so the editors can show it inline.
 */
export function parseObject(text: string): ParseResult<Record<string, unknown>> {
  try {
    const parsed = yaml.load(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: t('The document must be a single Kubernetes object') };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Parses a multi-document YAML stream into a list of objects (empty documents are skipped). */
export function parseManifests(text: string): ParseResult<Array<Record<string, unknown>>> {
  try {
    const docs = yaml.loadAll(text).filter(d => d !== null && d !== undefined);
    for (const [i, doc] of docs.entries()) {
      if (typeof doc !== 'object' || Array.isArray(doc)) {
        return { error: t('Document {{n}} is not a Kubernetes object', { n: i + 1 }) };
      }
      const obj = doc as Record<string, unknown>;
      if (!obj.apiVersion || !obj.kind) {
        return { error: t('Document {{n}} needs apiVersion and kind', { n: i + 1 }) };
      }
    }
    return { value: docs as Array<Record<string, unknown>> };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Parses the YAML of an editor. With `expectedKind` the kind may not change, because the form
 * opened for that kind could not render another one.
 */
export function fromYaml<T extends object = Record<string, unknown>>(
  text: string,
  expectedKind?: string
): ParseResult<T> {
  const parsed = parseObject(text);
  if (parsed.error !== undefined) return { error: parsed.error };
  const value = parsed.value;
  if (!value.metadata || typeof value.metadata !== 'object') {
    return { error: t('metadata is required') };
  }
  if (expectedKind && value.kind !== expectedKind) {
    return {
      error: t('This editor edits a {{expected}}; the kind cannot be changed to "{{kind}}"', {
        expected: expectedKind,
        kind: String(value.kind ?? ''),
      }),
    };
  }
  return { value: value as T };
}

/** Structural equality of two JSON values (key order independent, undefined keys ignored). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter(k => ao[k] !== undefined);
  const bk = Object.keys(bo).filter(k => bo[k] !== undefined);
  return ak.length === bk.length && ak.every(k => sameJson(ao[k], bo[k]));
}
