/**
 * Governance (policy.open-cluster-management.io): Policy, PlacementBinding, PolicySet,
 * PolicyAutomation, and the ConfigurationPolicy / OperatorPolicy templates delivered inside
 * policies. Field names follow governance-policy-propagator and config-policy-controller
 * v0.14.0 – v0.20.0; labels follow `controllers/common` of the propagator.
 */
import { Health, KubeJson, LabelSelector } from './common';

export const POLICY_GROUP = 'policy.open-cluster-management.io';

/** Labels the propagator puts on replicated policies (in the managed cluster namespaces). */
export const ROOT_POLICY_LABEL = `${POLICY_GROUP}/root-policy`;
export const POLICY_CLUSTER_NAME_LABEL = `${POLICY_GROUP}/cluster-name`;
export const POLICY_CLUSTER_NAMESPACE_LABEL = `${POLICY_GROUP}/cluster-namespace`;

/** Annotations used by the policy framework and its compliance reporting. */
export const POLICY_ANNOTATIONS = {
  standards: `${POLICY_GROUP}/standards`,
  categories: `${POLICY_GROUP}/categories`,
  controls: `${POLICY_GROUP}/controls`,
} as const;

/** Add-on names of the policy framework (governance-policy-addon-controller). */
export const GOVERNANCE_ADDONS = ['governance-policy-framework', 'config-policy-controller'];

export type Compliance = 'Compliant' | 'NonCompliant' | 'Pending' | 'Terminating';
export type Remediation = 'inform' | 'enforce';

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const COMPLIANCE_TYPES = ['musthave', 'mustonlyhave', 'mustnothave'] as const;
export const PRUNE_BEHAVIORS = ['None', 'DeleteIfCreated', 'DeleteAll'] as const;

export interface PolicyTemplate {
  objectDefinition: KubeJson;
  ignorePending?: boolean;
  extraDependencies?: PolicyDependency[];
}

export interface PolicyDependency {
  apiVersion?: string;
  kind?: string;
  name: string;
  namespace?: string;
  compliance: 'Compliant' | 'NonCompliant' | 'Pending';
}

export interface PolicyJson extends KubeJson {
  spec?: {
    disabled?: boolean;
    remediationAction?: string;
    'policy-templates'?: PolicyTemplate[];
    dependencies?: PolicyDependency[];
    copyPolicyMetadata?: boolean;
    hubTemplateOptions?: { serviceAccountName?: string };
  };
  status?: {
    compliant?: Compliance;
    placement?: Array<{
      placement?: string;
      placementBinding?: string;
      placementRule?: string;
      policySet?: string;
      decisions?: Array<{ clusterName?: string; clusterNamespace?: string }>;
    }>;
    status?: Array<{ clustername?: string; clusternamespace?: string; compliant?: Compliance }>;
    details?: Array<{
      compliant?: Compliance;
      templateMeta?: { name?: string; namespace?: string };
      history?: Array<{ eventName?: string; lastTimestamp?: string; message?: string }>;
    }>;
  };
}

export function compliance(p: { status?: { compliant?: string } }): Compliance | undefined {
  return (p.status?.compliant as Compliance) || undefined;
}

export function complianceHealth(c: string | undefined): Health {
  if (c === 'Compliant') return 'success';
  if (c === 'NonCompliant') return 'error';
  if (c === 'Pending') return 'warning';
  return 'unknown';
}

/** Policies replicated by the propagator into cluster namespaces carry the root policy label. */
export function isReplicatedPolicy(p: { metadata: KubeJson['metadata'] }): boolean {
  return !!p.metadata.labels?.[ROOT_POLICY_LABEL];
}

/** Root policy of a replicated policy (label value "<namespace>.<name>"). */
export function rootPolicyOf(p: {
  metadata: KubeJson['metadata'];
}): { namespace: string; name: string } | undefined {
  const value = p.metadata.labels?.[ROOT_POLICY_LABEL];
  if (!value) return undefined;
  const dot = value.indexOf('.');
  if (dot <= 0) return undefined;
  // Namespaces cannot contain a ".", names can: the first "." separates them.
  return { namespace: value.slice(0, dot), name: value.slice(dot + 1) };
}

/** Replicated copies of a root policy. */
export function replicasOf(root: PolicyJson, policies: PolicyJson[]): PolicyJson[] {
  const key = `${root.metadata.namespace}.${root.metadata.name}`;
  return policies.filter(p => p.metadata.labels?.[ROOT_POLICY_LABEL] === key);
}

/** Normalized remediation of a policy ("inform" when unset, as the framework defaults). */
export function remediationOf(p: {
  spec?: { remediationAction?: string };
}): Remediation | undefined {
  const r = (p.spec?.remediationAction || '').toLowerCase();
  if (r === 'enforce') return 'enforce';
  if (r === 'inform') return 'inform';
  return undefined;
}

export interface ClusterCompliance {
  total: number;
  compliant: number;
  nonCompliant: number;
  pending: number;
  unknown: number;
}

export function clusterCompliance(p: PolicyJson): ClusterCompliance {
  const list = p.status?.status || [];
  const out: ClusterCompliance = {
    total: list.length,
    compliant: 0,
    nonCompliant: 0,
    pending: 0,
    unknown: 0,
  };
  for (const s of list) {
    if (s.compliant === 'Compliant') out.compliant++;
    else if (s.compliant === 'NonCompliant') out.nonCompliant++;
    else if (s.compliant === 'Pending') out.pending++;
    else out.unknown++;
  }
  return out;
}

/** Comma separated annotation values (standards, categories, controls). */
export function annotationList(p: { metadata: KubeJson['metadata'] }, key: string): string[] {
  return (p.metadata.annotations?.[key] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export interface TemplateSummary {
  kind: string;
  name: string;
  apiVersion: string;
  severity?: string;
  remediation?: string;
}

export function templateSummaries(p: PolicyJson): TemplateSummary[] {
  return (p.spec?.['policy-templates'] || []).map(t => {
    const o = t.objectDefinition || ({} as KubeJson);
    return {
      kind: o.kind || '?',
      name: o.metadata?.name || '?',
      apiVersion: o.apiVersion || '',
      severity: o.spec?.severity,
      remediation: o.spec?.remediationAction,
    };
  });
}

/** Latest compliance message per template of a replicated policy. */
export function latestMessages(
  p: PolicyJson
): Array<{ template: string; compliant?: Compliance; message?: string; time?: string }> {
  return (p.status?.details || []).map(d => ({
    template: d.templateMeta?.name || '?',
    compliant: d.compliant,
    message: d.history?.[0]?.message,
    time: d.history?.[0]?.lastTimestamp,
  }));
}

export function remediationPatch(r: Remediation) {
  return { spec: { remediationAction: r } };
}

export function disabledPatch(disabled: boolean) {
  return { spec: { disabled } };
}

// ----- PlacementBinding / PolicySet / PolicyAutomation -----

export interface PlacementBindingJson extends KubeJson {
  placementRef?: { apiGroup?: string; kind?: string; name?: string };
  subjects?: Array<{ apiGroup?: string; kind?: string; name?: string }>;
  bindingOverrides?: { remediationAction?: string };
  subFilter?: string;
}

export interface PolicySetJson extends KubeJson {
  spec?: { description?: string; policies?: string[] };
  status?: {
    compliant?: Compliance;
    statusMessage?: string;
    placement?: Array<{ placement?: string; placementBinding?: string }>;
  };
}

export interface PolicyAutomationJson extends KubeJson {
  spec?: {
    policyRef?: string;
    mode?: 'once' | 'everyEvent' | 'disabled' | string;
    eventHook?: string;
    delayAfterRunSeconds?: number;
    automationDef?: {
      name?: string;
      secret?: string;
      type?: string;
      extra_vars?: Record<string, unknown>;
      jobTtl?: number;
      policyViolationsLimit?: number;
    };
  };
  status?: { clustersWithEvent?: Record<string, unknown> };
}

/** Bindings that bind a policy directly or through one of the given policy sets. */
export function bindingsOf(
  policy: { metadata: KubeJson['metadata'] },
  bindings: PlacementBindingJson[],
  sets: PolicySetJson[]
): PlacementBindingJson[] {
  const ns = policy.metadata.namespace;
  const setNames = sets
    .filter(
      s => s.metadata.namespace === ns && (s.spec?.policies || []).includes(policy.metadata.name)
    )
    .map(s => s.metadata.name);
  return bindings.filter(
    b =>
      b.metadata.namespace === ns &&
      (b.subjects || []).some(
        s =>
          (s.kind === 'Policy' && s.name === policy.metadata.name) ||
          (s.kind === 'PolicySet' && setNames.includes(s.name || ''))
      )
  );
}

export function setsContaining(
  policy: { metadata: KubeJson['metadata'] },
  sets: PolicySetJson[]
): PolicySetJson[] {
  return sets.filter(
    s =>
      s.metadata.namespace === policy.metadata.namespace &&
      (s.spec?.policies || []).includes(policy.metadata.name)
  );
}

/** Bindings that use a placement (same namespace, kind Placement). */
export function bindingsOfPlacement(
  placement: { metadata: KubeJson['metadata'] },
  bindings: PlacementBindingJson[]
): PlacementBindingJson[] {
  return bindings.filter(
    b =>
      b.metadata.namespace === placement.metadata.namespace &&
      b.placementRef?.kind === 'Placement' &&
      b.placementRef?.name === placement.metadata.name
  );
}

// ----- Template builders -----

export interface ConfigPolicyOptions {
  name: string;
  remediationAction: Remediation;
  severity?: string;
  complianceType: string;
  objects: KubeJson[];
  pruneObjectBehavior?: string;
  namespaceInclude?: string[];
  namespaceExclude?: string[];
}

/** A policy template wrapping a ConfigurationPolicy over the given objects. */
export function configurationPolicyTemplate(o: ConfigPolicyOptions): PolicyTemplate {
  const namespaceSelector =
    (o.namespaceInclude || []).length > 0 || (o.namespaceExclude || []).length > 0
      ? {
          ...(o.namespaceInclude?.length ? { include: o.namespaceInclude } : {}),
          ...(o.namespaceExclude?.length ? { exclude: o.namespaceExclude } : {}),
        }
      : undefined;
  return {
    objectDefinition: {
      apiVersion: `${POLICY_GROUP}/v1`,
      kind: 'ConfigurationPolicy',
      metadata: { name: o.name },
      spec: {
        remediationAction: o.remediationAction,
        ...(o.severity ? { severity: o.severity } : {}),
        ...(namespaceSelector ? { namespaceSelector } : {}),
        ...(o.pruneObjectBehavior && o.pruneObjectBehavior !== 'None'
          ? { pruneObjectBehavior: o.pruneObjectBehavior }
          : {}),
        'object-templates': o.objects.map(objectDefinition => ({
          complianceType: o.complianceType,
          objectDefinition,
        })),
      },
    },
  };
}

export interface OperatorPolicyOptions {
  name: string;
  remediationAction: Remediation;
  severity?: string;
  complianceType: 'musthave' | 'mustnothave';
  packageName: string;
  namespace?: string;
  channel?: string;
  source?: string;
  sourceNamespace?: string;
  upgradeApproval: 'None' | 'Automatic';
  versions?: string[];
}

/** A policy template wrapping an OperatorPolicy (OLM). */
export function operatorPolicyTemplate(o: OperatorPolicyOptions): PolicyTemplate {
  const subscription: Record<string, string> = { name: o.packageName };
  if (o.namespace) subscription.namespace = o.namespace;
  if (o.channel) subscription.channel = o.channel;
  if (o.source) subscription.source = o.source;
  if (o.sourceNamespace) subscription.sourceNamespace = o.sourceNamespace;
  return {
    objectDefinition: {
      apiVersion: `${POLICY_GROUP}/v1beta1`,
      kind: 'OperatorPolicy',
      metadata: { name: o.name },
      spec: {
        remediationAction: o.remediationAction,
        ...(o.severity ? { severity: o.severity } : {}),
        complianceType: o.complianceType,
        subscription,
        upgradeApproval: o.upgradeApproval,
        ...(o.versions?.length ? { versions: o.versions } : {}),
      },
    },
  };
}

/** A PlacementBinding that binds policies (or policy sets) to a Placement. */
export function placementBinding(
  name: string,
  namespace: string,
  placement: string,
  subjects: Array<{ kind: 'Policy' | 'PolicySet'; name: string }>,
  apiVersion = `${POLICY_GROUP}/v1`
): PlacementBindingJson {
  return {
    apiVersion,
    kind: 'PlacementBinding',
    metadata: { name, namespace },
    placementRef: {
      apiGroup: 'cluster.open-cluster-management.io',
      kind: 'Placement',
      name: placement,
    },
    subjects: subjects.map(s => ({ apiGroup: POLICY_GROUP, kind: s.kind, name: s.name })),
  };
}

// ----- PolicyGenerator export -----

export interface PolicyGeneratorExport {
  /** The PolicyGenerator configuration (kustomize generator, not a cluster resource). */
  generator: Record<string, unknown>;
  /** Manifest files referenced by the generator: path → objects. */
  manifests: Array<{ path: string; objects: KubeJson[] }>;
}

/**
 * Equivalent PolicyGenerator configuration for a policy built from ConfigurationPolicy
 * templates, for teams that keep policies in Git and render them with kustomize. Each template
 * becomes one manifest file; the placement is referenced by name.
 */
export function toPolicyGenerator(policy: PolicyJson, placement: string): PolicyGeneratorExport {
  const name = policy.metadata.name;
  const manifests: PolicyGeneratorExport['manifests'] = [];
  const entries: Array<Record<string, unknown>> = [];
  for (const t of policy.spec?.['policy-templates'] || []) {
    const o = t.objectDefinition;
    if (o?.kind === 'ConfigurationPolicy') {
      const path = `input/${name}/${o.metadata?.name || 'config'}.yaml`;
      const templates: Array<{ complianceType?: string; objectDefinition: KubeJson }> =
        o.spec?.['object-templates'] || [];
      manifests.push({ path, objects: templates.map(x => x.objectDefinition) });
      const first = templates[0];
      entries.push({
        path,
        name: o.metadata?.name,
        ...(first?.complianceType ? { complianceType: first.complianceType } : {}),
        ...(o.spec?.severity ? { severity: o.spec.severity } : {}),
        ...(o.spec?.remediationAction ? { remediationAction: o.spec.remediationAction } : {}),
        ...(o.spec?.namespaceSelector ? { namespaceSelector: o.spec.namespaceSelector } : {}),
        ...(o.spec?.pruneObjectBehavior ? { pruneObjectBehavior: o.spec.pruneObjectBehavior } : {}),
      });
    } else if (o) {
      // Other policy kinds (OperatorPolicy, Gatekeeper, ...) are passed through as manifests.
      const path = `input/${name}/${(o.kind || 'object').toLowerCase()}-${
        o.metadata?.name || 'policy'
      }.yaml`;
      manifests.push({ path, objects: [o] });
      entries.push({ path });
    }
  }
  const policyEntry: Record<string, unknown> = { name, manifests: entries };
  if (policy.spec?.disabled) policyEntry.disabled = true;
  const defaults: Record<string, unknown> = {
    namespace: policy.metadata.namespace,
    placement: { placementName: placement },
  };
  const remediation = remediationOf(policy);
  if (remediation) defaults.remediationAction = remediation;
  for (const key of ['standards', 'categories', 'controls'] as const) {
    const values = annotationList(policy, POLICY_ANNOTATIONS[key]);
    if (values.length > 0) defaults[key] = values;
  }
  return {
    generator: {
      apiVersion: `${POLICY_GROUP}/v1`,
      kind: 'PolicyGenerator',
      metadata: { name: `${name}-generator` },
      policyDefaults: defaults,
      policies: [policyEntry],
    },
    manifests,
  };
}

/** Selector helper for the configuration policy namespace selector. */
export type NamespaceSelector = LabelSelector & { include?: string[]; exclude?: string[] };
