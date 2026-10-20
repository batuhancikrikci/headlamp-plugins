/** Multi-document YAML helpers for the resource editor (pure, unit tested). */
import * as yaml from 'js-yaml';

export interface KubeDocument {
  apiVersion?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface KindRef {
  apiVersion: string;
  kind: string;
}

export type ParseResult<T> = { docs: T[]; error: null } | { docs: null; error: string };

/** Serializes objects as one YAML stream; undefined fields left by forms are dropped. */
export function toYamlStream(objects: object[]): string {
  const options: yaml.DumpOptions = { lineWidth: -1, noRefs: true, skipInvalid: true };
  return objects.map(o => yaml.dump(o, options)).join('---\n');
}

/** Parses a YAML stream into its object documents; empty documents are skipped. */
export function parseYamlStream<T extends object = KubeDocument>(text: string): ParseResult<T> {
  try {
    const all = yaml.loadAll(text, undefined, { schema: yaml.JSON_SCHEMA }) as unknown[];
    return { docs: all.filter((d): d is T => typeof d === 'object' && d !== null), error: null };
  } catch (err) {
    return { docs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export const kindKey = (ref: { apiVersion?: string; kind?: string }) =>
  `${ref.apiVersion}|${ref.kind}`;

/** Distinct apiVersion/kind pairs, in order of first appearance. */
export function distinctKinds(docs: KubeDocument[]): KindRef[] {
  const byKey = new Map<string, KindRef>();
  for (const { apiVersion, kind } of docs) {
    if (apiVersion && kind && !byKey.has(kindKey({ apiVersion, kind }))) {
      byKey.set(kindKey({ apiVersion, kind }), { apiVersion, kind });
    }
  }
  return [...byKey.values()];
}

/** The kind to document: the user's choice, else the preferred kind, else the first one. */
export function pickKind(
  kinds: KindRef[],
  chosen: string | null,
  preferredKind?: string
): KindRef | undefined {
  return (
    kinds.find(k => kindKey(k) === chosen) ?? kinds.find(k => k.kind === preferredKind) ?? kinds[0]
  );
}
