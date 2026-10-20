/**
 * Client-side validation for the forms and wizards. The rules mirror the CRD schemas (required
 * fields, enums, patterns and ranges, see docs/API_MATRIX.md); the API server stays the source
 * of truth.
 */
import { isNamespacedKind } from '../api/kinds';
import { ValidationError } from '../common/form/types';
import { isValidDNSLabel, isValidResourceName } from '../common/objects';
import { isV1beta1 } from '../resources/models/addon';
import { parseChannelRef } from '../resources/models/apps';
import { KubeJson } from '../resources/models/common';
import { BUILTIN_PRIORITIZERS } from '../resources/models/placement';
import { isValidLabelKey, selectorProblems } from './selectors';

type Errors = ValidationError[];

const TAINT_KEY_RE =
  /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])$/;
const GROUP_NAME_RE = /^[a-zA-Z0-9][-A-Za-z0-9_.]{0,61}[a-zA-Z0-9]$/;
const COUNT_OR_PERCENT_RE = /^((100|[1-9][0-9]{0,1})%|[1-9][0-9]*)$/;
const MAX_FAILURES_RE = /^((100|[0-9]{1,2})%|[0-9]+)$/;
const PROGRESS_DEADLINE_RE = /^(([0-9])+[h|m|s])|None$/;
const SCORE_RATE_RE = /^[0-9]+[hms]$/;
const VARIABLE_NAME_RE = /^[a-zA-Z_][_a-zA-Z0-9]*$/;
const CONTAINER_ID_RE =
  /^(deployments|daemonsets|statefulsets|replicasets|jobs|cronjobs|pods|\*):.+:.+$/;

/** Placement versions accepted by the GitOpsCluster controller. */
export const GITOPS_PLACEMENT_VERSIONS = [
  'cluster.open-cluster-management.io/v1beta1',
  'cluster.open-cluster-management.io/v1alpha1',
];

export const TAINT_EFFECTS = ['NoSelect', 'PreferNoSelect', 'NoSelectIfNew'];
export const CHANNEL_TYPE_VALUES = [
  'Namespace',
  'HelmRepo',
  'ObjectBucket',
  'GitHub',
  'Git',
  'namespace',
  'helmrepo',
  'objectbucket',
  'github',
  'git',
];

function err(key: string, params?: Record<string, unknown>): ValidationError {
  return { key, params };
}

export function validateMetadata(json: KubeJson): Errors {
  const errors: Errors = [];
  const name = json.metadata?.name;
  if (!name) errors.push(err('Name is required'));
  else if (json.kind === 'ManagedCluster' && !isValidDNSLabel(name)) {
    errors.push(
      err(
        'Cluster name must be a DNS label (lowercase letters, digits and "-", at most 63 characters): the hub creates a namespace with the same name'
      )
    );
  } else if (!isValidResourceName(name)) {
    errors.push(err('Name must be a lowercase RFC 1123 subdomain (letters, digits, "-" and ".")'));
  }
  if (isNamespacedKind(json.kind)) {
    const ns = json.metadata?.namespace;
    if (!ns) errors.push(err('Namespace is required'));
    else if (!isValidDNSLabel(ns))
      errors.push(err('Namespace "{{ns}}" is not a valid name', { ns }));
  }
  for (const key of Object.keys(json.metadata?.labels || {})) {
    if (!isValidLabelKey(key)) errors.push(err('Invalid label key "{{key}}"', { key }));
  }
  return errors;
}

function validateManagedCluster(json: KubeJson): Errors {
  const errors: Errors = [];
  const spec = json.spec || {};
  (spec.managedClusterClientConfigs || []).forEach((c: { url?: string }, i: number) => {
    if (!c.url) errors.push(err('API server URL {{n}} is empty', { n: i + 1 }));
    else if (!/^https?:\/\//.test(c.url)) {
      errors.push(err('API server URL "{{url}}" must start with https://', { url: c.url }));
    }
  });
  (spec.taints || []).forEach(
    (taint: { key?: string; effect?: string; value?: string }, i: number) => {
      if (!taint.key || !TAINT_KEY_RE.test(taint.key) || taint.key.length > 316) {
        errors.push(err('Taint {{n}}: invalid key', { n: i + 1 }));
      }
      if (!taint.effect || !TAINT_EFFECTS.includes(taint.effect)) {
        errors.push(
          err('Taint {{n}}: effect must be NoSelect, PreferNoSelect or NoSelectIfNew', { n: i + 1 })
        );
      }
      if ((taint.value || '').length > 1024) {
        errors.push(err('Taint {{n}}: value is longer than 1024 characters', { n: i + 1 }));
      }
    }
  );
  if (
    spec.leaseDurationSeconds !== undefined &&
    !(Number.isInteger(spec.leaseDurationSeconds) && spec.leaseDurationSeconds > 0)
  ) {
    errors.push(err('Lease duration must be a positive number of seconds'));
  }
  return errors;
}

function validateClusterSet(json: KubeJson): Errors {
  const errors: Errors = [];
  const selector = json.spec?.clusterSelector;
  const type = selector?.selectorType;
  if (type && type !== 'ExclusiveClusterSetLabel' && type !== 'LabelSelector') {
    errors.push(err('Selector type must be ExclusiveClusterSetLabel or LabelSelector'));
  }
  if (type === 'LabelSelector') {
    errors.push(...selectorProblems(selector?.labelSelector, 'Cluster selector'));
  }
  (json.spec?.managedNamespaces || []).forEach((ns: { name?: string }) => {
    if (!isValidDNSLabel(ns.name)) {
      errors.push(err('Managed namespace "{{ns}}" is not a valid name', { ns: ns.name || '' }));
    }
  });
  return errors;
}

function validateBinding(json: KubeJson): Errors {
  const set = json.spec?.clusterSet;
  if (!set) return [err('Choose the cluster set to bind')];
  if (json.metadata?.name && set !== json.metadata.name) {
    return [err('The binding name must equal the cluster set name ("{{set}}")', { set })];
  }
  return [];
}

function validateValue(json: KubeJson): Errors {
  const value = json.spec?.value;
  if (!value) return [err('Value is required')];
  if (String(value).length > 1024) return [err('Value is longer than 1024 characters')];
  return [];
}

export function validatePlacementSpec(spec: KubeJson['spec']): Errors {
  const errors: Errors = [];
  const s = spec || {};
  if (
    s.numberOfClusters !== undefined &&
    !(Number.isInteger(s.numberOfClusters) && s.numberOfClusters >= 0)
  ) {
    errors.push(err('Number of clusters must be a whole number ≥ 0'));
  }
  (s.predicates || []).forEach((p: KubeJson['spec'], i: number) => {
    const where = `Predicate ${i + 1}`;
    const rcs = p?.requiredClusterSelector || {};
    errors.push(...selectorProblems(rcs.labelSelector, `${where} labels`));
    errors.push(...selectorProblems(rcs.claimSelector, `${where} claims`));
    (rcs.celSelector?.celExpressions || []).forEach((e: string, j: number) => {
      if (!e?.trim())
        errors.push(err('{{where}}: CEL expression {{n}} is empty', { where, n: j + 1 }));
    });
  });
  const mode = s.prioritizerPolicy?.mode;
  if (mode && mode !== 'Additive' && mode !== 'Exact') {
    errors.push(err('Prioritizer mode must be Additive or Exact'));
  }
  (s.prioritizerPolicy?.configurations || []).forEach((c: KubeJson['spec'], i: number) => {
    const n = i + 1;
    const coord = c?.scoreCoordinate || {};
    const type = coord.type || 'BuiltIn';
    if (type === 'BuiltIn' && !BUILTIN_PRIORITIZERS.includes(coord.builtIn)) {
      errors.push(err('Prioritizer {{n}}: choose a built-in prioritizer', { n }));
    }
    if (type === 'AddOn' && (!coord.addOn?.resourceName || !coord.addOn?.scoreName)) {
      errors.push(
        err('Prioritizer {{n}}: add-on prioritizers need a resource name and a score name', { n })
      );
    }
    if (
      c?.weight !== undefined &&
      !(Number.isInteger(c.weight) && c.weight >= -10 && c.weight <= 10)
    ) {
      errors.push(err('Prioritizer {{n}}: weight must be between -10 and 10', { n }));
    }
  });
  (s.tolerations || []).forEach((tol: KubeJson['spec'], i: number) => {
    const n = i + 1;
    const op = tol?.operator || 'Equal';
    if (op !== 'Equal' && op !== 'Exists') {
      errors.push(err('Toleration {{n}}: operator must be Equal or Exists', { n }));
    }
    if (op === 'Exists' && tol?.value) {
      errors.push(err('Toleration {{n}}: Exists must not have a value', { n }));
    }
    if (!tol?.key && op !== 'Exists') {
      errors.push(err('Toleration {{n}}: an empty key requires operator Exists', { n }));
    }
    if (tol?.key && !TAINT_KEY_RE.test(tol.key))
      errors.push(err('Toleration {{n}}: invalid key', { n }));
    if (tol?.effect && !TAINT_EFFECTS.includes(tol.effect)) {
      errors.push(err('Toleration {{n}}: invalid effect', { n }));
    }
  });
  const constraints = s.spreadPolicy?.spreadConstraints || [];
  if (constraints.length > 8) errors.push(err('At most 8 spread constraints are allowed'));
  constraints.forEach((c: KubeJson['spec'], i: number) => {
    const n = i + 1;
    if (!c?.topologyKey)
      errors.push(err('Spread constraint {{n}}: topology key is required', { n }));
    if (c?.topologyKeyType !== 'Label' && c?.topologyKeyType !== 'Claim') {
      errors.push(err('Spread constraint {{n}}: key type must be Label or Claim', { n }));
    }
    if (c?.maxSkew !== undefined && !(Number.isInteger(c.maxSkew) && c.maxSkew >= 1)) {
      errors.push(err('Spread constraint {{n}}: max skew must be ≥ 1', { n }));
    }
  });
  const group = s.decisionStrategy?.groupStrategy;
  if (
    group?.clustersPerDecisionGroup !== undefined &&
    !COUNT_OR_PERCENT_RE.test(String(group.clustersPerDecisionGroup))
  ) {
    errors.push(err('Clusters per decision group must be a number or a percentage (1–100%)'));
  }
  (group?.decisionGroups || []).forEach((g: KubeJson['spec'], i: number) => {
    if (!g?.groupName || !GROUP_NAME_RE.test(g.groupName)) {
      errors.push(err('Decision group {{n}}: invalid group name', { n: i + 1 }));
    }
  });
  if (s.scoreRateLimit && !SCORE_RATE_RE.test(s.scoreRateLimit)) {
    errors.push(err('Score rate limit must look like 30s, 5m or 1h'));
  }
  if (s.sortBy && s.sortBy !== 'ClusterName' && s.sortBy !== 'Score') {
    errors.push(err('Sort order must be ClusterName or Score'));
  }
  return errors;
}

function validateWorkSpec(spec: KubeJson['spec'], where = ''): Errors {
  const errors: Errors = [];
  const prefix = where ? `${where}: ` : '';
  const manifests = spec?.workload?.manifests || [];
  if (manifests.length === 0) errors.push(err('{{prefix}}Add at least one manifest', { prefix }));
  manifests.forEach((m: KubeJson, i: number) => {
    if (!m || typeof m !== 'object' || !m.apiVersion || !m.kind || !m.metadata?.name) {
      errors.push(
        err('{{prefix}}Manifest {{n}} needs apiVersion, kind and metadata.name', {
          prefix,
          n: i + 1,
        })
      );
    }
  });
  (spec?.manifestConfigs || []).forEach((c: KubeJson['spec'], i: number) => {
    const id = c?.resourceIdentifier;
    if (!id?.resource || !id?.name) {
      errors.push(
        err('{{prefix}}Manifest config {{n}} needs a resource and a name', { prefix, n: i + 1 })
      );
    }
    const type = c?.updateStrategy?.type;
    if (type && !['Update', 'CreateOnly', 'ServerSideApply', 'ReadOnly'].includes(type)) {
      errors.push(
        err('{{prefix}}Manifest config {{n}}: invalid update strategy', { prefix, n: i + 1 })
      );
    }
  });
  const policy = spec?.deleteOption?.propagationPolicy;
  if (policy && !['Foreground', 'Orphan', 'SelectivelyOrphan'].includes(policy)) {
    errors.push(
      err('{{prefix}}Deletion propagation must be Foreground, Orphan or SelectivelyOrphan', {
        prefix,
      })
    );
  }
  const ttl = spec?.deleteOption?.ttlSecondsAfterFinished;
  if (ttl !== undefined && !(Number.isInteger(ttl) && ttl >= 0)) {
    errors.push(err('{{prefix}}TTL must be a whole number of seconds', { prefix }));
  }
  return errors;
}

function validateRollout(rollout: KubeJson['spec'], n: number): Errors {
  const errors: Errors = [];
  if (!rollout) return errors;
  const type = rollout.type || 'All';
  if (!['All', 'Progressive', 'ProgressivePerGroup'].includes(type)) {
    errors.push(
      err('Placement {{n}}: rollout type must be All, Progressive or ProgressivePerGroup', { n })
    );
    return errors;
  }
  const key =
    type === 'All' ? 'all' : type === 'Progressive' ? 'progressive' : 'progressivePerGroup';
  const body = rollout[key] || {};
  if (body.maxFailures !== undefined && !MAX_FAILURES_RE.test(String(body.maxFailures))) {
    errors.push(err('Placement {{n}}: max failures must be a number or a percentage', { n }));
  }
  if (body.maxConcurrency !== undefined && !MAX_FAILURES_RE.test(String(body.maxConcurrency))) {
    errors.push(err('Placement {{n}}: max concurrency must be a number or a percentage', { n }));
  }
  if (
    body.progressDeadline !== undefined &&
    !PROGRESS_DEADLINE_RE.test(String(body.progressDeadline))
  ) {
    errors.push(err('Placement {{n}}: progress deadline must look like 10m, 1h or None', { n }));
  }
  return errors;
}

function validateMWRS(json: KubeJson): Errors {
  const errors: Errors = [];
  const refs = json.spec?.placementRefs || [];
  if (refs.length === 0) errors.push(err('Reference at least one placement'));
  refs.forEach((ref: KubeJson['spec'], i: number) => {
    if (!ref?.name) errors.push(err('Placement {{n}}: name is required', { n: i + 1 }));
    errors.push(...validateRollout(ref?.rolloutStrategy, i + 1));
  });
  const cascade = json.spec?.cascadeDeletionPolicy;
  if (cascade && cascade !== 'Background' && cascade !== 'Foreground') {
    errors.push(err('Cascade deletion policy must be Background or Foreground'));
  }
  errors.push(...validateWorkSpec(json.spec?.manifestWorkTemplate, 'Template'));
  return errors;
}

function validateSubscription(json: KubeJson): Errors {
  const errors: Errors = [];
  const spec = json.spec || {};
  if (!spec.channel) errors.push(err('Choose a channel'));
  else if (!parseChannelRef(spec.channel)) {
    errors.push(err('Channel must be written as "namespace/name"'));
  }
  if (spec.secondaryChannel && !parseChannelRef(spec.secondaryChannel)) {
    errors.push(err('Secondary channel must be written as "namespace/name"'));
  }
  const window = spec.timewindow;
  if (
    window?.windowtype &&
    !['active', 'blocked', 'Active', 'Blocked'].includes(window.windowtype)
  ) {
    errors.push(err('Time window type must be active or blocked'));
  }
  const ref = spec.placement?.placementRef;
  if (ref && !ref.name) errors.push(err('The placement reference needs a name'));
  return errors;
}

function validateChannel(json: KubeJson): Errors {
  const errors: Errors = [];
  const type = json.spec?.type;
  if (!type) errors.push(err('Channel type is required'));
  else if (!CHANNEL_TYPE_VALUES.includes(type))
    errors.push(err('Unknown channel type "{{type}}"', { type }));
  if (!json.spec?.pathname) errors.push(err('Path / URL is required'));
  else if (
    ['git', 'github', 'helmrepo', 'objectbucket'].includes(String(type).toLowerCase()) &&
    !/^(https?|ssh|git):\/\/|^git@/.test(json.spec.pathname)
  ) {
    errors.push(err('The repository URL must start with https://, http://, ssh:// or git@'));
  }
  return errors;
}

function validateGitOpsCluster(json: KubeJson): Errors {
  const errors: Errors = [];
  if (String(json.apiVersion || '').endsWith('/v1alpha1')) {
    // argocd-agent API (argocd-pull-integration): placementRef and argoCDAgentAddon are required.
    if (!json.spec?.placementRef?.name) errors.push(err('Choose a placement'));
    if (!json.spec?.argoCDAgentAddon) errors.push(err('The Argo CD agent settings are required'));
    const mode = json.spec?.argoCDAgentAddon?.mode;
    if (mode && mode !== 'managed' && mode !== 'autonomous') {
      errors.push(err('The agent mode must be managed or autonomous'));
    }
    return errors;
  }
  if (!json.spec?.argoServer?.argoNamespace) errors.push(err('Argo CD namespace is required'));
  const ref = json.spec?.placementRef;
  if (!ref?.name) errors.push(err('Choose a placement'));
  // The GitOps controller only accepts Placements (v1beta1 or v1alpha1) in its own namespace.
  if (ref && ref.kind !== 'Placement') {
    errors.push(err('The placement reference must have kind Placement'));
  }
  if (ref && !GITOPS_PLACEMENT_VERSIONS.includes(String(ref.apiVersion || '').toLowerCase())) {
    errors.push(
      err('The placement reference must use apiVersion cluster.open-cluster-management.io/v1beta1')
    );
  }
  return errors;
}

function validateConfigRefs(
  configs: unknown[] | undefined,
  where: string,
  requireName: boolean
): Errors {
  const errors: Errors = [];
  (configs || []).forEach((c, i) => {
    const ref = (c || {}) as { resource?: string; name?: string };
    if (!ref.resource)
      errors.push(err('{{where}} {{n}}: resource is required', { where, n: i + 1 }));
    if (requireName && !ref.name)
      errors.push(err('{{where}} {{n}}: name is required', { where, n: i + 1 }));
  });
  return errors;
}

function validateClusterManagementAddOn(json: KubeJson): Errors {
  const errors: Errors = [];
  const strategy = json.spec?.installStrategy;
  if (strategy?.type && strategy.type !== 'Manual' && strategy.type !== 'Placements') {
    errors.push(err('Install strategy must be Manual or Placements'));
  }
  (strategy?.placements || []).forEach((p: KubeJson['spec'], i: number) => {
    if (!p?.name || !p?.namespace) {
      errors.push(err('Install placement {{n}} needs a name and a namespace', { n: i + 1 }));
    }
    errors.push(...validateConfigRefs(p?.configs, `Install placement ${i + 1} config`, true));
  });
  if (isV1beta1(json.apiVersion)) {
    errors.push(...validateConfigRefs(json.spec?.defaultConfigs, 'Default config', true));
  } else {
    errors.push(...validateConfigRefs(json.spec?.supportedConfigs, 'Supported config', false));
  }
  return errors;
}

function validateManagedClusterAddOn(json: KubeJson): Errors {
  const errors = validateConfigRefs(json.spec?.configs, 'Config', true);
  const ns = json.spec?.installNamespace;
  if (ns && !isValidDNSLabel(ns))
    errors.push(err('Install namespace "{{ns}}" is not a valid name', { ns }));
  return errors;
}

function validateDeploymentConfig(json: KubeJson): Errors {
  const errors: Errors = [];
  const spec = json.spec || {};
  if (spec.agentInstallNamespace && !isValidDNSLabel(spec.agentInstallNamespace)) {
    errors.push(err('Agent install namespace is not a valid name'));
  }
  (spec.customizedVariables || []).forEach((v: { name?: string; value?: string }, i: number) => {
    if (!v.name || !VARIABLE_NAME_RE.test(v.name)) {
      errors.push(
        err(
          'Variable {{n}}: name must start with a letter or "_" and contain letters, digits or "_"',
          { n: i + 1 }
        )
      );
    }
    if ((v.value || '').length > 1024)
      errors.push(err('Variable {{n}}: value is too long', { n: i + 1 }));
  });
  (spec.registries || []).forEach((r: { mirror?: string }, i: number) => {
    if (!r.mirror) errors.push(err('Registry {{n}}: mirror is required', { n: i + 1 }));
  });
  (spec.resourceRequirements || []).forEach((r: { containerID?: string }, i: number) => {
    if (!r.containerID || !CONTAINER_ID_RE.test(r.containerID)) {
      errors.push(
        err(
          'Resource requirement {{n}}: container ID must look like deployments:<name>:<container>',
          { n: i + 1 }
        )
      );
    }
  });
  return errors;
}

function validateManagedServiceAccount(json: KubeJson): Errors {
  const errors: Errors = [];
  if (!json.spec?.rotation) errors.push(err('Rotation settings are required'));
  const validity = json.spec?.rotation?.validity;
  if (validity && !/^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/.test(validity)) {
    errors.push(err('Validity must be a duration such as 720h or 8640h0m0s'));
  }
  const ttl = json.spec?.ttlSecondsAfterCreation;
  if (ttl !== undefined && !(Number.isInteger(ttl) && ttl >= 0)) {
    errors.push(err('TTL must be a whole number of seconds'));
  }
  return errors;
}

function validateClusterManager(json: KubeJson): Errors {
  const errors: Errors = [];
  for (const key of [
    'registrationConfiguration',
    'workConfiguration',
    'addOnManagerConfiguration',
    'placementConfiguration',
  ]) {
    (json.spec?.[key]?.featureGates || []).forEach(
      (g: { feature?: string; mode?: string }, i: number) => {
        if (!g.feature) errors.push(err('Feature gate {{n}} needs a name', { n: i + 1 }));
        if (g.mode && g.mode !== 'Enable' && g.mode !== 'Disable') {
          errors.push(
            err('Feature gate "{{f}}": mode must be Enable or Disable', { f: g.feature || '' })
          );
        }
      }
    );
  }
  const driver = json.spec?.workConfiguration?.workDriver;
  if (driver && !['kube', 'mqtt', 'grpc'].includes(driver))
    errors.push(err('Work driver must be kube, mqtt or grpc'));
  return errors;
}

function validatePlacementRule(json: KubeJson): Errors {
  const errors = selectorProblems(json.spec?.clusterSelector, 'Cluster selector');
  const replicas = json.spec?.clusterReplicas;
  if (replicas !== undefined && !(Number.isInteger(replicas) && replicas >= 0)) {
    errors.push(err('Cluster replicas must be a whole number ≥ 0'));
  }
  return errors;
}

function validateApplicationSet(json: KubeJson): Errors {
  const errors: Errors = [];
  const generators = json.spec?.generators || [];
  if (generators.length === 0) errors.push(err('Add at least one generator'));
  generators.forEach((g: KubeJson['spec'], i: number) => {
    const cdr = g?.clusterDecisionResource;
    if (cdr && !cdr.configMapRef) {
      errors.push(
        err('Generator {{n}}: the clusterDecisionResource ConfigMap is required', { n: i + 1 })
      );
    }
  });
  const tpl = json.spec?.template;
  if (!tpl?.metadata?.name) errors.push(err('The application name template is required'));
  const spec = tpl?.spec;
  if (!spec?.project) errors.push(err('Choose an Argo CD project'));
  const sources = spec?.sources?.length ? spec.sources : spec?.source ? [spec.source] : [];
  if (sources.length === 0 || sources.some((s: { repoURL?: string }) => !s?.repoURL)) {
    errors.push(err('The source repository URL is required'));
  }
  if (!spec?.destination?.server && !spec?.destination?.name) {
    errors.push(err('The destination needs a server or a cluster name'));
  }
  return errors;
}

function validateAppProject(json: KubeJson): Errors {
  const errors: Errors = [];
  if ((json.spec?.description || '').length > 255)
    errors.push(err('The description is longer than 255 characters'));
  (json.spec?.destinations || []).forEach((d: { server?: string; name?: string }, i: number) => {
    if (!d.server && !d.name)
      errors.push(err('Destination {{n}} needs a server or a cluster name', { n: i + 1 }));
  });
  return errors;
}

const REMEDIATIONS = ['inform', 'enforce'];

function validatePolicy(json: KubeJson): Errors {
  const errors: Errors = [];
  const r = json.spec?.remediationAction;
  if (r && !REMEDIATIONS.includes(String(r).toLowerCase())) {
    errors.push(err('Remediation must be inform or enforce'));
  }
  const name = json.metadata?.name || '';
  const ns = json.metadata?.namespace || '';
  // The propagator webhook: cluster copies are named "<namespace>.<name>".
  if (
    name &&
    ns &&
    name.length + ns.length > 62 &&
    !json.metadata?.labels?.['policy.open-cluster-management.io/root-policy']
  ) {
    errors.push(err('The policy namespace and name together cannot exceed 62 characters'));
  }
  const templates = json.spec?.['policy-templates'] || [];
  if (templates.length === 0) errors.push(err('Add at least one policy template'));
  const policyRemediation = !!r;
  templates.forEach((tpl: KubeJson['spec'], i: number) => {
    const o = tpl?.objectDefinition;
    const n = i + 1;
    if (!o?.apiVersion || !o?.kind || !o?.metadata?.name) {
      errors.push(err('Template {{n}} needs apiVersion, kind and metadata.name', { n }));
      return;
    }
    // The propagator webhook rejects a template without remediation when the policy has none.
    if (
      !policyRemediation &&
      ['ConfigurationPolicy', 'OperatorPolicy'].includes(o.kind) &&
      !o.spec?.remediationAction
    ) {
      errors.push(err('Template {{n}}: set a remediation on the template or on the policy', { n }));
    }
    if (o.kind === 'ConfigurationPolicy') {
      const raw = o.spec?.['object-templates-raw'];
      if (!raw && (o.spec?.['object-templates'] || []).length === 0) {
        errors.push(err('Template {{n}}: a configuration policy needs at least one object', { n }));
      }
      (o.spec?.['object-templates'] || []).forEach((ot: KubeJson['spec'], j: number) => {
        if (!ot?.complianceType)
          errors.push(
            err('Template {{n}}, object {{m}}: compliance type is required', { n, m: j + 1 })
          );
        if (!ot?.objectDefinition?.kind)
          errors.push(
            err('Template {{n}}, object {{m}}: the object needs a kind', { n, m: j + 1 })
          );
      });
    }
    if (o.kind === 'OperatorPolicy') {
      if (!o.spec?.subscription?.name)
        errors.push(err('Template {{n}}: the operator package name is required', { n }));
      if (!['None', 'Automatic'].includes(o.spec?.upgradeApproval)) {
        errors.push(err('Template {{n}}: upgrade approval must be None or Automatic', { n }));
      }
    }
  });
  (json.spec?.dependencies || []).forEach(
    (d: { name?: string; compliance?: string }, i: number) => {
      if (!d.name) errors.push(err('Dependency {{n}} needs a name', { n: i + 1 }));
      if (!['Compliant', 'NonCompliant', 'Pending'].includes(d.compliance || '')) {
        errors.push(
          err('Dependency {{n}}: compliance must be Compliant, NonCompliant or Pending', {
            n: i + 1,
          })
        );
      }
    }
  );
  return errors;
}

function validatePlacementBinding(json: KubeJson): Errors {
  const errors: Errors = [];
  const ref = json.placementRef;
  if (!ref?.name) errors.push(err('Choose a placement'));
  if (ref?.kind && ref.kind !== 'Placement' && ref.kind !== 'PlacementRule') {
    errors.push(err('The placement reference must be a Placement or a PlacementRule'));
  }
  const subjects = json.subjects || [];
  if (subjects.length === 0) errors.push(err('Bind at least one policy or policy set'));
  subjects.forEach((s: { kind?: string; name?: string }, i: number) => {
    if (!s.name) errors.push(err('Subject {{n}} needs a name', { n: i + 1 }));
    if (s.kind !== 'Policy' && s.kind !== 'PolicySet')
      errors.push(err('Subject {{n}} must be a Policy or a PolicySet', { n: i + 1 }));
  });
  const override = json.bindingOverrides?.remediationAction;
  if (override && String(override).toLowerCase() !== 'enforce') {
    errors.push(err('The remediation override can only be enforce'));
  }
  return errors;
}

function validatePolicySet(json: KubeJson): Errors {
  return (json.spec?.policies || []).length === 0
    ? [err('Add at least one policy to the set')]
    : [];
}

function validatePolicyAutomation(json: KubeJson): Errors {
  const errors: Errors = [];
  const s = json.spec || {};
  if (!s.policyRef) errors.push(err('Choose the policy'));
  if (!['once', 'everyEvent', 'disabled'].includes(s.mode))
    errors.push(err('Mode must be once, everyEvent or disabled'));
  if (!s.automationDef?.name) errors.push(err('The Ansible job template name is required'));
  if (!s.automationDef?.secret)
    errors.push(err('The Ansible Automation Platform credential secret is required'));
  return errors;
}

const VALIDATORS: Record<string, (json: KubeJson) => Errors> = {
  Policy: validatePolicy,
  PlacementBinding: validatePlacementBinding,
  PolicySet: validatePolicySet,
  PolicyAutomation: validatePolicyAutomation,
  ApplicationSet: validateApplicationSet,
  AppProject: validateAppProject,
  ManagedCluster: validateManagedCluster,
  ManagedClusterSet: validateClusterSet,
  ManagedClusterSetBinding: validateBinding,
  ClusterClaim: validateValue,
  ClusterProperty: validateValue,
  Placement: json => validatePlacementSpec(json.spec),
  PlacementRule: validatePlacementRule,
  ManifestWork: json => validateWorkSpec(json.spec),
  ManifestWorkReplicaSet: validateMWRS,
  Subscription: validateSubscription,
  Channel: validateChannel,
  GitOpsCluster: validateGitOpsCluster,
  ClusterManagementAddOn: validateClusterManagementAddOn,
  ManagedClusterAddOn: validateManagedClusterAddOn,
  AddOnDeploymentConfig: validateDeploymentConfig,
  ManagedServiceAccount: validateManagedServiceAccount,
  ClusterManager: validateClusterManager,
};

/** All validation errors of an object (metadata and kind-specific rules). */
export function validateResource(json: KubeJson): ValidationError[] {
  if (!json || typeof json !== 'object') return [err('The document must be a Kubernetes object')];
  if (!json.apiVersion || !json.kind) return [err('apiVersion and kind are required')];
  const errors = validateMetadata(json);
  const validator = VALIDATORS[json.kind];
  if (validator) errors.push(...validator(json));
  return errors;
}
