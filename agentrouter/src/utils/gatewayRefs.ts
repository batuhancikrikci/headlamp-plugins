/**
 * Gateway parentRef form model shared by the AI Route and MCP Route forms.
 * Pure (no Headlamp runtime imports), unit tested.
 */
import type { ParentReference } from '../resources/common';
import { validateName } from './forms';

const GATEWAY_API_GROUP = 'gateway.networking.k8s.io';

export interface GatewayRefForm {
  name: string;
  namespace: string;
  sectionName: string;
  /** The parentRef this row was loaded from; written back unchanged if not edited. */
  original?: ParentReference;
}

export const newGatewayRef = (): GatewayRefForm => ({ name: '', namespace: '', sectionName: '' });

export function gatewayRefErrors(refs: GatewayRefForm[]): string[] {
  const errors: string[] = [];
  if (!refs.some(g => g.name)) errors.push('At least one Gateway is required.');
  refs.forEach((g, i) => {
    const e = g.name && validateName(g.name, `Gateway #${i + 1}`);
    if (e) errors.push(e);
  });
  return errors;
}

/** Form rows from existing parentRefs (only Gateway refs are editable; others are kept). */
export function gatewayRefsFromSpec(refs: ParentReference[] | undefined): GatewayRefForm[] {
  return (refs || []).map(r => ({
    name: r.name,
    namespace: r.namespace || '',
    sectionName: r.sectionName || '',
    original: r,
  }));
}

/** Converts the form rows to Gateway API parentRefs (namespace omitted when same as owner). */
export function toParentRefs(refs: GatewayRefForm[], ownerNamespace: string): ParentReference[] {
  return refs
    .filter(g => g.name)
    .map(g => {
      const o = g.original;
      if (
        o &&
        o.name === g.name &&
        (o.namespace || '') === g.namespace &&
        (o.sectionName || '') === g.sectionName
      ) {
        return o;
      }
      return {
        ...(o || {}),
        group: o?.group ?? GATEWAY_API_GROUP,
        kind: o?.kind ?? 'Gateway',
        name: g.name,
        namespace: g.namespace && g.namespace !== ownerNamespace ? g.namespace : undefined,
        sectionName: g.sectionName || undefined,
      };
    });
}
