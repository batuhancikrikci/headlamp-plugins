/**
 * Which Cilium policies select which endpoints.
 *
 * Cilium evaluates selectors against an endpoint's security labels: the pod labels plus derived
 * labels for its namespace, the namespace's own labels and the service account. A selector in a
 * namespaced policy is implicitly limited to the policy's namespace unless it names a namespace
 * itself.
 */
import { PolicyRule, policyRules } from '../resources/models/policy';
import { Labels, LabelSelector, PodLike } from '../resources/types';
import { matchesLabelSelector, selectorKeys } from './selectors';

export const NAMESPACE_LABEL = 'io.kubernetes.pod.namespace';
export const NAMESPACE_LABELS_PREFIX = 'io.cilium.k8s.namespace.labels.';
export const SERVICE_ACCOUNT_LABEL = 'io.cilium.k8s.policy.serviceaccount';

/** An endpoint as seen by the policy engine. */
export interface EndpointSubject {
  namespace: string;
  /** Full security label set, including the derived namespace labels. */
  labels: Labels;
}

/** Builds the security label set of a pod. */
export function subjectFromPod(pod: PodLike, namespaceLabels?: Labels): EndpointSubject {
  const namespace = pod.metadata.namespace || '';
  const labels: Labels = { ...(pod.metadata.labels || {}) };
  labels[NAMESPACE_LABEL] = namespace;
  for (const [key, value] of Object.entries(namespaceLabels || {})) {
    labels[`${NAMESPACE_LABELS_PREFIX}${key}`] = value;
  }
  if (pod.spec?.serviceAccountName) labels[SERVICE_ACCOUNT_LABEL] = pod.spec.serviceAccountName;
  return { namespace, labels };
}

/** Parses identity labels as reported on a CiliumEndpoint ("k8s:app=web"). */
export function parseIdentityLabels(labels: string[] = []): Labels {
  const out: Labels = {};
  for (const label of labels) {
    const separator = label.indexOf('=');
    const rawKey = separator === -1 ? label : label.slice(0, separator);
    const value = separator === -1 ? '' : label.slice(separator + 1);
    // Reserved labels (reserved:host, reserved:health) keep their source so that selectors
    // for ordinary labels do not match them by accident.
    const key = rawKey.replace(/^(k8s|any|unspec):/, '');
    out[key] = value;
  }
  return out;
}

export function subjectFromIdentityLabels(namespace: string, labels: string[]): EndpointSubject {
  const parsed = parseIdentityLabels(labels);
  if (!parsed[NAMESPACE_LABEL] && namespace) parsed[NAMESPACE_LABEL] = namespace;
  return { namespace, labels: parsed };
}

/** Whether a selector constrains the namespace on its own. */
export function selectsNamespaceExplicitly(selector?: LabelSelector | null): boolean {
  return selectorKeys(selector).some(
    key => key === NAMESPACE_LABEL || key.startsWith(NAMESPACE_LABELS_PREFIX)
  );
}

/**
 * Whether a selector of a policy matches an endpoint.
 *
 * @param policyNamespace - namespace of a CiliumNetworkPolicy; undefined for clusterwide ones.
 */
export function selectorMatchesSubject(
  selector: LabelSelector | null | undefined,
  policyNamespace: string | undefined,
  subject: EndpointSubject
): boolean {
  if (selector === null || selector === undefined) return false;
  if (
    policyNamespace !== undefined &&
    !selectsNamespaceExplicitly(selector) &&
    subject.namespace !== policyNamespace
  ) {
    return false;
  }
  return matchesLabelSelector(selector, subject.labels);
}

/** Whether a rule applies to the endpoint (rules with a nodeSelector apply to nodes only). */
export function ruleSelectsSubject(
  rule: PolicyRule,
  policyNamespace: string | undefined,
  subject: EndpointSubject
): boolean {
  if (!rule.endpointSelector) return false;
  // The subject selector of a namespaced policy can never reach outside its namespace.
  if (policyNamespace !== undefined && subject.namespace !== policyNamespace) return false;
  return matchesLabelSelector(rule.endpointSelector, subject.labels);
}

export interface PolicyLike {
  kind?: string;
  metadata: { name: string; namespace?: string };
  spec?: PolicyRule;
  specs?: PolicyRule[];
}

function policyNamespaceOf(policy: PolicyLike): string | undefined {
  return policy.kind === 'CiliumClusterwideNetworkPolicy'
    ? undefined
    : policy.metadata.namespace || undefined;
}

/** The rules of a policy that select the endpoint. */
export function selectingRules(policy: PolicyLike, subject: EndpointSubject): PolicyRule[] {
  const namespace = policyNamespaceOf(policy);
  return policyRules(policy).filter(rule => ruleSelectsSubject(rule, namespace, subject));
}

export function policySelectsSubject(policy: PolicyLike, subject: EndpointSubject): boolean {
  return selectingRules(policy, subject).length > 0;
}

export interface DirectionEnforcement {
  ingress: boolean;
  egress: boolean;
}

/** Whether a rule puts its endpoints into default deny for a direction. */
export function ruleDefaultDeny(rule: PolicyRule): DirectionEnforcement {
  const hasIngress = !!(rule.ingress?.length || rule.ingressDeny?.length);
  const hasEgress = !!(rule.egress?.length || rule.egressDeny?.length);
  return {
    ingress: hasIngress && rule.enableDefaultDeny?.ingress !== false,
    egress: hasEgress && rule.enableDefaultDeny?.egress !== false,
  };
}

/** Directions in which the given policies put an endpoint into default deny. */
export function expectedEnforcement(
  policies: PolicyLike[],
  subject: EndpointSubject
): DirectionEnforcement {
  const result: DirectionEnforcement = { ingress: false, egress: false };
  for (const policy of policies) {
    for (const rule of selectingRules(policy, subject)) {
      const deny = ruleDefaultDeny(rule);
      result.ingress = result.ingress || deny.ingress;
      result.egress = result.egress || deny.egress;
    }
  }
  return result;
}

/** Names of the CiliumCIDRGroups referenced by a policy. */
export function referencedCIDRGroups(policy: PolicyLike): string[] {
  const names = new Set<string>();
  for (const rule of policyRules(policy)) {
    const sets = [
      ...(rule.ingress || []).flatMap(r => r.fromCIDRSet || []),
      ...(rule.ingressDeny || []).flatMap(r => r.fromCIDRSet || []),
      ...(rule.egress || []).flatMap(r => r.toCIDRSet || []),
      ...(rule.egressDeny || []).flatMap(r => r.toCIDRSet || []),
    ];
    for (const set of sets) if (set.cidrGroupRef) names.add(set.cidrGroupRef);
  }
  return Array.from(names);
}
