import React from 'react';
import {
  AddOnDeploymentConfigForm,
  ClusterManagementAddOnForm,
  ManagedClusterAddOnForm,
} from './addons/Forms';
import { ChannelForm, SubscriptionForm } from './applications/Forms';
import { ApplicationSetForm, AppProjectForm } from './argocd/Forms';
import {
  ManagedClusterForm,
  ManagedClusterSetBindingForm,
  ManagedClusterSetForm,
  ValueForm,
} from './clusters/Forms';
import { EditingConfig, WizardLauncher } from './common/form/EditActions';
import { GitOpsClusterForm, ManagedServiceAccountForm } from './gitops/Forms';
import {
  PlacementBindingForm,
  PolicyAutomationForm,
  PolicyForm,
  PolicySetForm,
} from './governance/Forms';
import { PlacementForm, PlacementRuleForm } from './placements/Forms';
import { ClusterManagerForm } from './settings/Forms';
import { ArgoDeployWizard } from './wizards/ArgoDeployWizard';
import { DeployAppWizard } from './wizards/DeployAppWizard';
import { DistributeWorkWizard } from './wizards/DistributeWorkWizard';
import { GitOpsWizard } from './wizards/GitOpsWizard';
import { ImportClusterWizard } from './wizards/ImportClusterWizard';
import { PlacementWizard } from './wizards/PlacementWizard';
import { PolicyWizard } from './wizards/PolicyWizard';
import { ManifestWorkForm, ManifestWorkReplicaSetForm } from './workloads/Forms';

const IMPORT_CLUSTER: WizardLauncher = {
  id: 'import-cluster',
  label: 'Import cluster',
  icon: 'mdi:server-plus',
  Dialog: ImportClusterWizard,
};
const CREATE_PLACEMENT: WizardLauncher = {
  id: 'create-placement',
  label: 'Placement wizard',
  icon: 'mdi:wizard-hat',
  Dialog: PlacementWizard,
};
const DEPLOY_APP: WizardLauncher = {
  id: 'deploy-app',
  label: 'Deploy application',
  icon: 'mdi:rocket-launch-outline',
  Dialog: DeployAppWizard,
};
const CONFIGURE_GITOPS: WizardLauncher = {
  id: 'configure-gitops',
  label: 'Configure GitOps',
  icon: 'mdi:source-branch-sync',
  Dialog: GitOpsWizard,
};
const ARGO_DEPLOY: WizardLauncher = {
  id: 'argo-deploy',
  label: 'Deploy with Argo CD',
  icon: 'mdi:rocket-launch',
  Dialog: ArgoDeployWizard,
};
const CREATE_POLICY: WizardLauncher = {
  id: 'create-policy',
  label: 'Policy wizard',
  icon: 'mdi:shield-plus-outline',
  Dialog: PolicyWizard,
};
const DISTRIBUTE_WORK: WizardLauncher = {
  id: 'distribute-work',
  label: 'Distribute workload',
  icon: 'mdi:package-variant-plus',
  Dialog: DistributeWorkWizard,
};

/**
 * Guided editors per kind: a form (create and edit) and the wizards offered from the create
 * menu. Every writable kind can also be created and edited as YAML; kinds without an entry
 * (ClusterPermission, AddOnTemplate, Klusterlet) are YAML only.
 */
export const EDITING: Record<string, EditingConfig> = {
  ManagedCluster: { Form: ManagedClusterForm, wizards: [IMPORT_CLUSTER] },
  ManagedClusterSet: { Form: ManagedClusterSetForm },
  ManagedClusterSetBinding: { Form: ManagedClusterSetBindingForm },
  ClusterClaim: { Form: ValueForm },
  ClusterProperty: { Form: ValueForm },
  Placement: { Form: PlacementForm, wizards: [CREATE_PLACEMENT] },
  PlacementRule: { Form: PlacementRuleForm },
  ManifestWork: { Form: ManifestWorkForm, wizards: [DISTRIBUTE_WORK] },
  ManifestWorkReplicaSet: { Form: ManifestWorkReplicaSetForm, wizards: [DISTRIBUTE_WORK] },
  Subscription: { Form: SubscriptionForm, wizards: [DEPLOY_APP] },
  Channel: { Form: ChannelForm, wizards: [DEPLOY_APP] },
  GitOpsCluster: { Form: GitOpsClusterForm, wizards: [CONFIGURE_GITOPS, ARGO_DEPLOY] },
  ApplicationSet: { Form: ApplicationSetForm, wizards: [ARGO_DEPLOY] },
  AppProject: { Form: AppProjectForm },
  Policy: { Form: PolicyForm, wizards: [CREATE_POLICY] },
  PolicySet: { Form: PolicySetForm },
  PlacementBinding: { Form: PlacementBindingForm },
  PolicyAutomation: { Form: PolicyAutomationForm },
  Application: { wizards: [ARGO_DEPLOY] },
  ManagedServiceAccount: { Form: ManagedServiceAccountForm },
  ClusterManagementAddOn: { Form: ClusterManagementAddOnForm },
  ManagedClusterAddOn: { Form: ManagedClusterAddOnForm },
  AddOnDeploymentConfig: { Form: AddOnDeploymentConfigForm },
  ClusterManager: { Form: ClusterManagerForm },
};

/** A multi-resource workflow shown on the overview. */
export interface GuidedFlow {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Kinds that must be available for the flow to be offered. */
  requires: string[];
  Dialog: React.ComponentType<{ open: boolean; onClose: () => void }>;
}

export const GUIDED_FLOWS: GuidedFlow[] = [
  {
    ...IMPORT_CLUSTER,
    label: 'Import a cluster',
    description: 'Register a cluster, assign a set and enable add-ons',
    requires: ['ManagedCluster'],
  },
  {
    ...CREATE_PLACEMENT,
    label: 'Create a placement',
    description: 'Select clusters by set, labels and claims',
    requires: ['Placement', 'ManagedClusterSetBinding'],
  },
  {
    ...DISTRIBUTE_WORK,
    label: 'Distribute a workload',
    description: 'Send manifests to clusters with ManifestWorks',
    requires: ['ManifestWork'],
  },
  {
    ...DEPLOY_APP,
    label: 'Deploy an application',
    description: 'Channel → Subscription → Placement',
    requires: ['Subscription', 'Channel', 'Placement'],
  },
  {
    ...CREATE_POLICY,
    label: 'Create a policy',
    description: 'Configuration or operator policy → placement → binding',
    requires: ['Policy', 'PlacementBinding', 'Placement'],
  },
  {
    ...ARGO_DEPLOY,
    label: 'Deploy with Argo CD',
    description: 'Placement → GitOpsCluster → ApplicationSet (push or pull)',
    requires: ['ApplicationSet', 'GitOpsCluster', 'Placement'],
  },
  {
    ...CONFIGURE_GITOPS,
    label: 'Configure GitOps',
    description: 'Register clusters of a placement in Argo CD',
    requires: ['GitOpsCluster', 'Placement'],
  },
];
