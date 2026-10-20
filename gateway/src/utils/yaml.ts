/**
 * Conversion between the resource object edited by the forms and the YAML text shown in the
 * editor. Both directions are lossless for the object (comments in the YAML are not preserved
 * once a form field changes, as the text is regenerated from the object).
 */
import * as yaml from 'js-yaml';
import { KubeJson } from '../resources/types';
import { dropUndefined, isPlainObject } from './objects';

/** Serializes a resource to YAML. Keys keep their insertion order. */
export function toYaml(value: unknown): string {
  return yaml.dump(dropUndefined(value), { noRefs: true, lineWidth: -1, skipInvalid: true });
}

export interface ParseResult {
  /** The parsed resource; absent when the text could not be used. */
  value?: KubeJson;
  error?: string;
  /** 1-based line of a syntax error, when known. */
  line?: number;
}

/** Parses editor text. Exactly one YAML (or JSON) document describing an object is accepted. */
export function parseYaml(text: string): ParseResult {
  let documents: unknown[];
  try {
    documents = yaml.loadAll(text).filter(doc => doc !== null && doc !== undefined);
  } catch (err) {
    const exception = err as yaml.YAMLException;
    return {
      error: exception?.reason || exception?.message || 'Invalid YAML',
      line: exception?.mark ? exception.mark.line + 1 : undefined,
    };
  }

  if (documents.length === 0) return { error: 'The document is empty' };
  if (documents.length > 1) {
    return { error: 'Only one resource can be edited at a time (found multiple documents)' };
  }
  const [document] = documents;
  if (!isPlainObject(document)) {
    return { error: 'The document must be a single Kubernetes object' };
  }
  return { value: document as KubeJson };
}

const SERVER_METADATA = ['managedFields', 'creationTimestamp', 'generation', 'uid', 'selfLink'];

/**
 * Prepares a live object for editing: drops the status and the server-managed metadata that only
 * add noise. `resourceVersion` is kept so that saving fails on a concurrent modification instead
 * of silently overwriting it.
 */
export function cleanForEdit(obj: KubeJson): KubeJson {
  const rest: KubeJson = { ...obj };
  delete rest.status;
  const cleanMetadata: Record<string, unknown> = { ...(obj.metadata || {}) };
  for (const key of SERVER_METADATA) delete cleanMetadata[key];
  return { ...rest, metadata: cleanMetadata };
}

/** Same as `cleanForEdit`, without `resourceVersion`: the form the user reads in a diff. */
export function cleanForDisplay(obj: KubeJson): KubeJson {
  const cleaned = cleanForEdit(obj);
  const metadata = { ...(cleaned.metadata || {}) };
  delete metadata.resourceVersion;
  return { ...cleaned, metadata };
}
