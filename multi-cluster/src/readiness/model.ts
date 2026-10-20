/**
 * Platform readiness: which parts of a full OCM multicluster stack (hub, registration,
 * placement, work, add-ons, application delivery with Argo CD in push / pull / agent mode,
 * governance, access add-ons, cluster inventory, search) are installed and working.
 *
 * Pure: the inputs are lists the overview already loads. Install commands and names come from
 * the upstream sources listed in docs/API_MATRIX.md (clusteradm v0.9 – v1.3, OCM add-on charts).
 */
import { Availability, isKindAvailable, kindState, servesGroup } from '../api/availability';
import { kindMeta } from '../api/kinds';
import {
  addonState,
  ClusterManagementAddOnJson,
  ManagedClusterAddOnJson,
} from '../resources/models/addon';
import {
  gitOpsArgoNamespace,
  GitOpsClusterJson,
  gitOpsHealth,
  isAgentGitOpsCluster,
} from '../resources/models/apps';
import { ArgoClusterSecret, OCM_ARGO } from '../resources/models/argo';
import {
  clusterCounts,
  CSRJson,
  ManagedClusterJson,
  ManagedClusterSetJson,
  pendingCSRsByCluster,
} from '../resources/models/cluster';
import {
  ClusterManagerJson,
  FeatureGate,
  hubVersionHint,
  operatorHealth,
} from '../resources/models/operator';

export type StackStatus = 'ready' | 'partial' | 'missing';
export type CheckState = 'ok' | 'warn' | 'error' | 'info';
export type Layer = 'core' | 'delivery' | 'gitops' | 'governance' | 'access';

export interface Check {
  label: string;
  state: CheckState;
  detail?: string;
}

export interface InstallHint {
  text: string;
  commands?: string[];
  docsUrl: string;
}

export interface StackReadiness {
  id: string;
  name: string;
  layer: Layer;
  description: string;
  /** Not every hub needs this stack. */
  optional: boolean;
  status: StackStatus;
  checks: Check[];
  /** Kinds whose served version is shown. */
  kinds: string[];
  install?: InstallHint;
}

export interface ReadinessInput {
  availability: Availability;
  clusterManager?: ClusterManagerJson | null;
  clusters?: ManagedClusterJson[] | null;
  csrs?: CSRJson[] | null;
  sets?: ManagedClusterSetJson[] | null;
  cmas?: ClusterManagementAddOnJson[] | null;
  mcas?: ManagedClusterAddOnJson[] | null;
  gitops?: GitOpsClusterJson[] | null;
  argoSecrets?: ArgoClusterSecret[] | null;
  /** Names of the ApplicationSet generator ConfigMaps found in the Argo CD namespaces. */
  generatorConfigMaps?: string[] | null;
  /** Generator ConfigMaps that could not be read (e.g. no permission), so may exist. */
  unreadableConfigMaps?: string[];
  /** Search services found on the hub, as `namespace/name`. */
  searchServices?: string[] | null;
}

/** Namespace the search components are looked up in. */
export const SEARCH_NAMESPACE = 'open-cluster-management';

/**
 * Services of the search components, by role. Names from search-v2-operator
 * (`create_apiservice.go`, `common.go`); `search-postgresql` is also accepted for the database.
 */
export const SEARCH_SERVICES: Record<'api' | 'indexer' | 'database', string[]> = {
  api: ['search-search-api'],
  indexer: ['search-indexer'],
  database: ['search-postgres', 'search-postgresql'],
};

const DOCS = 'https://open-cluster-management.io/docs';
const PULL_REPO = 'https://github.com/open-cluster-management-io/argocd-pull-integration';

export interface OcmVersion {
  major: number;
  minor: number;
}

/** OCM version from an image tag such as "v1.3.1" (undefined for "latest" or digests). */
export function parseOcmVersion(tag: string | undefined): OcmVersion | undefined {
  const m = /^v?(\d+)\.(\d+)/.exec(tag || '');
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : undefined;
}

/** A hub feature gate from the cluster manager spec, or its default when not set. */
export function gateEnabled(
  gates: FeatureGate[] | undefined,
  feature: string,
  defaultOn: boolean
): boolean {
  const gate = (gates || []).find(g => g.feature === feature);
  if (!gate) return defaultOn;
  // The CRD defaults `mode` to Disable.
  return gate.mode === 'Enable';
}

function hasKind(input: ReadinessInput, kind: string): boolean {
  return isKindAvailable(input.availability, kindMeta(kind));
}

function servedVersion(input: ReadinessInput, kind: string): string | undefined {
  const s = kindState(input.availability, kindMeta(kind));
  return s.status === 'available' ? s.apiVersion.split('/')[1] : undefined;
}

function cma(input: ReadinessInput, name: string): ClusterManagementAddOnJson | undefined {
  return (input.cmas || []).find(c => c.metadata.name === name);
}

/** "n of m clusters" check for the installations of an add-on. */
function addonCheck(input: ReadinessInput, name: string, label: string): Check {
  if (!input.mcas) return { label, state: 'info', detail: 'unknown' };
  const own = input.mcas.filter(m => m.metadata.name === name);
  const ok = own.filter(m => addonState(m) === 'available').length;
  if (own.length === 0) return { label, state: 'warn', detail: 'not enabled on any cluster' };
  return {
    label,
    state: ok === own.length ? 'ok' : 'warn',
    detail: `available on ${ok} of ${own.length} cluster(s)`,
  };
}

function status(checks: Check[], installed: boolean): StackStatus {
  if (!installed) return 'missing';
  return checks.some(c => c.state === 'error' || c.state === 'warn') ? 'partial' : 'ready';
}

const ok = (label: string, detail?: string): Check => ({ label, state: 'ok', detail });
const warn = (label: string, detail?: string): Check => ({ label, state: 'warn', detail });
const error = (label: string, detail?: string): Check => ({ label, state: 'error', detail });
const info = (label: string, detail?: string): Check => ({ label, state: 'info', detail });

/** Whether an ApplicationSet generator ConfigMap exists in one of the Argo CD namespaces. */
function configMapCheck(input: ReadinessInput, name: string): Check {
  const label = `${name} ConfigMap`;
  if ((input.generatorConfigMaps || []).includes(name)) return ok(label);
  if ((input.unreadableConfigMaps || []).includes(name)) {
    return warn(
      label,
      'could not be read; check the permissions on ConfigMaps in the Argo CD namespaces'
    );
  }
  return warn(label, 'not found in the Argo CD namespaces');
}

export function assessReadiness(input: ReadinessInput): StackReadiness[] {
  const cm = input.clusterManager || undefined;
  const version = parseOcmVersion(hubVersionHint(cm));
  const v1 = version ? version.major >= 1 : undefined;
  const regGates = cm?.spec?.registrationConfiguration?.featureGates;
  const workGates = cm?.spec?.workConfiguration?.featureGates;
  const hub = hasKind(input, 'ManagedCluster');
  const stacks: StackReadiness[] = [];

  // ----- Core -----

  {
    const checks: Check[] = [
      hub ? ok('ManagedCluster API served') : error('ManagedCluster API not served'),
    ];
    if (hub) {
      if (!cm) checks.push(info('ClusterManager', 'not visible (hosted mode or no read access)'));
      else {
        const h = operatorHealth(cm.status?.conditions);
        checks.push(
          h === 'success'
            ? ok('Cluster manager', 'all components applied')
            : h === 'error'
            ? error('Cluster manager', 'degraded — see Hub Settings')
            : warn('Cluster manager', h === 'warning' ? 'progressing' : 'no status')
        );
        checks.push(info('Version (image tag)', hubVersionHint(cm) || 'unknown'));
        checks.push(info('Work driver', cm.spec?.workConfiguration?.workDriver || 'kube'));
      }
    }
    stacks.push({
      id: 'hub',
      name: 'Hub control plane',
      layer: 'core',
      optional: false,
      description:
        'Cluster manager: registration, work, placement and add-on manager controllers on the hub.',
      status: status(checks, hub),
      checks,
      kinds: ['ClusterManager', 'ManagedCluster'],
      install: {
        text: 'Initialize the hub with clusteradm (run against the hub cluster).',
        commands: ['clusteradm init --wait'],
        docsUrl: `${DOCS}/getting-started/installation/start-the-control-plane/`,
      },
    });
  }

  {
    const checks: Check[] = [];
    if (hub) {
      const clusters = input.clusters || [];
      const counts = clusterCounts(clusters);
      if (input.clusters === null || input.clusters === undefined)
        checks.push(info('Managed clusters', 'loading'));
      else if (counts.total === 0) checks.push(warn('Managed clusters', 'none registered yet'));
      else {
        checks.push(
          counts.available === counts.total
            ? ok('Managed clusters', `${counts.available} of ${counts.total} available`)
            : warn('Managed clusters', `${counts.available} of ${counts.total} available`)
        );
        if (counts.pendingAccept + counts.pendingJoin > 0) {
          checks.push(
            warn(
              'Registration',
              `${counts.pendingAccept} not accepted, ${counts.pendingJoin} not joined`
            )
          );
        }
      }
      const pending = Object.values(pendingCSRsByCluster(input.csrs || [])).reduce(
        (n, l) => n + l.length,
        0
      );
      if (pending > 0) checks.push(warn('Certificate requests', `${pending} pending approval`));
      checks.push(
        info(
          'Auto-approval (ManagedClusterAutoApproval)',
          gateEnabled(regGates, 'ManagedClusterAutoApproval', false) ? 'enabled' : 'disabled'
        )
      );
    }
    stacks.push({
      id: 'registration',
      name: 'Cluster registration',
      layer: 'core',
      optional: false,
      description:
        'Managed clusters joined through the klusterlet agent and their registration requests.',
      status: status(checks, hub),
      checks,
      kinds: ['ManagedCluster', 'CertificateSigningRequest', 'Klusterlet'],
      install: {
        text: 'Get a join token on the hub, join each cluster with its kubeconfig, then accept it on the hub (or approve its CSR here).',
        commands: [
          'clusteradm get token',
          'clusteradm join --hub-token <token> --hub-apiserver <hub API server URL> --cluster-name <cluster>',
          'clusteradm accept --clusters <cluster>',
        ],
        docsUrl: `${DOCS}/getting-started/installation/register-a-cluster/`,
      },
    });
  }

  {
    const placement = hasKind(input, 'Placement');
    const setsApi = hasKind(input, 'ManagedClusterSet');
    const checks: Check[] = [
      placement ? ok('Placement API served') : error('Placement API not served'),
      setsApi ? ok('ManagedClusterSet API served') : error('ManagedClusterSet API not served'),
    ];
    if (setsApi && input.sets) {
      const names = input.sets.map(s => s.metadata.name);
      checks.push(
        names.length > 0
          ? ok('Cluster sets', names.slice(0, 6).join(', '))
          : warn('Cluster sets', 'none')
      );
    }
    checks.push(
      info(
        'Default cluster sets (DefaultClusterSet)',
        gateEnabled(regGates, 'DefaultClusterSet', v1 !== false) ? 'enabled' : 'disabled'
      )
    );
    stacks.push({
      id: 'placement',
      name: 'Placement and cluster sets',
      layer: 'core',
      optional: false,
      description: 'Scheduling: cluster sets bound to namespaces, placements and their decisions.',
      status: status(checks, placement && setsApi),
      checks,
      kinds: [
        'ManagedClusterSet',
        'ManagedClusterSetBinding',
        'Placement',
        'PlacementDecision',
        'AddOnPlacementScore',
      ],
      install: {
        text: 'Part of the cluster manager. Bind a cluster set to the namespace of your placements (Cluster Sets → Bindings).',
        commands: ['clusteradm clusterset bind <set> --namespace <namespace>'],
        docsUrl: `${DOCS}/concepts/content-placement/placement/`,
      },
    });
  }

  {
    const mw = hasKind(input, 'ManifestWork');
    const mwrs = hasKind(input, 'ManifestWorkReplicaSet');
    const mwrsGate = gateEnabled(workGates, 'ManifestWorkReplicaSet', false);
    const checks: Check[] = [
      mw ? ok('ManifestWork API served') : error('ManifestWork API not served'),
    ];
    if (mwrs) {
      checks.push(
        cm
          ? mwrsGate
            ? ok('ManifestWorkReplicaSet', 'feature gate enabled')
            : warn(
                'ManifestWorkReplicaSet',
                'API served but the hub work feature gate is disabled — replica sets are not reconciled'
              )
          : info('ManifestWorkReplicaSet', 'feature gate state unknown')
      );
    } else checks.push(info('ManifestWorkReplicaSet', 'API not served'));
    stacks.push({
      id: 'work',
      name: 'Work distribution',
      layer: 'core',
      optional: false,
      description:
        'ManifestWorks deliver Kubernetes resources to clusters; replica sets fan them out by placement.',
      status: status(checks, mw),
      checks,
      kinds: ['ManifestWork', 'ManifestWorkReplicaSet'],
      install: {
        text: 'Part of the cluster manager. To use ManifestWorkReplicaSets, enable the ManifestWorkReplicaSet feature gate under Work in Hub Settings → Cluster Manager (or clusteradm init --feature-gates).',
        docsUrl: `${DOCS}/getting-started/administration/featuregates/`,
      },
    });
  }

  {
    const api = hasKind(input, 'ClusterManagementAddOn');
    const checks: Check[] = [api ? ok('Add-on API served') : error('Add-on API not served')];
    if (api && input.cmas) checks.push(info('Registered add-ons', String(input.cmas.length)));
    if (api && input.mcas) {
      const bad = input.mcas.filter(m =>
        ['degraded', 'unavailable'].includes(addonState(m))
      ).length;
      checks.push(
        bad > 0
          ? warn('Add-on agents', `${bad} degraded or unavailable`)
          : ok('Add-on agents', `${input.mcas.length} healthy or progressing`)
      );
    }
    const addonGate = cm?.spec?.addOnManagerConfiguration?.featureGates;
    if (cm && !gateEnabled(addonGate, 'AddonManagement', true))
      checks.push(warn('AddonManagement', 'disabled on the hub'));
    stacks.push({
      id: 'addons',
      name: 'Add-on framework',
      layer: 'core',
      optional: false,
      description: 'Add-on manager and the agents it installs on managed clusters.',
      status: status(checks, api),
      checks,
      kinds: [
        'ClusterManagementAddOn',
        'ManagedClusterAddOn',
        'AddOnDeploymentConfig',
        'AddOnTemplate',
      ],
      install: {
        text: 'Part of the cluster manager. Enable an add-on on clusters with clusteradm or from the cluster page.',
        commands: ['clusteradm addon enable --names <addon> --clusters <cluster1>,<cluster2>'],
        docsUrl: `${DOCS}/concepts/add-on-extensibility/addon/`,
      },
    });
  }

  // ----- Delivery -----

  {
    const api = hasKind(input, 'Subscription') && hasKind(input, 'Channel');
    const registered = !!cma(input, 'application-manager');
    const checks: Check[] = [
      api
        ? ok('Subscription / Channel APIs served')
        : warn('Subscription / Channel APIs not served'),
      registered
        ? ok('application-manager add-on registered')
        : warn('application-manager add-on not registered'),
    ];
    if (registered) checks.push(addonCheck(input, 'application-manager', 'Subscription agents'));
    stacks.push({
      id: 'subscriptions',
      name: 'Application lifecycle (Subscriptions)',
      layer: 'delivery',
      optional: true,
      description:
        'Channel → Subscription → Placement delivery from Git, Helm and object buckets (push).',
      status: status(checks, api || registered),
      checks,
      kinds: ['Subscription', 'Channel', 'PlacementRule', 'SubscriptionReport'],
      install:
        v1 === true
          ? {
              text: 'clusteradm v1.x no longer installs the application-manager add-on (multicloud-operators-subscription was last released as v0.16.0). Prefer the Argo CD integration below for new applications.',
              docsUrl: `${DOCS}/getting-started/integration/app-lifecycle/`,
            }
          : {
              text: 'With clusteradm v0.9 – v0.11 (OCM v0.14 – v0.16): install the hub add-on, then enable it on the clusters.',
              commands: [
                'clusteradm install hub-addon --names application-manager',
                'clusteradm addon enable --names application-manager --clusters <cluster1>,<cluster2>',
              ],
              docsUrl: `${DOCS}/getting-started/integration/app-lifecycle/`,
            },
    });
  }

  // ----- GitOps -----

  const argo = hasKind(input, 'Application') && hasKind(input, 'ApplicationSet');
  {
    const checks: Check[] = [
      argo ? ok('Application / ApplicationSet APIs served') : warn('Argo CD APIs not served'),
      hasKind(input, 'AppProject')
        ? ok('AppProject API served')
        : warn('AppProject API not served'),
    ];
    stacks.push({
      id: 'argocd',
      name: 'Argo CD on the hub',
      layer: 'gitops',
      optional: true,
      description: 'Argo CD and its ApplicationSet controller, used by every OCM GitOps model.',
      status: status(checks, argo),
      checks,
      kinds: ['Application', 'ApplicationSet', 'AppProject'],
      install: {
        text: 'Install Argo CD in its own namespace (or with the Argo CD Helm chart / operator).',
        commands: [
          'kubectl create namespace argocd',
          'kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml',
        ],
        docsUrl: 'https://argo-cd.readthedocs.io/en/stable/getting_started/',
      },
    });
  }

  const goc = kindState(input.availability, kindMeta('GitOpsCluster'));
  const gocVersion = goc.status === 'available' ? goc.apiVersion.split('/')[1] : undefined;
  const gitops = input.gitops || [];

  {
    const secretApi = gocVersion === 'v1beta1';
    const own = gitops.filter(g => !isAgentGitOpsCluster(g));
    const secrets = (input.argoSecrets || []).filter(s => s.ocmManaged);
    const checks: Check[] = [
      secretApi
        ? ok('GitOpsCluster v1beta1 served')
        : warn(
            'GitOpsCluster v1beta1 not served',
            gocVersion ? `this hub serves ${gocVersion} (argocd-agent)` : undefined
          ),
    ];
    if (secretApi) {
      const healthy = own.filter(g => gitOpsHealth(g) === 'success').length;
      checks.push(
        own.length === 0
          ? warn('GitOpsClusters', 'none')
          : healthy === own.length
          ? ok('GitOpsClusters', `${own.length} successful`)
          : warn('GitOpsClusters', `${healthy} of ${own.length} successful`)
      );
      checks.push(
        secrets.length > 0
          ? ok('Clusters registered in Argo CD', String(secrets.length))
          : warn('Clusters registered in Argo CD', 'none')
      );
      checks.push(configMapCheck(input, OCM_ARGO.placementConfigMap));
    }
    stacks.push({
      id: 'gitops-push',
      name: 'GitOps push model',
      layer: 'gitops',
      optional: true,
      description:
        'GitOpsCluster (v1beta1) registers the clusters of a placement as Argo CD cluster secrets; the hub Argo CD deploys to them.',
      status: status(checks, secretApi),
      checks,
      kinds: ['GitOpsCluster', 'ManagedServiceAccount'],
      install: {
        text: 'multicloud-integrations provides GitOpsCluster v1beta1; the repository was archived before OCM v1.0 — on OCM v1.x use argocd-pull-integration (pull / agent models).',
        commands: [
          'git clone https://github.com/open-cluster-management-io/multicloud-integrations',
          'kubectl apply -f multicloud-integrations/deploy/crds',
          'kubectl apply -f multicloud-integrations/deploy/controller',
        ],
        docsUrl: `${DOCS}/scenarios/integration-with-argocd/`,
      },
    });
  }

  {
    const integration = !!cma(input, 'argocd');
    const report = hasKind(input, 'MulticlusterApplicationSetReport');
    const checks: Check[] = [
      integration
        ? ok('argocd add-on registered (argocd-pull-integration)')
        : info('argocd add-on', 'not registered'),
      report
        ? ok('MulticlusterApplicationSetReport API served (multicloud-integrations)')
        : info('MulticlusterApplicationSetReport API', 'not served'),
    ];
    if (integration) {
      checks.push(addonCheck(input, 'argocd', 'Argo CD on managed clusters'));
      checks.push(configMapCheck(input, OCM_ARGO.pullIntegrationConfigMap));
    }
    checks.push(
      info(
        'Cluster registration',
        'the ApplicationSet generator only yields clusters with an Argo CD cluster secret'
      )
    );
    stacks.push({
      id: 'gitops-pull',
      name: 'GitOps basic pull model',
      layer: 'gitops',
      optional: true,
      description:
        'Hub Applications labelled for the pull model are wrapped in ManifestWorks and reconciled by Argo CD on each managed cluster.',
      status: status(checks, argo && (integration || report)),
      checks,
      kinds: ['Application', 'ManifestWork', 'MulticlusterApplicationSetReport'],
      install: {
        text: 'Install the argocd hub add-on (clusteradm v1.0+), then enable it on the clusters — it installs Argo CD on them.',
        commands: [
          'clusteradm install hub-addon --names argocd',
          'clusteradm addon enable --names argocd --clusters <cluster1>,<cluster2>',
        ],
        docsUrl: PULL_REPO,
      },
    });
  }

  {
    const agentApi = gocVersion === 'v1alpha1';
    const registered = !!cma(input, 'argocd-agent-addon');
    const own = gitops.filter(isAgentGitOpsCluster);
    const checks: Check[] = [
      agentApi
        ? ok('GitOpsCluster v1alpha1 served (argocd-agent)')
        : info(
            'GitOpsCluster v1alpha1',
            gocVersion ? `this hub serves ${gocVersion}` : 'not served'
          ),
      registered
        ? ok('argocd-agent-addon registered')
        : info('argocd-agent-addon', 'not registered'),
    ];
    if (agentApi) {
      const ready = own.filter(g => gitOpsHealth(g) === 'success').length;
      checks.push(
        own.length === 0
          ? warn('GitOpsClusters', 'none')
          : ready === own.length
          ? ok('GitOpsClusters', `${own.length} ready`)
          : warn('GitOpsClusters', `${ready} of ${own.length} ready`)
      );
      if (registered) checks.push(addonCheck(input, 'argocd-agent-addon', 'Argo CD agents'));
      checks.push(configMapCheck(input, OCM_ARGO.pullIntegrationConfigMap));
    }
    stacks.push({
      id: 'gitops-agent',
      name: 'GitOps advanced pull (argocd-agent)',
      layer: 'gitops',
      optional: true,
      description:
        'GitOpsCluster (v1alpha1) deploys the Argo CD agent to the clusters of a placement; applications are routed by destination name with full status in the hub Argo CD.',
      status: status(checks, agentApi),
      checks,
      kinds: ['GitOpsCluster', 'ApplicationSet'],
      install: {
        text: 'Install the argocd-agent hub add-on (clusteradm v1.2+), then create a GitOpsCluster in the Argo CD namespace.',
        commands: ['clusteradm install hub-addon --names argocd-agent'],
        docsUrl: PULL_REPO,
      },
    });
  }

  // ----- Governance -----

  {
    const api = hasKind(input, 'Policy');
    const framework = !!cma(input, 'governance-policy-framework');
    const config = !!cma(input, 'config-policy-controller');
    const checks: Check[] = [
      api ? ok('Policy API served') : warn('Policy API not served'),
      framework
        ? ok('governance-policy-framework add-on registered')
        : warn('governance-policy-framework add-on not registered'),
      config
        ? ok('config-policy-controller add-on registered')
        : warn('config-policy-controller add-on not registered'),
    ];
    if (framework)
      checks.push(addonCheck(input, 'governance-policy-framework', 'Policy framework agents'));
    if (config)
      checks.push(
        addonCheck(input, 'config-policy-controller', 'Configuration policy controllers')
      );
    stacks.push({
      id: 'governance',
      name: 'Policy framework',
      layer: 'governance',
      optional: true,
      description:
        'Policies, policy sets and the configuration / operator policy controllers on the managed clusters.',
      status: status(checks, api),
      checks,
      kinds: ['Policy', 'PolicySet', 'PlacementBinding', 'PolicyAutomation'],
      install: {
        text: 'Install the policy framework on the hub, then enable its two add-ons on the clusters.',
        commands: [
          'clusteradm install hub-addon --names governance-policy-framework',
          'clusteradm addon enable --names governance-policy-framework,config-policy-controller --clusters <cluster1>,<cluster2>',
        ],
        docsUrl: `${DOCS}/getting-started/integration/policy-controllers/policy-framework/`,
      },
    });
  }

  // ----- Access -----

  {
    const api = hasKind(input, 'ManagedServiceAccount');
    const registered = !!cma(input, 'managed-serviceaccount');
    const checks: Check[] = [
      api
        ? ok('ManagedServiceAccount API served', servedVersion(input, 'ManagedServiceAccount'))
        : warn('ManagedServiceAccount API not served'),
      registered
        ? ok('managed-serviceaccount add-on registered')
        : warn('managed-serviceaccount add-on not registered'),
    ];
    if (registered) checks.push(addonCheck(input, 'managed-serviceaccount', 'Agents'));
    stacks.push({
      id: 'msa',
      name: 'Managed service accounts',
      layer: 'access',
      optional: true,
      description:
        'Service account tokens of managed clusters projected to the hub (used by GitOps and cluster-proxy clients).',
      status: status(checks, api || registered),
      checks,
      kinds: ['ManagedServiceAccount'],
      install: {
        text: 'Install the add-on with Helm on the hub.',
        commands: [
          'helm repo add ocm https://open-cluster-management.io/helm-charts/',
          'helm install -n open-cluster-management-addon --create-namespace managed-serviceaccount ocm/managed-serviceaccount',
        ],
        docsUrl: `${DOCS}/getting-started/integration/managed-serviceaccount/`,
      },
    });
  }

  {
    const group = servesGroup(input.availability, 'proxy.open-cluster-management.io');
    const registered = !!cma(input, 'cluster-proxy');
    const checks: Check[] = [
      group
        ? ok('proxy.open-cluster-management.io API served')
        : warn('cluster-proxy API not served'),
      registered
        ? ok('cluster-proxy add-on registered')
        : warn('cluster-proxy add-on not registered'),
    ];
    if (registered) checks.push(addonCheck(input, 'cluster-proxy', 'Proxy agents'));
    stacks.push({
      id: 'cluster-proxy',
      name: 'Cluster proxy',
      layer: 'access',
      optional: true,
      description:
        'Reverse tunnels from managed clusters, so the hub can reach their API servers without inbound access.',
      status: status(checks, group || registered),
      checks,
      kinds: [],
      install: {
        text: 'Install the add-on with Helm on the hub.',
        commands: [
          'helm repo add ocm https://open-cluster-management.io/helm-charts/',
          'helm install -n open-cluster-management-addon --create-namespace cluster-proxy ocm/cluster-proxy',
        ],
        docsUrl: `${DOCS}/getting-started/integration/cluster-proxy/`,
      },
    });
  }

  {
    const api = hasKind(input, 'ClusterProfile');
    const gate = gateEnabled(regGates, 'ClusterProfile', false);
    const checks: Check[] = [
      api
        ? ok('ClusterProfile API served (multicluster.x-k8s.io)')
        : info('ClusterProfile API', 'not served (OCM v1.1.0+)'),
    ];
    if (api) {
      checks.push(
        cm
          ? gate
            ? ok('ClusterProfile feature gate', 'enabled')
            : warn('ClusterProfile feature gate', 'disabled — profiles are not maintained')
          : info('ClusterProfile feature gate', 'unknown')
      );
    }
    stacks.push({
      id: 'cluster-inventory',
      name: 'Cluster inventory API',
      layer: 'access',
      optional: true,
      description:
        'SIG-Multicluster ClusterProfiles maintained by the hub, for tools that consume the cluster inventory API.',
      status: status(checks, api),
      checks,
      kinds: ['ClusterProfile'],
      install: {
        text: 'Served by OCM v1.1.0+. Enable the ClusterProfile feature gate under Registration in Hub Settings → Cluster Manager.',
        docsUrl: `${DOCS}/scenarios/clusterprofile-access-providers/`,
      },
    });
  }

  {
    const group = servesGroup(input.availability, 'search.open-cluster-management.io');
    const registered = !!cma(input, 'search-collector');
    const found = input.searchServices || [];
    const component = (role: keyof typeof SEARCH_SERVICES, label: string): Check => {
      if (!input.searchServices) return info(label, 'unknown');
      const hit = found.find(f => SEARCH_SERVICES[role].includes(f.split('/')[1]));
      return hit
        ? ok(label, hit)
        : warn(label, `no ${SEARCH_SERVICES[role].join(' or ')} service in ${SEARCH_NAMESPACE}`);
    };
    const anyService = found.length > 0;
    const checks: Check[] = [];
    if (group) checks.push(ok('search.open-cluster-management.io API served (search-v2-operator)'));
    if (group || anyService) {
      checks.push(component('api', 'Search API'));
      checks.push(component('indexer', 'Indexer'));
      checks.push(component('database', 'PostgreSQL'));
    } else
      checks.push(
        info(
          'Search components',
          input.searchServices ? `no search services in ${SEARCH_NAMESPACE}` : 'unknown'
        )
      );
    checks.push(
      registered
        ? ok('search-collector add-on registered')
        : info('search-collector add-on', 'not registered')
    );
    if (registered) checks.push(addonCheck(input, 'search-collector', 'Collectors'));
    stacks.push({
      id: 'search',
      name: 'Search',
      layer: 'access',
      optional: true,
      description: 'Cross-cluster resource search API. OCM itself has no search API.',
      status: status(checks, group || anyService),
      checks,
      kinds: [],
      install: {
        text: 'Search consists of search-api, search-indexer and a PostgreSQL database on the hub, and search-collector on the managed clusters. Install them with search-v2-operator or deploy the components directly; it is not part of OCM.',
        docsUrl: 'https://github.com/stolostron/search-v2-operator',
      },
    });
  }

  return stacks;
}

export interface ReadinessSummary {
  required: number;
  requiredReady: number;
  optionalInstalled: number;
  optional: number;
  gitopsModels: string[];
}

export function summarize(stacks: StackReadiness[]): ReadinessSummary {
  const required = stacks.filter(s => !s.optional);
  const optional = stacks.filter(s => s.optional);
  return {
    required: required.length,
    requiredReady: required.filter(s => s.status === 'ready').length,
    optional: optional.length,
    optionalInstalled: optional.filter(s => s.status !== 'missing').length,
    gitopsModels: stacks
      .filter(
        s => ['gitops-push', 'gitops-pull', 'gitops-agent'].includes(s.id) && s.status !== 'missing'
      )
      .map(s => s.name.replace('GitOps ', '')),
  };
}

export const LAYER_LABELS: Record<Layer, string> = {
  core: 'Core multicluster management',
  delivery: 'Application delivery',
  gitops: 'GitOps with Argo CD',
  governance: 'Governance',
  access: 'Access and inventory',
};

/** Namespaces that may hold the ApplicationSet generator ConfigMaps (no namespace is assumed). */
export function argoNamespaces(
  gitops: GitOpsClusterJson[],
  secrets: ArgoClusterSecret[],
  appSetNamespaces: string[]
): string[] {
  const all = [
    ...gitops.map(gitOpsArgoNamespace),
    ...secrets.map(s => s.namespace),
    ...appSetNamespaces,
  ].filter((n): n is string => !!n);
  return [...new Set(all)].sort();
}

/** The generator ConfigMap names this plugin knows. */
export const GENERATOR_CONFIGMAPS: string[] = [
  OCM_ARGO.placementConfigMap,
  OCM_ARGO.pullIntegrationConfigMap,
];
