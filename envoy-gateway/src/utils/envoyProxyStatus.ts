/**
 * Envoy Gateway does not report a status on EnvoyProxy objects. Whether a configuration is
 * working is visible on the GatewayClasses / Gateways that reference it: an invalid EnvoyProxy
 * makes the GatewayClass report `Accepted=False` (reason InvalidParameters) and the Gateway
 * report `Accepted=False` / `Programmed=False`.
 */
import { API_GROUP, ObjectJson, PolicyCondition } from '../resources/types';
import { Health } from './conditions';
import { objectRefMatches } from './targets';

export interface EnvoyProxyReference {
  kind: 'GatewayClass' | 'Gateway';
  name: string;
  namespace?: string;
  /** The condition that best describes the referencing object (Accepted, or Programmed). */
  condition?: PolicyCondition;
}

function mainCondition(obj: ObjectJson): PolicyCondition | undefined {
  const conditions: PolicyCondition[] = obj.status?.conditions || [];
  const accepted = conditions.find(c => c.type === 'Accepted');
  if (accepted?.status === 'False') return accepted;
  const programmed = conditions.find(c => c.type === 'Programmed');
  if (programmed?.status === 'False') return programmed;
  return accepted || programmed;
}

/** Returns the GatewayClasses and Gateways that use the given EnvoyProxy. */
export function envoyProxyReferences(
  proxy: { name: string; namespace?: string },
  gatewayClasses: ObjectJson[],
  gateways: ObjectJson[]
): EnvoyProxyReference[] {
  const target = { group: API_GROUP, kind: 'EnvoyProxy', ...proxy };
  const refs: EnvoyProxyReference[] = [];
  for (const gc of gatewayClasses) {
    // GatewayClass is cluster scoped, so its parametersRef must carry the namespace.
    if (objectRefMatches(gc.spec?.parametersRef, target, undefined)) {
      refs.push({
        kind: 'GatewayClass',
        name: gc.metadata?.name || '',
        condition: mainCondition(gc),
      });
    }
  }
  for (const gw of gateways) {
    const ns = gw.metadata?.namespace;
    if (objectRefMatches(gw.spec?.infrastructure?.parametersRef, target, ns)) {
      refs.push({
        kind: 'Gateway',
        name: gw.metadata?.name || '',
        namespace: ns,
        condition: mainCondition(gw),
      });
    }
  }
  return refs;
}

export interface EnvoyProxyHealth {
  health: Health;
  /** i18n key and params of the label. */
  key: string;
  params?: Record<string, string | number>;
  /** Reference responsible for the error, if any. */
  culprit?: EnvoyProxyReference;
}

export function envoyProxyHealth(refs: EnvoyProxyReference[]): EnvoyProxyHealth {
  if (refs.length === 0) return { health: 'unknown', key: 'Not in use' };
  const failing = refs.find(r => r.condition?.status === 'False');
  if (failing) {
    return {
      health: 'error',
      key: 'Rejected by {{kind}} {{name}}',
      params: { kind: failing.kind, name: failing.name },
      culprit: failing,
    };
  }
  if (refs.some(r => r.condition?.status === 'True')) {
    return { health: 'success', key: 'In use ({{n}})', params: { n: refs.length } };
  }
  return { health: 'warning', key: 'Referenced, waiting for status' };
}
