# OCM API matrix (OCM v0.14.0 – v1.3.1)

This matrix was derived from the CRD manifests in the upstream repositories, not from
documentation. Every group, version, kind, scope and field listed here was read from the
`CustomResourceDefinition` objects at the refs below.

## Sources

| Repository | Refs inspected | Where the CRDs live |
| --- | --- | --- |
| [open-cluster-management-io/ocm](https://github.com/open-cluster-management-io/ocm) | `v0.14.0`, `v0.15.0`, `v0.16.0`, `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.3.1` | `manifests/cluster-manager/hub/crds/`, `manifests/klusterlet/managed/`, `deploy/*/config/crds/` |
| [open-cluster-management-io/api](https://github.com/open-cluster-management-io/api) | `v0.14.0`, `v0.15.0`, `v0.16.1`, `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.3.0` | `<group>/<version>/*.crd.yaml` |
| [open-cluster-management-io/multicloud-operators-subscription](https://github.com/open-cluster-management-io/multicloud-operators-subscription) | `v0.14.0`, `v0.15.0`, `v0.16.0`, `main` (`f5fb624`, 2025-05-07) | `deploy/hub-common/` |
| [open-cluster-management-io/multicloud-integrations](https://github.com/open-cluster-management-io/multicloud-integrations) | `v0.12.0`, `v0.13.0`, `release-0.13`, `main` (`2ee9daa`, 2025-05-07) | `deploy/crds/` |

OCM core tag → API module version (from `ocm/go.mod`):

| OCM | `open-cluster-management.io/api` |
| --- | --- |
| v0.14.0 | v0.14.0 |
| v0.15.0 | v0.15.0 |
| v0.16.0 | v0.16.1 |
| v1.0.0 | v1.0.0 |
| v1.1.0 | v1.1.0 |
| v1.2.0 | v1.2.0 |
| v1.3.0 / v1.3.1 | v1.3.0 |

The application lifecycle add-on (subscription) is tagged up to `v0.16.0` and the GitOps
integration up to `v0.13.0`; neither repository has tags that follow OCM v1.x. For OCM v1.x
their `main` branch was used. Between the oldest and newest refs of both repositories the CRD
schemas of the application kinds did not change (see the notes below for the one exception).

## Resource matrix

Legend: **(s)** = storage version. "All" = present at every inspected ref from OCM v0.14.0 to
v1.3.1. The plugin picks the most stable served version that it supports (GA > beta > alpha).

### Cluster inventory — `cluster.open-cluster-management.io`

| Kind | Plural | Scope | Served versions | OCM range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| ManagedCluster | managedclusters | Cluster | v1 (s) | All | v1 — list, detail, form, wizard, actions |
| ManagedClusterSet | managedclustersets | Cluster | v1beta2 (s) | All | v1beta2 — list, detail, form |
| ManagedClusterSetBinding | managedclustersetbindings | Namespaced | v1beta2 (s) | All | v1beta2 — list, detail, form |
| ClusterClaim | clusterclaims | Cluster | v1alpha1 (s) | All (installed by the klusterlet on managed clusters) | v1alpha1 — list, detail, form |
| Placement | placements | Namespaced | v1beta1 (s) | All | v1beta1 — list, detail, form, wizard, preview |
| PlacementDecision | placementdecisions | Namespaced | v1beta1 (s) | All | v1beta1 — read only |
| AddOnPlacementScore | addonplacementscores | Namespaced | v1alpha1 (s) | All | v1alpha1 — read only |

### Cluster profile and properties (other groups, shipped by OCM)

| Group | Kind | Scope | Served versions | OCM range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| multicluster.x-k8s.io | ClusterProfile | Namespaced | v1alpha1 (s) | v1.1.0 – v1.3.1 (hub) | v1alpha1 — read only |
| about.k8s.io | ClusterProperty | Cluster | v1alpha1 (s) | v1.0.0 – v1.3.1 (installed by the klusterlet) | v1alpha1 — list, detail, form |

### Work distribution — `work.open-cluster-management.io`

| Kind | Plural | Scope | Served versions | OCM range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| ManifestWork | manifestworks | Namespaced | v1 (s) | All | v1 — list, detail, form, wizard |
| ManifestWorkReplicaSet | manifestworkreplicasets | Namespaced | v1alpha1 (s) | All | v1alpha1 — list, detail, form, wizard |
| AppliedManifestWork | appliedmanifestworks | Cluster | v1 (s) | All (installed by the klusterlet) | v1 — read only |

### Add-ons — `addon.open-cluster-management.io`

| Kind | Plural | Scope | Served versions | OCM range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| ClusterManagementAddOn | clustermanagementaddons | Cluster | v1alpha1 (s); v1beta1 from v1.2.0 | All | v1beta1 preferred, v1alpha1 fallback — list, detail, form |
| ManagedClusterAddOn | managedclusteraddons | Namespaced | v1alpha1 (s); v1beta1 from v1.2.0 | All | v1beta1 preferred, v1alpha1 fallback — list, detail, form, enable/disable action |
| AddOnDeploymentConfig | addondeploymentconfigs | Namespaced | v1alpha1 (s); v1beta1 from v1.2.0 | All | v1beta1 preferred, v1alpha1 fallback — list, detail, form |
| AddOnTemplate | addontemplates | Cluster | v1alpha1 (s) | All | v1alpha1 — list, detail, YAML |

### Operator — `operator.open-cluster-management.io`

| Kind | Plural | Scope | Served versions | OCM range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| ClusterManager | clustermanagers | Cluster | v1 (s) | All (hub) | v1 — list, detail, form |
| Klusterlet | klusterlets | Cluster | v1 (s) | All (managed cluster; on the hub only when it is self-managed) | v1 — list, detail, YAML |

### Application lifecycle — `apps.open-cluster-management.io` (multicloud-operators-subscription)

| Kind | Plural | Scope | Served versions | Range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| Subscription | subscriptions | Namespaced | v1 (s) | v0.14.0 – main | v1 — list, detail, form, wizard, pause/resume |
| Channel | channels | Namespaced | v1 (s) | v0.14.0 – main | v1 — list, detail, form |
| HelmRelease | helmreleases | Namespaced | v1 (s) | v0.14.0 – main | v1 — read only (created by the subscription agent) |
| PlacementRule | placementrules | Namespaced | v1 (s) | v0.14.0 – main | v1 — list, detail, form (legacy) |
| SubscriptionReport | subscriptionreports | Namespaced | v1alpha1 (s) | v0.14.0 – main | v1alpha1 — read only |
| SubscriptionStatus | subscriptionstatuses | Namespaced | v1alpha1 (s) | v0.14.0 – main | v1alpha1 — read only |

### GitOps integration — multicloud-integrations

| Group | Kind | Scope | Served versions | Range | Plugin support |
| --- | --- | --- | --- | --- | --- |
| apps.open-cluster-management.io | GitOpsCluster | Namespaced | v1beta1 (s) | v0.12.0 – main | v1beta1 — list, detail, form, wizard |
| apps.open-cluster-management.io | GitOpsCluster (argocd-agent) | Namespaced | v1alpha1 (s), same CRD name, installed by argocd-pull-integration's `argocd-agent-addon` chart | clusteradm v1.2+ | v1alpha1 — list, detail, form, wizard (`placementRef`, `argoCDAgentAddon`, `status.conditions`) |
| apps.open-cluster-management.io | MulticlusterApplicationSetReport | Namespaced | v1alpha1 (s) | v0.12.0 – main | v1alpha1 — read only |
| authentication.open-cluster-management.io | ManagedServiceAccount | Namespaced | v1alpha1 (deprecated from v0.13.0), v1beta1 (s) from v0.13.0 | v0.12.0 – main | v1beta1 preferred, v1alpha1 fallback — list, detail, form |
| rbac.open-cluster-management.io | ClusterPermission | Namespaced | v1alpha1 (s) | v0.12.0 – main | v1alpha1 — list, detail, YAML |

ManagedServiceAccount and ClusterPermission are owned by separate add-ons
(managed-serviceaccount, cluster-permission); multicloud-integrations ships their CRDs because
GitOpsCluster depends on them. The plugin treats them as optional.

Not part of the range: `ManagedClusterSet`/`ManagedClusterSetBinding` `v1beta1` and
`Placement` `v1alpha1` are not served by any OCM release from v0.14.0 onwards (the
subscription repository still carries an old development copy of the Placement CRD with a
deprecated `v1alpha1`; OCM itself does not install it).

### Governance — `policy.open-cluster-management.io`

Sources: [governance-policy-propagator](https://github.com/open-cluster-management-io/governance-policy-propagator)
and [config-policy-controller](https://github.com/open-cluster-management-io/config-policy-controller)
`deploy/crds/` at `v0.14.0` … `v0.20.0` (v0.14 ↔ OCM v0.14, v0.15 ↔ v0.15, v0.16 ↔ v0.16 / v1.0,
v0.17 ↔ v1.1, v0.18 ↔ v1.2, v0.19 ↔ v1.3; by release date). Add-ons:
`governance-policy-framework` and `config-policy-controller` (governance-policy-addon-controller).

| Kind | Plural | Scope | Served versions | Where | Plugin support |
| --- | --- | --- | --- | --- | --- |
| Policy | policies | Namespaced | v1 (s) | hub (root policies; copies in cluster namespaces) | v1 — list (root policies), detail, form, wizard, inform / enforce, enable / disable |
| PlacementBinding | placementbindings | Namespaced | v1 (s) | hub | v1 — list, detail, form (fields at the top level, no `spec`) |
| PolicySet | policysets | Namespaced | v1beta1 (s) | hub | v1beta1 — list, detail, form |
| PolicyAutomation | policyautomations | Namespaced | v1beta1 (s) | hub | v1beta1 — list, detail, form |
| ConfigurationPolicy | configurationpolicies | Namespaced | v1 (s) | managed clusters (on the hub only when it is self-managed); delivered inside `Policy.spec.policy-templates` | v1 — read only; template builder in the policy form |
| OperatorPolicy | operatorpolicies | Namespaced | v1beta1 (s) | managed clusters (needs OLM) | v1beta1 — read only; template builder in the policy form |

Field additions in the range: `Policy.spec.hubTemplateOptions` (v0.15),
`Policy.status.placement[].exclusions`, `status.status[].remainingBindings` and
`PolicySet.spec.exclusions` (v0.20); `ConfigurationPolicy.spec.customMessage` (v0.15),
`object-templates[].objectSelector` (v0.16), `status.history` (v0.17),
`namespaceSelector.terminatingInclusion` (v0.18); `OperatorPolicy.spec.complianceConfig.deprecationsPresent`
(v0.16), `status.history` (v0.17), `complianceConfig.minorChannelUpgradeAvailable` (v0.19). None
are renamed or removed.

`PolicyGenerator` (`policy.open-cluster-management.io/v1`, policy-generator-plugin) is a
kustomize generator configuration, not a served resource; the plugin exports an equivalent
configuration from a policy instead of listing it.

### Argo CD — `argoproj.io` (optional, used with the GitOps integration)

Source: [argoproj/argo-cd](https://github.com/argoproj/argo-cd) `manifests/crds/` at `v2.10.0`,
`v2.14.0`, `v3.0.0` and `v3.5.0`.

| Kind | Plural | Scope | Served versions | Plugin support |
| --- | --- | --- | --- | --- |
| Application | applications | Namespaced | v1alpha1 (s) | v1alpha1 — list, detail, refresh / hard refresh / sync, YAML |
| ApplicationSet | applicationsets | Namespaced | v1alpha1 (s) | v1alpha1 — list, detail, form, wizard |
| AppProject | appprojects | Namespaced | v1alpha1 (s) | v1alpha1 — list, detail, form |

Field changes used by the plugin: `ApplicationSet.status.resources` (v2.14.0+) and
`status.health` / `status.resourcesCount` (v3.5.0) are shown when present; the generated
applications are found through owner references, so older versions work as well.
`Application.status.health.lastTransitionTime` and `status.history[].initiatedBy` appear in
v2.14.0. Argo CD Applications are listed but not given a form (they are usually generated by
ApplicationSets); they can be created as YAML.

## Field changes inside the range

Only changes that affect the plugin are listed. Paths are relative to the object root.

### Additions

| Kind | Field | Added in OCM | Plugin behaviour |
| --- | --- | --- | --- |
| ManagedCluster | `status.managedNamespaces[]` | v1.1.0 | Shown when present |
| ManagedClusterSet | `spec.managedNamespaces[]` | v1.1.0 | Form field gated on the CRD schema |
| Placement | `spec.predicates[].requiredClusterSelector.celSelector.celExpressions` | v1.0.0 | Form field gated on the CRD schema; not evaluated by the preview |
| Placement | `spec.sortBy`, `spec.scoreRateLimit`, `status.lastScoreUpdateTime` | v1.3.0 | Form fields gated on the CRD schema |
| PlacementDecision | `status.decisions[].score` | v1.3.0 | Score column shown when present |
| ManifestWork / MWRS template / AddOnTemplate | `spec.manifestConfigs[].conditionRules`, `spec.deleteOption.ttlSecondsAfterFinished` | v1.0.0 | YAML only; TTL in the form gated on the schema |
| ManifestWork / MWRS template / AddOnTemplate | `spec.manifestConfigs[].feedbackScrapeType` | v1.2.0 | YAML only |
| ManifestWork | `spec.manifestConfigs[].updateStrategy.serverSideApply.ignoreFields` | v0.16.0 | YAML only |
| ManifestWorkReplicaSet | `spec.cascadeDeletionPolicy` (required, default `Background`) | v1.0.0 | Form field gated on the CRD schema |
| ManifestWorkReplicaSet | `status.summary.desiredTotal`, `status.summary.updated` (and per placement) | v1.2.0 | Shown when present |
| AddOnDeploymentConfig | `spec.resourceRequirements[]` | v0.16.0 | YAML only |
| ManagedClusterAddOn v1alpha1 | `status.kubeClientDriver` | v1.2.0 | Shown when present |
| ClusterManager | `spec.registrationConfiguration.registrationDrivers[]` | v0.16.0 | Shown read only |
| ClusterManager | `spec.serverConfiguration`, `spec.deployOption.default` | v1.1.0 | YAML only |
| ClusterManager | `spec.registrationConfiguration.importerConfiguration` | v1.2.0 | YAML only |
| ClusterManager | `spec.placementConfiguration` | v1.3.0 | Feature gates shown when present |
| Klusterlet | `spec.registrationConfiguration.registrationDriver` | v0.15.0 | YAML only |
| Klusterlet | `spec.registrationConfiguration.clusterClaimConfiguration`, `spec.workConfiguration.{hubKubeAPIQPS,hubKubeAPIBurst,statusSyncInterval}` | v1.0.0 | YAML only |
| Klusterlet | `spec.registrationConfiguration.clusterLabels` | v1.1.0 | YAML only |
| Klusterlet | `spec.registrationConfiguration.addOnKubeClientRegistrationDriver` | v1.2.0 | YAML only |
| MulticlusterApplicationSetReport | `statuses.clusterConditions[].{operationStatePhase,operationStateStartedAt,syncRevision}` | integrations `main` (after v0.13.0) | Shown when present |

### Renames and removals

| Kind | Change | In OCM | Plugin behaviour |
| --- | --- | --- | --- |
| ManifestWorkReplicaSet | `status.summary.Applied` → `status.summary.applied` (also in `status.placementSummary[].summary`) | v1.1.0 | The model reads both spellings |
| ClusterManager | `registrationDrivers[].awsisra` → `registrationDrivers[].awsirsa` | v1.0.0 | Not edited by the plugin |
| ClusterManagementAddOn | `v1beta1` drops `spec.supportedConfigs[]` (`{group, resource, defaultConfig{name, namespace}}`) and `spec.addOnConfiguration`, and adds `spec.defaultConfigs[]` (`{group, resource, name, namespace}`); `status.defaultconfigReferences` becomes `status.defaultConfigReferences` | v1.2.0 (new version) | Form and model convert between both shapes based on the served version |
| ManagedClusterAddOn | `v1beta1` drops `spec.installNamespace` (deprecated in favour of `AddOnDeploymentConfig.spec.agentInstallNamespace`), `status.addOnConfiguration`, `status.configReferences[].{name,namespace}` (moved to `desiredConfig`) and `status.registrations[].{signerName,subject}` (replaced by `type` + `kubeClient` / `customSigner`) | v1.2.0 (new version) | Install namespace field only offered for v1alpha1; status rendering reads both shapes |
| ManagedServiceAccount | `v1alpha1` marked deprecated by the CRD | integrations v0.13.0 | v1beta1 preferred |

### Deprecations recorded in the CRDs

| Kind | Field / version | Marker |
| --- | --- | --- |
| ClusterManagementAddOn v1alpha1 | `spec.addOnConfiguration` | "Deprecated: Use supportedConfigs filed instead" |
| ClusterManagementAddOn v1alpha1 | `spec.supportedConfigs` | "Deprecated: Will be removed and replaced with DefaultConfigs in v1beta1" |
| ManagedClusterAddOn v1alpha1 | `spec.installNamespace` | "Deprecated: Use AddonDeploymentConfig instead" |
| ManagedClusterAddOn v1alpha1 | `status.addOnConfiguration`, `status.registrations[].signerName/subject` | Deprecated in the field descriptions |
| ManagedServiceAccount | `v1alpha1` | `deprecated: true` on the CRD version |

PlacementRule (`apps.open-cluster-management.io/v1`) carries no deprecation marker in its CRD.
OCM's own APIs moved cluster selection to `Placement`; the plugin therefore lists PlacementRules
as a legacy kind and always generates `Placement` objects in its wizards.

## Well-known names used by the plugin

All values below are constants in the upstream Go API packages at both ends of the range.

| Purpose | Value | Source |
| --- | --- | --- |
| Cluster set membership label | `cluster.open-cluster-management.io/clusterset` | `cluster/v1beta2.ClusterSetLabel` |
| Cluster name label on CSRs, works, decisions | `open-cluster-management.io/cluster-name` | `cluster/v1.ClusterNameLabelKey` |
| ManagedCluster conditions | `HubAcceptedManagedCluster`, `HubDeniedManagedCluster`, `ManagedClusterJoined`, `ManagedClusterConditionAvailable`, `ManagedClusterConditionClockSynced` | `cluster/v1` |
| Automatic taints | `cluster.open-cluster-management.io/unavailable`, `cluster.open-cluster-management.io/unreachable` | `cluster/v1` |
| Taint effects | `NoSelect`, `PreferNoSelect`, `NoSelectIfNew` | `cluster/v1` |
| ManagedClusterSet condition | `ClusterSetEmpty` | `cluster/v1beta2` |
| ManagedClusterSet selector types | `ExclusiveClusterSetLabel`, `LabelSelector` | `cluster/v1beta2` |
| Placement conditions | `PlacementSatisfied`, `PlacementMisconfigured` | `cluster/v1beta1` |
| Placement built-in prioritizers | `Balance`, `Steady`, `ResourceAllocatableCPU`, `ResourceAllocatableMemory`, `Spread` | `cluster/v1beta1` (field docs) |
| PlacementDecision → Placement label | `cluster.open-cluster-management.io/placement` | `cluster/v1beta1.PlacementLabel` |
| ManifestWork conditions | `Applied`, `Available`, `Degraded`, `Progressing`, `Complete`, `Deleting` | `work/v1` |
| MWRS conditions | `PlacementVerified`, `PlacementRolledOut`, `ManifestworkApplied` | `work/v1alpha1` |
| ManagedClusterAddOn conditions | `Available`, `Degraded`, `Configured`, `Progressing` | `addon/v1alpha1` |
| ClusterManager conditions | `Applied`, `HubRegistrationDegraded`, `HubPlacementDegraded` | `operator/v1` |
| Subscription pause label | `subscription-pause` (`"true"` / `"false"`) | `apps/v1.LabelSubscriptionPause` |
| Subscription Git annotations | `apps.open-cluster-management.io/git-branch`, `git-path`, `git-tag`, `git-desired-commit`, `git-clone-depth`, `reconcile-option`, `reconcile-rate` | `apps/v1` |
| Channel types | `Namespace`, `HelmRepo`, `ObjectBucket`, `GitHub`, `Git` (and lower-case variants) | Channel CRD enum |

## Controller behaviour the plugin relies on

Read from the controller sources at the refs above:

| Behaviour | Source |
| --- | --- |
| GitOpsCluster only accepts `placementRef.kind: Placement` with apiVersion `cluster.open-cluster-management.io/v1beta1` (or `v1alpha1`) and looks the placement up in the GitOpsCluster's own namespace; PlacementRules are rejected | multicloud-integrations `pkg/controller/gitopscluster/gitopscluster_controller.go` (`GetManagedClusters`), v0.13.0 and `main` |
| ManifestWorks created by a ManifestWorkReplicaSet carry the label `work.open-cluster-management.io/manifestworkreplicaset=<namespace>.<name>` and `work.open-cluster-management.io/placementname` | ocm `pkg/work/hub/controllers/manifestworkreplicasetcontroller`, v0.14.0 and v1.3.1 |
| ClusterProfiles are named after the managed cluster and labelled `open-cluster-management.io/cluster-name` | ocm `pkg/registration/hub/clusterprofile`, v1.3.1 |
| Placement CEL expressions evaluate against the variable `managedCluster` | ocm `pkg/placement/helpers/cel.go`, v1.3.1 |
| The reconcile rate (`apps.open-cluster-management.io/reconcile-rate`: low, medium, high, off) is read from the Channel; a Subscription can only override it to `off`. Reconcile options: `merge`, `replace`, `mergeAndOwn` | multicloud-operators-subscription `pkg/utils/subscription.go`, `pkg/apis/apps/v1` |
| Channel credential secret keys: `user` + `accessToken` / `sshKey` (Git), `user` + `password` or `authHeader` (Helm), `AccessKeyID` + `SecretAccessKey` (object bucket) | multicloud-operators-subscription `pkg/utils/gitrepo.go`, `pkg/subscriber/helmrepo`, `pkg/utils/aws` |
| Reserved cluster claims: `id.k8s.io`, `kubeversion.open-cluster-management.io`, `platform.open-cluster-management.io`, `product.open-cluster-management.io` | api `cluster/v1alpha1.ReservedClusterClaimNames` |
| A ManagedClusterSetBinding must be named after its set; creating one needs `create` on `managedclustersets/bind` | binding CRD field description |
| `clusteradm join --hub-token … --hub-apiserver … --cluster-name …`, `clusteradm get token`, `clusteradm accept --clusters …` | clusteradm `pkg/cmd/join`, `pkg/cmd/get/token`, `pkg/cmd/accept` |

### Governance (governance-policy-propagator / config-policy-controller v0.14.0 – v0.19.0)

| Behaviour | Source |
| --- | --- |
| Root policies are replicated into each selected cluster namespace as `<namespace>.<name>`, labelled `policy.open-cluster-management.io/root-policy=<namespace>.<name>`, `…/cluster-name` and `…/cluster-namespace` | propagator `controllers/common/common.go` (`FullNameForPolicy`, labels) |
| The webhook rejects policies whose namespace + name exceed 62 characters, and policies where neither the policy nor a template sets `remediationAction` | propagator `api/v1/policy_webhook.go` |
| Policy `remediationAction` overrides the templates; `disabled: true` removes the policy from the clusters | Policy CRD descriptions |
| PolicyAutomation `mode: once` runs the Ansible job once and then sets the mode to `disabled` | propagator `controllers/automation/policyautomation_controller.go` |
| Compliance annotations `policy.open-cluster-management.io/standards`, `…/categories`, `…/controls` (comma separated) | propagator compliance events API |
| PolicyGenerator fields used by the export (`policyDefaults.namespace/placement.placementName/remediationAction/standards/categories/controls`, `policies[].manifests[].path/name/complianceType/severity/remediationAction/namespaceSelector/pruneObjectBehavior`) | policy-generator-plugin `docs/policygenerator-reference.yaml` v1.19.0 |

### Argo CD integration (multicloud-integrations `main`, argo-cd v2.10.0 – v3.5.0)

| Behaviour | Source |
| --- | --- |
| GitOpsCluster registers each decided cluster as an Argo CD cluster secret in the Argo CD namespace, labelled `argocd.argoproj.io/secret-type=cluster`, `apps.open-cluster-management.io/acm-cluster=true`, `apps.open-cluster-management.io/cluster-name=<cluster>` and `apps.open-cluster-management.io/cluster-server=<host>`; blank secrets (`createBlankClusterSecrets: true`, used by the pull model) carry the server `https://<cluster>-control-plane` | `pkg/controller/gitopscluster/gitopscluster_controller.go`, `pkg/utils/cluster.go` |
| The controller refuses clusters that already have a cluster secret not created by OCM | same file |
| GitOpsCluster creates the ConfigMaps `acm-placement` (PlacementDecisions, `statusListKey: decisions`, `matchKey: clusterName`) and `acm-placementrule` in the Argo CD namespace for the `clusterDecisionResource` generator | same file (`CreateApplicationSetConfigMaps`) |
| The `clusterDecisionResource` generator only yields clusters registered in Argo CD and passes `name`, `server` and the decision fields (e.g. `clusterName`) to the template | argo-cd `applicationset/generators/duck_type.go`, v2.10.0 and v3.5.0 |
| Pull model: hub Applications labelled `apps.open-cluster-management.io/pull-to-ocm-managed-cluster=true` with the annotation `apps.open-cluster-management.io/ocm-managed-cluster=<cluster>` (optional `…/ocm-managed-cluster-app-namespace`) are wrapped in a ManifestWork `<app>-<uid[0:5]>` in the cluster namespace, annotated `…/hub-application-name` / `…/hub-application-namespace`; `argocd.argoproj.io/skip-reconcile` and the OCM annotations are stripped from the propagated copy, whose destination becomes `https://kubernetes.default.svc` | `propagation-controller/application/` |
| MulticlusterApplicationSetReport has the name and namespace of its ApplicationSet | `pkg/controller/multiclusterstatusaggregation/` |
| Refresh: annotation `argocd.argoproj.io/refresh: normal | hard` (removed by the controller after the refresh) | argo-cd `pkg/apis/application/v1alpha1/application_annotations.go` |
| Sync: writing the `operation` field (`initiatedBy`, `sync.revision/prune/dryRun`) starts a sync, as `argocd app sync` does | Application CRD `operation` schema |
| Health codes `Healthy, Progressing, Suspended, Degraded, Missing, Unknown`; sync codes `Synced, OutOfSync, Unknown` | argo-cd `gitops-engine/pkg/health`, `pkg/apis/application/v1alpha1/types.go` |

### Platform readiness (Overview)

The readiness panel only reads what is already listed; the names below come from the sources
in parentheses. Install commands are shown as hints and never executed by the plugin.

| Stack | Detected by | Install hint (source) |
| --- | --- | --- |
| Hub control plane | ManagedCluster API, ClusterManager conditions, image tag | `clusteradm init --wait` |
| Cluster registration | ManagedCluster states, pending CSRs, `ManagedClusterAutoApproval` gate | `clusteradm get token` / `join` / `accept` |
| Placement and cluster sets | Placement and ManagedClusterSet APIs, sets, `DefaultClusterSet` gate | `clusteradm clusterset bind` |
| Work distribution | ManifestWork / ManifestWorkReplicaSet APIs, `ManifestWorkReplicaSet` work gate (default off, `ocm/api` `feature/feature.go`) | Hub Settings feature gates |
| Add-on framework | add-on APIs, ManagedClusterAddOn health, `AddonManagement` gate | `clusteradm addon enable` |
| Subscriptions | Subscription / Channel APIs, CMA `application-manager` | `clusteradm install hub-addon --names application-manager` (clusteradm v0.9 – v0.11 only) |
| Argo CD | `argoproj.io` Application / ApplicationSet / AppProject | Argo CD install manifest |
| GitOps push | GitOpsCluster v1beta1, OCM cluster secrets, ConfigMap `acm-placement` | multicloud-integrations `deploy/` |
| GitOps basic pull | CMA `argocd`, ConfigMap `ocm-placement-generator`, MulticlusterApplicationSetReport API | `clusteradm install hub-addon --names argocd` (clusteradm v1.0+) |
| GitOps argocd-agent | GitOpsCluster v1alpha1, CMA `argocd-agent-addon` | `clusteradm install hub-addon --names argocd-agent` (clusteradm v1.2+) |
| Policy framework | Policy API, CMAs `governance-policy-framework` and `config-policy-controller` | `clusteradm install hub-addon --names governance-policy-framework` |
| Managed service accounts | ManagedServiceAccount API, CMA `managed-serviceaccount` | Helm chart `ocm/managed-serviceaccount` |
| Cluster proxy | group `proxy.open-cluster-management.io`, CMA `cluster-proxy` | Helm chart `ocm/cluster-proxy` |
| Cluster inventory | ClusterProfile API, `ClusterProfile` registration gate | Hub Settings feature gates |
| Search | group `search.open-cluster-management.io`, or the Services `search-search-api`, `search-indexer` and `search-postgres` / `search-postgresql` in the `open-cluster-management` namespace (installs without the operator); CMA `search-collector` | search-v2-operator; not part of OCM |

The generator ConfigMaps are looked up with a GET in the namespaces taken from GitOpsClusters,
Argo CD cluster secrets and ApplicationSets; no namespace is assumed.

## Runtime adaptation

The plugin never assumes a version. At runtime it:

1. Reads `/apis` once and then the resource lists of the groups above.
2. For every kind, chooses the most stable served version from its supported list
   (`v1` > `v1beta2` > `v1beta1` > `v1alpha1`). A kind that is served only in an unknown version
   gets an **Unsupported version** state; a kind that is not served gets **Not installed**.
3. Hides sidebar sections whose kinds are all missing, and disables tabs of missing kinds.
4. When the user may read `customresourcedefinitions`, inspects the CRD schema to switch on
   version-dependent form fields (the "Additions" table). Without that permission the fields
   are shown with a hint naming the minimum OCM version.
5. Normalizes the two shapes of the add-on APIs and the renamed MWRS summary field in the
   model layer, so views work identically on every version.
