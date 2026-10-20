/**
 * List and detail views per kind.
 */
import React from 'react';
import * as Addons from './addons/Views';
import * as Apps from './applications/Views';
import * as Argo from './argocd/Views';
import * as Clusters from './clusters/Views';
import * as Sets from './clustersets/Views';
import * as GitOps from './gitops/Views';
import * as Gov from './governance/Views';
import * as Placements from './placements/Views';
import * as Settings from './settings/Views';
import * as Workloads from './workloads/Views';

export interface KindViews {
  List: React.ComponentType;
  Detail: React.ComponentType;
}

const VIEWS: Record<string, KindViews> = {
  ManagedCluster: { List: Clusters.ManagedClusterList, Detail: Clusters.ManagedClusterDetail },
  CertificateSigningRequest: { List: Clusters.CSRList, Detail: Clusters.CSRDetail },
  ClusterProfile: { List: Clusters.ClusterProfileList, Detail: Clusters.ClusterProfileDetail },
  ManagedClusterSet: { List: Sets.ManagedClusterSetList, Detail: Sets.ManagedClusterSetDetail },
  ManagedClusterSetBinding: {
    List: Sets.ManagedClusterSetBindingList,
    Detail: Sets.ManagedClusterSetBindingDetail,
  },
  Placement: { List: Placements.PlacementList, Detail: Placements.PlacementDetail },
  PlacementDecision: {
    List: Placements.PlacementDecisionList,
    Detail: Placements.PlacementDecisionDetail,
  },
  AddOnPlacementScore: {
    List: Placements.AddOnPlacementScoreList,
    Detail: Placements.AddOnPlacementScoreDetail,
  },
  PlacementRule: { List: Placements.PlacementRuleList, Detail: Placements.PlacementRuleDetail },
  ManifestWork: { List: Workloads.ManifestWorkList, Detail: Workloads.ManifestWorkDetail },
  ManifestWorkReplicaSet: {
    List: Workloads.ManifestWorkReplicaSetList,
    Detail: Workloads.ManifestWorkReplicaSetDetail,
  },
  Subscription: { List: Apps.SubscriptionList, Detail: Apps.SubscriptionDetail },
  Channel: { List: Apps.ChannelList, Detail: Apps.ChannelDetail },
  Application: { List: Argo.ArgoApplicationList, Detail: Argo.ArgoApplicationDetail },
  ApplicationSet: { List: Argo.ApplicationSetList, Detail: Argo.ApplicationSetDetail },
  AppProject: { List: Argo.AppProjectList, Detail: Argo.AppProjectDetail },
  HelmRelease: { List: Apps.HelmReleaseList, Detail: Apps.HelmReleaseDetail },
  SubscriptionReport: { List: Apps.SubscriptionReportList, Detail: Apps.SubscriptionReportDetail },
  SubscriptionStatus: { List: Apps.SubscriptionStatusList, Detail: Apps.SubscriptionStatusDetail },
  GitOpsCluster: { List: GitOps.GitOpsClusterList, Detail: GitOps.GitOpsClusterDetail },
  MulticlusterApplicationSetReport: {
    List: GitOps.AppSetReportList,
    Detail: GitOps.AppSetReportDetail,
  },
  ManagedServiceAccount: {
    List: GitOps.ManagedServiceAccountList,
    Detail: GitOps.ManagedServiceAccountDetail,
  },
  ClusterPermission: { List: GitOps.ClusterPermissionList, Detail: GitOps.ClusterPermissionDetail },
  Policy: { List: Gov.PolicyList, Detail: Gov.PolicyDetail },
  PolicySet: { List: Gov.PolicySetList, Detail: Gov.PolicySetDetail },
  PlacementBinding: { List: Gov.PlacementBindingList, Detail: Gov.PlacementBindingDetail },
  PolicyAutomation: { List: Gov.PolicyAutomationList, Detail: Gov.PolicyAutomationDetail },
  ConfigurationPolicy: { List: Gov.ConfigurationPolicyList, Detail: Gov.ConfigurationPolicyDetail },
  OperatorPolicy: { List: Gov.OperatorPolicyList, Detail: Gov.OperatorPolicyDetail },
  ClusterManagementAddOn: {
    List: Addons.ClusterManagementAddOnList,
    Detail: Addons.ClusterManagementAddOnDetail,
  },
  ManagedClusterAddOn: {
    List: Addons.ManagedClusterAddOnList,
    Detail: Addons.ManagedClusterAddOnDetail,
  },
  AddOnDeploymentConfig: {
    List: Addons.AddOnDeploymentConfigList,
    Detail: Addons.AddOnDeploymentConfigDetail,
  },
  AddOnTemplate: { List: Addons.AddOnTemplateList, Detail: Addons.AddOnTemplateDetail },
  ClusterManager: { List: Settings.ClusterManagerList, Detail: Settings.ClusterManagerDetail },
  Klusterlet: { List: Settings.KlusterletList, Detail: Settings.KlusterletDetail },
  ClusterClaim: { List: Settings.ClusterClaimList, Detail: Settings.ClusterClaimDetail },
  ClusterProperty: { List: Settings.ClusterPropertyList, Detail: Settings.ClusterPropertyDetail },
  AppliedManifestWork: {
    List: Settings.AppliedManifestWorkList,
    Detail: Settings.AppliedManifestWorkDetail,
  },
};

export function viewsOf(kind: string): KindViews {
  const views = VIEWS[kind];
  if (!views) throw new Error(`No views for ${kind}`);
  return views;
}

/** Tabs that are not a CRD list, per section (shown after the kind tabs). */
export interface ExtraTab {
  id: string;
  label: string;
  icon: string;
  /** Kind that must be available for the tab to be enabled. */
  requires: string;
  Component: React.ComponentType;
}

export const EXTRA_TABS: Record<string, ExtraTab[]> = {
  gitops: [
    {
      id: 'argocd-clusters',
      label: 'Argo CD clusters',
      icon: 'mdi:server-network',
      requires: 'Application',
      Component: Argo.ArgoClustersTab,
    },
  ],
};
