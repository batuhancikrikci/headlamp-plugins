import {
  BGPAdvertisementForm,
  BGPClusterConfigForm,
  BGPNodeConfigOverrideForm,
  BGPPeerConfigForm,
} from './bgp/Forms';
import { BGPSetupWizard } from './bgp/SetupWizard';
import { EditingConfig, SetupWizard } from './common/form/EditActions';
import {
  EgressGatewayPolicyForm,
  EgressGatewayPolicyWizard,
  LocalRedirectPolicyForm,
} from './egress/Forms';
import { EnvoyConfigForm } from './envoy/Forms';
import { L2AnnouncementPolicyForm, LBIPPoolForm, PodIPPoolForm } from './lb/Forms';
import { LBSetupWizard } from './lb/SetupWizard';
import { NodeConfigForm } from './nodes/Forms';
import { CIDRGroupForm } from './policies/CIDRGroupForm';
import { NetworkPolicyForm, NetworkPolicyWizard } from './policies/Forms';

export const BGP_SETUP: SetupWizard = {
  id: 'bgp-setup',
  label: 'BGP setup wizard',
  icon: 'mdi:router-network',
  Dialog: BGPSetupWizard,
};

export const LB_SETUP: SetupWizard = {
  id: 'lb-setup',
  label: 'IP pool + L2 announcement wizard',
  icon: 'mdi:ip-network-outline',
  Dialog: LBSetupWizard,
};

/**
 * Guided editors per kind. Wizards are only provided where the configuration is complex enough
 * to benefit from a step-by-step flow; every writable kind can also be created from YAML.
 * Runtime kinds (endpoints, identities, nodes, BGP node configs) have no entry: they are
 * written by Cilium itself.
 */
export const EDITING: Record<string, EditingConfig> = {
  CiliumNetworkPolicy: { Form: NetworkPolicyForm, Wizard: NetworkPolicyWizard },
  CiliumClusterwideNetworkPolicy: { Form: NetworkPolicyForm, Wizard: NetworkPolicyWizard },
  CiliumCIDRGroup: { Form: CIDRGroupForm },
  CiliumNodeConfig: { Form: NodeConfigForm },
  CiliumBGPClusterConfig: { Form: BGPClusterConfigForm, setupWizards: [BGP_SETUP] },
  CiliumBGPPeerConfig: { Form: BGPPeerConfigForm, setupWizards: [BGP_SETUP] },
  CiliumBGPAdvertisement: { Form: BGPAdvertisementForm, setupWizards: [BGP_SETUP] },
  CiliumBGPNodeConfigOverride: { Form: BGPNodeConfigOverrideForm },
  CiliumLoadBalancerIPPool: { Form: LBIPPoolForm, setupWizards: [LB_SETUP] },
  CiliumL2AnnouncementPolicy: { Form: L2AnnouncementPolicyForm, setupWizards: [LB_SETUP] },
  CiliumPodIPPool: { Form: PodIPPoolForm },
  CiliumEgressGatewayPolicy: { Form: EgressGatewayPolicyForm, Wizard: EgressGatewayPolicyWizard },
  CiliumLocalRedirectPolicy: { Form: LocalRedirectPolicyForm },
  CiliumEnvoyConfig: { Form: EnvoyConfigForm },
  CiliumClusterwideEnvoyConfig: { Form: EnvoyConfigForm },
};
