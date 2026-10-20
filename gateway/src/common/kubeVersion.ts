/**
 * Kubernetes API version ordering.
 *
 * See https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/#version-priority
 */

const VERSION_RE = /^v(\d+)(?:(alpha|beta)(\d+))?$/;

interface ParsedVersion {
  major: number;
  /** 2 = GA, 1 = beta, 0 = alpha */
  stability: number;
  minor: number;
}

/** Bare version of a group version ("group/v1" → "v1"). */
export function bareVersion(version: string): string {
  return version.includes('/') ? version.split('/').pop() || version : version;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_RE.exec(bareVersion(version));
  if (!match) return null;
  const stability = match[2] === 'alpha' ? 0 : match[2] === 'beta' ? 1 : 2;
  return { major: Number(match[1]), stability, minor: match[3] ? Number(match[3]) : 0 };
}

/**
 * Comparator that sorts versions from highest to lowest priority (GA > beta > alpha, then by
 * number). Accepts bare versions ("v1beta1") and group versions ("group/v1beta1"); versions
 * that do not follow the Kubernetes format sort last, alphabetically.
 */
export function compareKubeVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.stability !== pb.stability) return pb.stability - pa.stability;
  if (pa.major !== pb.major) return pb.major - pa.major;
  return pb.minor - pa.minor;
}

/** Orders versions with the preferred one first, then by Kubernetes version priority. */
export function orderVersions(versions: string[], preferred?: string): string[] {
  return [...versions].sort((a, b) => {
    if (a === preferred) return -1;
    if (b === preferred) return 1;
    return compareKubeVersions(a, b);
  });
}
