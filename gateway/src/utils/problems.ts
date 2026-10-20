/**
 * Aggregation of everything that needs attention across the Gateway API objects of a cluster,
 * for the overview page: failing conditions, references that are not permitted, dangling
 * references and routes that are not attached to anything.
 */
import { KubeJson } from '../resources/types';
import { computeHealth, problemTitle, reasonHint } from './conditions';
import { asArray, asRecord } from './objects';
import { checkReferences } from './referenceGrants';
import { groupOf, routeBackends } from './refs';

export interface AttentionItem {
  level: 'error' | 'warning';
  /** The object that needs attention. */
  group: string;
  kind: string;
  namespace?: string;
  name: string;
  /** Short problem title, e.g. `Not programmed` or `Reference not permitted`. */
  title: string;
  /** Condition reason reported by the controller, when the item comes from a condition. */
  reason?: string;
  /** Explanation: the controller message or what the plugin found. */
  detail: string;
  /** Plain-language hint for well-known reasons. */
  hint?: string;
}

export interface AttentionInput {
  /** Every Gateway API object to inspect. */
  objects: KubeJson[];
  /** ReferenceGrants, or `null` when they cannot be evaluated. */
  grants: KubeJson[] | null;
  /** Services, or `null` when they are unknown (not listed or not permitted). */
  services: KubeJson[] | null;
  /** Names of the GatewayClasses, or `null` when unknown. */
  gatewayClasses: string[] | null;
}

const ROUTE_KINDS = new Set(['HTTPRoute', 'GRPCRoute', 'TLSRoute', 'TCPRoute', 'UDPRoute']);

function identity(obj: KubeJson) {
  return {
    group: groupOf(obj.apiVersion),
    kind: obj.kind || '',
    namespace: obj.metadata?.namespace,
    name: obj.metadata?.name || '',
  };
}

/** Collects the attention items of one object. */
export function attentionFor(
  obj: KubeJson,
  input: Omit<AttentionInput, 'objects'>
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const id = identity(obj);

  for (const problem of computeHealth(obj).problems) {
    if (problem.level === 'pending') continue;
    items.push({
      ...id,
      level: problem.level,
      title: problemTitle(problem),
      reason: problem.reason,
      detail: problem.message || '',
      hint: reasonHint(problem.reason),
    });
  }

  for (const ref of checkReferences(obj, input.grants)) {
    if (ref.state !== 'denied') continue;
    items.push({
      ...id,
      level: 'error',
      title: 'Reference not permitted',
      detail: `${ref.purpose} ${ref.to.kind} ${ref.to.namespace}/${ref.to.name} is in another namespace and no ReferenceGrant in "${ref.to.namespace}" allows ${ref.from.kind} from "${ref.from.namespace}".`,
    });
  }

  if (ROUTE_KINDS.has(id.kind)) {
    if (asArray(asRecord(obj.spec).parentRefs).length === 0) {
      items.push({
        ...id,
        level: 'warning',
        title: 'Not attached',
        detail: 'The route has no parentRefs, so no Gateway serves it.',
      });
    }
    if (input.services) {
      const seen = new Set<string>();
      for (const backend of routeBackends(obj)) {
        const { ref } = backend;
        if (ref.kind !== 'Service' || ref.group !== '') continue;
        const key = `${ref.namespace}/${ref.name}:${ref.port ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const service = input.services.find(
          s => s.metadata?.name === ref.name && s.metadata?.namespace === ref.namespace
        );
        if (!service) {
          items.push({
            ...id,
            level: 'error',
            title: 'Backend not found',
            detail: `Service ${ref.namespace}/${ref.name} does not exist.`,
          });
        } else if (ref.port !== undefined) {
          const ports = asArray<{ port?: number }>(asRecord(service.spec).ports);
          if (!ports.some(p => p?.port === ref.port)) {
            items.push({
              ...id,
              level: 'error',
              title: 'Backend port not found',
              detail: `Service ${ref.namespace}/${ref.name} does not expose port ${ref.port}.`,
            });
          }
        }
      }
    }
  }

  if (id.kind === 'Gateway' && input.gatewayClasses) {
    const className = asRecord(obj.spec).gatewayClassName;
    if (typeof className === 'string' && className && !input.gatewayClasses.includes(className)) {
      items.push({
        ...id,
        level: 'error',
        title: 'GatewayClass not found',
        detail: `GatewayClass "${className}" does not exist, so no controller manages this Gateway.`,
      });
    }
  }

  return items;
}

/** Collects the attention items of all objects, errors first. */
export function collectAttention(input: AttentionInput): AttentionItem[] {
  const { objects, ...rest } = input;
  const items = objects.flatMap(obj => attentionFor(obj, rest));
  return items.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
    return (
      a.kind.localeCompare(b.kind) ||
      (a.namespace || '').localeCompare(b.namespace || '') ||
      a.name.localeCompare(b.name)
    );
  });
}
