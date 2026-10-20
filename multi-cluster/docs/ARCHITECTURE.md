# Multicluster Hub — architecture and navigation

The plugin follows the structure of the sibling plugins in this repository (`cilium`,
`envoy-gateway`, `agentrouter`): one sidebar group per user intent, URL-backed tabs per kind,
a shared create/edit dialog with a form, a live YAML editor and CRD documentation, and wizards
built on a common step shell.

## Navigation

```
Multicluster Hub                  /multi-cluster/overview
├── Overview                      health, cluster states, add-ons, placements, failures
├── Clusters                      /multi-cluster/clusters/:plural?
│     Managed Clusters · Certificate Requests · Cluster Profiles
├── Cluster Sets                  /multi-cluster/cluster-sets/:plural?
│     Cluster Sets · Bindings
├── Placements                    /multi-cluster/placements/:plural?
│     Placements · Decisions · Add-on Scores · Placement Rules (legacy)
├── Workloads                     /multi-cluster/workloads/:plural?
│     ManifestWorks · ManifestWork Replica Sets
├── Applications                  /multi-cluster/applications/:plural?
│     Subscriptions · Channels · Argo CD Applications · ApplicationSets · Helm Releases ·
│     Subscription Reports · Subscription Statuses
├── GitOps                        /multi-cluster/gitops/:plural?
│     GitOps Clusters · ApplicationSet Reports · Argo CD Projects · Managed Service Accounts ·
│     Cluster Permissions · Argo CD clusters (cluster secrets)
├── Governance                    /multi-cluster/governance/:plural?
│     Policies · Policy Sets · Placement Bindings · Automations · Configuration Policies ·
│     Operator Policies
├── Add-ons                       /multi-cluster/addons/:plural?
│     Cluster Add-ons · Installed Add-ons · Deployment Configs · Templates
└── Hub Settings                  /multi-cluster/settings/:plural?
      Cluster Manager · Klusterlet · Cluster Claims · Cluster Properties · Applied ManifestWorks
```

Detail pages live below the tab URL: `/multi-cluster/<section>/<plural>/<name>` for
cluster-scoped kinds and `/multi-cluster/<section>/<plural>/<namespace>/<name>` for namespaced
kinds. Sections whose kinds are all missing in the current cluster are hidden from the sidebar;
inside a section, tabs of missing kinds are disabled with a tooltip.

## Layers

```
src/
├── index.tsx                 registrations (sidebar, routes, kind icons, sidebar filter)
├── api/
│   ├── kinds.ts              pure: every supported kind, group, plural, scope, supported versions
│   ├── availability.ts       pure: discovery result → chosen version / not installed / unsupported
│   ├── capabilities.ts       pure: CRD schema → version-dependent features
│   └── discovery.ts          fetching (/apis, group versions, CRD objects) and caching
├── resources/
│   ├── models/*.ts           pure typed JSON models and derived state (status, health, summaries)
│   ├── base.ts               OcmObject: Headlamp KubeObject with a mutable, discovered apiVersion
│   ├── classes.ts            one KubeObject class per kind (+ CertificateSigningRequest)
│   └── registry.ts           sections, tab order, labels, icons and routes per kind
├── readiness/model.ts        pure: platform readiness per stack (checks, install hints)
├── hooks/                    discovery, lists that skip missing CRDs, RBAC checks
├── utils/                    selectors, placement preview, validation, templates, YAML, objects
└── components/
    ├── common/               states, gate, list/detail shells, links, YAML section
    ├── common/form/          fields, selector editors, editor dialog, wizard shell
    ├── overview/             dashboard
    └── <section>/            views, forms, wizards and actions per section
```

Everything under `api/kinds.ts`, `api/availability.ts`, `api/capabilities.ts`,
`readiness`, `resources/models` and `utils` is free of Headlamp runtime imports, so it is unit tested with
vitest (Headlamp's `lib` does not resolve outside the Headlamp runtime).

## Version adaptation

* Discovery reads `/apis` once, then `/apis/<group>/<version>` for the OCM groups that are
  served. Results are cached per cluster; failures are not cached.
* `chooseVersion` picks the most stable served version that the plugin supports for a kind.
  The chosen version is written to the resource class (`apiVersion`) before any request.
* Each kind is in one of three states: `available`, `missing` (not served) or `unsupported`
  (served only in versions the plugin does not know). The gate component renders a clear
  empty state for the last two.
* Field-level differences are expressed as capabilities (`placement.celSelector`,
  `placement.sortBy`, `mwrs.cascadeDeletionPolicy`, …). They are detected from the CRD schema
  when it is readable; otherwise the form shows the field with a "requires OCM ≥ x" hint.
* The add-on kinds have two shapes (v1alpha1 / v1beta1). `models/addon.ts` normalizes reads
  and writes them back in the shape of the version that is being edited.

## Editing

* `ResourceEditorDialog`: Form / YAML / Documentation tabs, two-way sync (form → YAML on every
  change, YAML → form whenever the YAML parses), validation before apply, server-side apply via
  `ApiProxy.apply`.
* `SetupWizardDialog`: multi-resource wizards with a review step that shows the generated YAML
  and applies the resources in order, stopping at the first failure.
* Every detail page has a YAML section (view + edit) in addition to Headlamp's own edit and
  delete header actions.

## Wizards

| Wizard | Creates |
| --- | --- |
| Import cluster | Namespace (cluster namespace), ManagedCluster (accepted, labelled with its set), ManagedClusterAddOns; afterwards the detail page shows pending CSRs with an approve action |
| Create placement | Placement, missing ManagedClusterSetBindings; includes a live preview of the selected clusters |
| Deploy application | Channel (new or existing), Subscription, Placement (new or existing), bindings |
| Configure GitOps | Placement (new or existing), bindings, GitOpsCluster |
| Create a policy | Placement (new or existing) and bindings, Policy with ConfigurationPolicy / OperatorPolicy / YAML templates, PlacementBinding |
| Deploy with Argo CD | Placement (new or existing) and bindings in the Argo CD namespace, GitOpsCluster when none serves the placement, ApplicationSet with the OCM placement generator (push or pull model) |
| Distribute workload | ManifestWorkReplicaSet with a Placement, or one ManifestWork per chosen cluster |

## Actions and RBAC

Actions are wrapped in Headlamp's `AuthVisible` (SelfSubjectAccessReview) with the verb they
need: `create`, `update`/`patch`, `delete`, and `update` on `certificatesigningrequests/approval`
for CSR approval. Users without the permission do not see the action.

| Action | Request |
| --- | --- |
| Accept cluster | merge patch `spec.hubAcceptsClient: true` |
| Revoke acceptance | merge patch `spec.hubAcceptsClient: false` |
| Detach cluster | delete the ManagedCluster (confirmation dialog) |
| Approve CSR | `PUT …/certificatesigningrequests/<name>/approval` with an `Approved` condition |
| Enable add-on on a cluster | create a ManagedClusterAddOn in the cluster namespace |
| Disable add-on | delete the ManagedClusterAddOn (confirmation dialog) |
| Pause / resume Subscription | merge patch label `subscription-pause: "true" / "false"` |
| Policy inform / enforce | merge patch `spec.remediationAction` |
| Policy enable / disable | merge patch `spec.disabled` |
| Argo CD refresh / hard refresh | merge patch annotation `argocd.argoproj.io/refresh` |
| Argo CD sync | merge patch `operation` (`initiatedBy`, `sync`) |
| Assign cluster to a set | merge patch label `cluster.open-cluster-management.io/clusterset` |
