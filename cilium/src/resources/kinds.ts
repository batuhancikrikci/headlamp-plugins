/**
 * Scope of the supported kinds. Kept free of Headlamp imports so validation and templates can
 * use it in unit tests; the resource classes take their `isNamespaced` from here.
 */
const NAMESPACED_KINDS = new Set([
  'CiliumNetworkPolicy',
  'CiliumEndpoint',
  'CiliumNodeConfig',
  'CiliumLocalRedirectPolicy',
  'CiliumEnvoyConfig',
]);

/** Whether objects of a Cilium kind live in a namespace (all other kinds are cluster-scoped). */
export function isNamespacedKind(kind: string): boolean {
  return NAMESPACED_KINDS.has(kind);
}
