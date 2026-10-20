/**
 * Pure helpers around Kubernetes API requests: REST paths of resources and interpretation of the
 * error messages the API server returns for rejected writes.
 */
import { findKind, KindInfo } from '../resources/registry';
import { KubeJson } from '../resources/types';
import { groupOf } from './refs';

/** REST path of a resource collection or, with `name`, of one object. */
export function resourcePath(options: {
  apiVersion: string;
  plural: string;
  namespace?: string;
  name?: string;
}): string {
  const { apiVersion, plural, namespace, name } = options;
  const root = apiVersion.includes('/') ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const scope = namespace ? `/namespaces/${encodeURIComponent(namespace)}` : '';
  const item = name ? `/${encodeURIComponent(name)}` : '';
  return `${root}${scope}/${plural}${item}`;
}

export type WriteMode = 'create' | 'update';

export interface WriteTarget {
  info: KindInfo;
  /** Path to POST to (create) or PUT to (update), without query parameters. */
  path: string;
  method: 'POST' | 'PUT';
}

/**
 * Works out where a resource has to be written. Throws a descriptive error when the object is not
 * something this plugin can write (unknown kind, missing name, wrong scope).
 */
export function writeTarget(obj: KubeJson, mode: WriteMode): WriteTarget {
  const apiVersion = obj.apiVersion;
  if (!apiVersion || !obj.kind) {
    throw new Error('The resource needs both an apiVersion and a kind.');
  }
  const info = findKind(obj.kind, groupOf(apiVersion));
  if (!info) {
    throw new Error(
      `${apiVersion} ${obj.kind} is not a Gateway API kind this editor can apply. Check apiVersion and kind.`
    );
  }
  const name = obj.metadata?.name;
  const namespace = obj.metadata?.namespace;
  if (!name) throw new Error('metadata.name is required.');
  if (info.namespaced && !namespace) throw new Error('metadata.namespace is required.');
  if (!info.namespaced && namespace) {
    throw new Error(`${info.kind} is cluster-scoped: remove metadata.namespace.`);
  }

  return {
    info,
    method: mode === 'create' ? 'POST' : 'PUT',
    path: resourcePath({
      apiVersion,
      plural: info.plural,
      namespace: info.namespaced ? namespace : undefined,
      name: mode === 'update' ? name : undefined,
    }),
  };
}

/** Query string for a write: strict field validation, optionally as a server-side dry-run. */
export function writeQuery(dryRun: boolean): string {
  // Strict validation turns unknown and duplicate fields (typos in the YAML) into errors instead
  // of silently dropping them, which is what CRDs do by default.
  return `?fieldValidation=Strict${dryRun ? '&dryRun=All' : ''}`;
}

export interface ApiFailure {
  /** One-line summary of what went wrong. */
  summary: string;
  /** Individual field errors, when the server reported a list of causes. */
  causes: Array<{ field?: string; message: string }>;
  /** HTTP status, when known. */
  status?: number;
}

const HTTP_PREFIX = /^[A-Za-z][A-Za-z -]* - /;
const FIELD_CAUSE = /^([A-Za-z_][\w.[\]"'/-]*): (.+)$/;

/** Splits a cause list on top-level `, ` separators, ignoring those inside quotes or brackets. */
function splitCauses(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') quote = !quote;
    if (!quote && (char === '[' || char === '{' || char === '(')) depth++;
    if (!quote && (char === ']' || char === '}' || char === ')')) depth = Math.max(0, depth - 1);
    if (!quote && depth === 0 && char === ',' && text[i + 1] === ' ') {
      // Only split when what follows looks like the start of another field error.
      const rest = text.slice(i + 2);
      if (/^[A-Za-z_<][\w.[\]"'/<>-]*: /.test(rest)) {
        parts.push(current);
        current = '';
        i++;
        continue;
      }
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * Turns an API error into a summary and a list of field errors.
 *
 * Validation failures arrive as one long message such as
 * `HTTPRoute.gateway… "web" is invalid: [spec.rules[0].backendRefs[0].port: Required value, …]`,
 * which is unreadable in a single line; this splits it per field.
 */
export function parseApiError(error: unknown): ApiFailure {
  const status = (error as { status?: number } | null)?.status;
  let message =
    typeof error === 'string'
      ? error
      : (error as { message?: string } | null)?.message || 'The request failed.';
  // Headlamp prefixes the server message with the HTTP status text ("Unprocessable Entity - …").
  message = message.replace(HTTP_PREFIX, '').trim();

  if (status === 403) {
    return {
      summary: message || 'You do not have permission to perform this action.',
      causes: [],
      status,
    };
  }
  if (status === 409) {
    const exists = /already exists/i.test(message);
    return {
      summary: exists ? message : `${message} Reload the resource and apply your changes again.`,
      causes: [],
      status,
    };
  }

  const invalid = /^([\s\S]*? is invalid): ([\s\S]*)$/.exec(message);
  if (invalid) {
    let detail = invalid[2].trim();
    if (detail.startsWith('[') && detail.endsWith(']')) detail = detail.slice(1, -1);
    const causes = splitCauses(detail).map(part => {
      const match = FIELD_CAUSE.exec(part);
      return match ? { field: match[1], message: match[2] } : { message: part };
    });
    return { summary: invalid[1], causes, status };
  }

  // Strict field validation: `… strict decoding error: unknown field "spec.foo", unknown field …`
  const strict = /strict decoding error: ([\s\S]*)$/.exec(message);
  if (strict) {
    const causes = strict[1]
      .split(/, (?=unknown field|duplicate field)/)
      .map(part => ({ message: part.trim() }));
    return { summary: 'The resource contains fields the API does not know', causes, status };
  }

  return { summary: message, causes: [], status };
}
