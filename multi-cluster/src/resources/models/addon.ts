/**
 * Add-on APIs (addon.open-cluster-management.io). ClusterManagementAddOn and
 * ManagedClusterAddOn have two shapes:
 *
 * - v1alpha1 (all OCM versions): `spec.supportedConfigs[]` = `{group, resource,
 *   defaultConfig{name, namespace}}`, `spec.installNamespace` on ManagedClusterAddOn;
 * - v1beta1 (OCM v1.2.0+): `spec.defaultConfigs[]` = `{group, resource, name, namespace}`, no
 *   install namespace (use AddOnDeploymentConfig.spec.agentInstallNamespace instead).
 *
 * The functions below read both shapes and write the shape of the version being edited.
 */
import { bareVersion } from '../../common/kubeVersion';
import { Condition, findCondition, Health, KubeJson } from './common';
import { RolloutStrategy } from './work';

export const ADDON_DEPLOYMENT_CONFIG_RESOURCE = {
  group: 'addon.open-cluster-management.io',
  resource: 'addondeploymentconfigs',
};

export interface AddOnConfigRef {
  group?: string;
  resource: string;
  name?: string;
  namespace?: string;
}

export interface InstallPlacement {
  name: string;
  namespace: string;
  configs?: AddOnConfigRef[];
  rolloutStrategy?: RolloutStrategy;
}

export interface ClusterManagementAddOnJson extends KubeJson {
  spec?: {
    addOnMeta?: { displayName?: string; description?: string };
    installStrategy?: { type?: 'Manual' | 'Placements' | string; placements?: InstallPlacement[] };
    // v1alpha1
    supportedConfigs?: Array<{
      group?: string;
      resource: string;
      defaultConfig?: { name: string; namespace?: string };
    }>;
    addOnConfiguration?: { crdName?: string; crName?: string };
    // v1beta1
    defaultConfigs?: AddOnConfigRef[];
  };
  status?: {
    installProgressions?: Array<{ name: string; namespace: string; conditions?: Condition[] }>;
  };
}

export function isV1beta1(apiVersion: string | undefined): boolean {
  return !!apiVersion && bareVersion(apiVersion) === 'v1beta1';
}

/**
 * Default configurations of a ClusterManagementAddOn in a version-neutral form. In v1alpha1 a
 * supported config without a default has no name; it is kept (name undefined) so the form can
 * still show the supported configuration type.
 */
export function defaultConfigs(addon: ClusterManagementAddOnJson): AddOnConfigRef[] {
  const spec = addon.spec || {};
  if (spec.defaultConfigs) {
    return spec.defaultConfigs.map(c => ({ ...c }));
  }
  return (spec.supportedConfigs || []).map(c => ({
    group: c.group,
    resource: c.resource,
    name: c.defaultConfig?.name,
    namespace: c.defaultConfig?.namespace,
  }));
}

/**
 * Writes version-neutral default configs into the spec shape of the addon's apiVersion.
 * v1beta1 requires a name for every entry, so entries without a name are dropped there.
 */
export function withDefaultConfigs(
  addon: ClusterManagementAddOnJson,
  configs: AddOnConfigRef[]
): ClusterManagementAddOnJson {
  const spec = { ...(addon.spec || {}) };
  delete spec.supportedConfigs;
  delete spec.defaultConfigs;
  if (isV1beta1(addon.apiVersion)) {
    const named = configs.filter(c => c.name);
    if (named.length > 0) {
      spec.defaultConfigs = named.map(c => clean({ ...c }));
    }
  } else if (configs.length > 0) {
    spec.supportedConfigs = configs.map(c =>
      clean({
        group: c.group,
        resource: c.resource,
        defaultConfig: c.name ? clean({ name: c.name, namespace: c.namespace }) : undefined,
      })
    );
  }
  return { ...addon, spec };
}

/**
 * Converts a ClusterManagementAddOn between v1alpha1 and v1beta1 (used when a document written
 * for one version is applied through the other).
 */
export function convertClusterManagementAddOn(
  addon: ClusterManagementAddOnJson,
  targetApiVersion: string
): ClusterManagementAddOnJson {
  const configs = defaultConfigs(addon);
  const spec = { ...(addon.spec || {}) };
  delete spec.addOnConfiguration;
  return withDefaultConfigs({ ...addon, apiVersion: targetApiVersion, spec }, configs);
}

export function addonDisplayName(addon: ClusterManagementAddOnJson): string {
  return addon.spec?.addOnMeta?.displayName || addon.metadata.name;
}

export function installStrategyType(addon: ClusterManagementAddOnJson): string {
  return addon.spec?.installStrategy?.type || 'Manual';
}

// ----- ManagedClusterAddOn -----

export interface ManagedClusterAddOnJson extends KubeJson {
  spec?: {
    configs?: AddOnConfigRef[];
    /** v1alpha1 only (deprecated). */
    installNamespace?: string;
  };
  status?: {
    conditions?: Condition[];
    namespace?: string;
    addOnMeta?: { displayName?: string; description?: string };
    configReferences?: Array<
      AddOnConfigRef & {
        desiredConfig?: { name?: string; namespace?: string; specHash?: string };
        lastAppliedConfig?: { name?: string; namespace?: string; specHash?: string };
      }
    >;
    healthCheck?: { mode?: string };
    registrations?: Array<{
      // v1alpha1
      signerName?: string;
      subject?: { user?: string; groups?: string[] };
      // v1beta1
      type?: string;
      kubeClient?: { driver?: string; subject?: { user?: string; groups?: string[] } };
      customSigner?: { signerName?: string; subject?: { user?: string; groups?: string[] } };
    }>;
    kubeClientDriver?: string;
  };
}

export type AddOnState = 'available' | 'degraded' | 'progressing' | 'unavailable' | 'unknown';

export function addonState(addon: ManagedClusterAddOnJson): AddOnState {
  const conditions = addon.status?.conditions;
  if (findCondition(conditions, 'Degraded')?.status === 'True') return 'degraded';
  const available = findCondition(conditions, 'Available');
  if (available?.status === 'True') return 'available';
  if (findCondition(conditions, 'Progressing')?.status === 'True') return 'progressing';
  if (available?.status === 'False') return 'unavailable';
  return 'unknown';
}

export const ADDON_STATE_HEALTH: Record<AddOnState, Health> = {
  available: 'success',
  degraded: 'error',
  progressing: 'unknown',
  unavailable: 'error',
  unknown: 'warning',
};

export const ADDON_STATE_LABEL: Record<AddOnState, string> = {
  available: 'Available',
  degraded: 'Degraded',
  progressing: 'Progressing',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

/** The managed cluster an add-on is installed on: add-ons live in the cluster namespace. */
export function addonCluster(addon: { metadata: { namespace?: string } }): string | undefined {
  return addon.metadata.namespace;
}

/**
 * Registrations in a version-neutral form: type and signer of each one. v1alpha1 only has a
 * signer name; the kube-apiserver client signer means a kubeClient registration.
 */
export function registrations(
  addon: ManagedClusterAddOnJson
): Array<{ type: string; signer?: string; user?: string; driver?: string }> {
  return (addon.status?.registrations || []).map(r => {
    if (r.type) {
      return {
        type: r.type,
        signer: r.customSigner?.signerName,
        user: r.kubeClient?.subject?.user || r.customSigner?.subject?.user,
        driver: r.kubeClient?.driver,
      };
    }
    const kubeClient = r.signerName === 'kubernetes.io/kube-apiserver-client';
    return {
      type: kubeClient ? 'kubeClient' : 'customSigner',
      signer: r.signerName,
      user: r.subject?.user,
      driver: addon.status?.kubeClientDriver,
    };
  });
}

/** Desired config reference of each configured type (name/namespace moved in v1beta1). */
export function configReferences(addon: ManagedClusterAddOnJson): AddOnConfigRef[] {
  return (addon.status?.configReferences || []).map(r => ({
    group: r.group,
    resource: r.resource,
    name: r.desiredConfig?.name ?? r.name,
    namespace: r.desiredConfig?.namespace ?? r.namespace,
  }));
}

/**
 * New ManagedClusterAddOn for enabling an add-on on a cluster. The install namespace is only
 * written for v1alpha1 (v1beta1 removed the field).
 */
export function newManagedClusterAddOn(
  apiVersion: string,
  addonName: string,
  cluster: string,
  installNamespace?: string
): ManagedClusterAddOnJson {
  const spec: ManagedClusterAddOnJson['spec'] = {};
  if (installNamespace && !isV1beta1(apiVersion)) spec.installNamespace = installNamespace;
  return {
    apiVersion,
    kind: 'ManagedClusterAddOn',
    metadata: { name: addonName, namespace: cluster },
    spec,
  };
}

export interface AddOnHealthSummary {
  name: string;
  displayName: string;
  total: number;
  available: number;
  degraded: number;
  other: number;
}

/** Per add-on health across all clusters (for the overview). */
export function addonHealthSummary(
  cmas: ClusterManagementAddOnJson[],
  mcas: ManagedClusterAddOnJson[]
): AddOnHealthSummary[] {
  const byName = new Map<string, AddOnHealthSummary>();
  for (const cma of cmas) {
    byName.set(cma.metadata.name, {
      name: cma.metadata.name,
      displayName: addonDisplayName(cma),
      total: 0,
      available: 0,
      degraded: 0,
      other: 0,
    });
  }
  for (const mca of mcas) {
    const name = mca.metadata.name;
    let entry = byName.get(name);
    if (!entry) {
      entry = { name, displayName: name, total: 0, available: 0, degraded: 0, other: 0 };
      byName.set(name, entry);
    }
    entry.total++;
    const state = addonState(mca);
    if (state === 'available') entry.available++;
    else if (state === 'degraded' || state === 'unavailable') entry.degraded++;
    else entry.other++;
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ----- AddOnDeploymentConfig / AddOnTemplate -----

export interface AddOnDeploymentConfigJson extends KubeJson {
  spec?: {
    agentInstallNamespace?: string;
    customizedVariables?: Array<{ name: string; value?: string }>;
    nodePlacement?: { nodeSelector?: Record<string, string>; tolerations?: unknown[] };
    proxyConfig?: { httpProxy?: string; httpsProxy?: string; noProxy?: string; caBundle?: string };
    registries?: Array<{ source?: string; mirror: string }>;
    resourceRequirements?: unknown[];
  };
}

export interface AddOnTemplateJson extends KubeJson {
  spec?: {
    addonName?: string;
    agentSpec?: { workload?: { manifests?: KubeJson[] } };
    registration?: Array<{ type: string }>;
  };
}

/** Removes undefined values (shallow). */
function clean<T extends object>(value: T): T {
  const out = { ...value } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === '') delete out[k];
  return out as T;
}
