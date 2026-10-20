/**
 * Which objects of a wizard belong to another object of the same wizard, read from their
 * references so that it also holds after editing the YAML:
 *
 * - a credential Secret belongs to the BackendSecurityPolicy or MCPRoute that refers to it,
 * - an Envoy Gateway Backend belongs to the AIServiceBackend that refers to it,
 * - a BackendTLSPolicy belongs to the AIServiceBackend that owns the Backend it targets.
 *
 * Owner and dependent are always in the same namespace. Pure, unit tested.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Same as resources/external.ts, which imports Headlamp and so cannot be used in pure modules.
const ENVOY_GATEWAY_GROUP = 'gateway.envoyproxy.io';

/** Secret names a BackendSecurityPolicy refers to (in its own namespace). */
function policySecretNames(policy: Json): string[] {
  const spec: Json = policy.spec || {};
  const refs: Array<Json | undefined> = [
    spec.apiKey?.secretRef,
    spec.anthropicAPIKey?.secretRef,
    spec.azureAPIKey?.secretRef,
    spec.awsCredentials?.credentialsFile?.secretRef,
    spec.azureCredentials?.clientSecretRef,
    spec.gcpCredentials?.credentialsFile?.secretRef,
  ];
  return refs
    .filter(
      (r): r is Json => !!r?.name && (!r.namespace || r.namespace === policy.metadata?.namespace)
    )
    .map(r => r.name);
}

/** Secret names the API keys of an MCPRoute's backends refer to. */
function routeSecretNames(route: Json): string[] {
  return ((route.spec?.backendRefs || []) as Json[])
    .map(b => b.securityPolicy?.apiKey?.secretRef)
    .filter(
      (r): r is Json => !!r?.name && (!r.namespace || r.namespace === route.metadata?.namespace)
    )
    .map(r => r.name);
}

/** Name of the Envoy Gateway Backend an AIServiceBackend sends traffic to. */
function backendName(serviceBackend: Json): string | undefined {
  const ref: Json | undefined = serviceBackend.spec?.backendRef;
  if (!ref?.name || ref.kind !== 'Backend') return undefined;
  if (ref.group && ref.group !== ENVOY_GATEWAY_GROUP) return undefined;
  return ref.name;
}

function isEnvoyBackend(item: Json): boolean {
  return (
    item.kind === 'Backend' && String(item.apiVersion || '').startsWith(`${ENVOY_GATEWAY_GROUP}/`)
  );
}

/** Names of the Secrets a BackendSecurityPolicy or MCPRoute refers to. */
export function referencedSecretNames(owner: Json): string[] {
  if (owner.kind === 'BackendSecurityPolicy') return policySecretNames(owner);
  if (owner.kind === 'MCPRoute') return routeSecretNames(owner);
  return [];
}

/**
 * Secrets the object referred to before an edit and no longer does after it (e.g. the old Secret
 * after a key rotation); candidates for deletion when they belong to the object.
 */
export function releasedSecretNames(before: Json, after: Json): string[] {
  const kept = new Set(referencedSecretNames(after));
  return [...new Set(referencedSecretNames(before))].filter(name => !kept.has(name));
}

/** Dependent index → owner index. */
export function dependentLinks(items: Json[]): Map<number, number> {
  const links = new Map<number, number>();
  const sameNamespace = (a: Json, b: Json) => a.metadata?.namespace === b.metadata?.namespace;
  const find = (predicate: (item: Json) => boolean) => items.findIndex(predicate);

  items.forEach((item, i) => {
    const name = item.metadata?.name;
    if (!name) return;
    let owner = -1;
    if (item.kind === 'Secret') {
      owner = find(
        o =>
          sameNamespace(o, item) &&
          ((o.kind === 'BackendSecurityPolicy' && policySecretNames(o).includes(name)) ||
            (o.kind === 'MCPRoute' && routeSecretNames(o).includes(name)))
      );
    } else if (isEnvoyBackend(item)) {
      owner = find(
        o => o.kind === 'AIServiceBackend' && sameNamespace(o, item) && backendName(o) === name
      );
    } else if (item.kind === 'BackendTLSPolicy') {
      const targets: string[] = ((item.spec?.targetRefs || []) as Json[])
        .filter(r => r.kind === 'Backend' && (!r.group || r.group === ENVOY_GATEWAY_GROUP))
        .map(r => r.name);
      owner = find(
        o =>
          o.kind === 'AIServiceBackend' &&
          sameNamespace(o, item) &&
          targets.includes(backendName(o) || '')
      );
    }
    if (owner >= 0 && owner !== i) links.set(i, owner);
  });
  return links;
}
