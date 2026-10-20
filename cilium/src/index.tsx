import './common/icons';
import { Icon } from '@iconify/react';
import {
  registerDetailsViewSection,
  registerKindIcon,
  registerMapSource,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import { discoverAvailability, getCachedAvailability, isAvailable } from './api/discovery';
import { withBoundary } from './common/ErrorBoundary';
import { registerResourceValidator } from './common/form/validation';
import { AdvancedPage, GenericResourceDetail } from './components/advanced/Advanced';
import {
  BGPAdvertisementDetail,
  BGPAdvertisementList,
  BGPClusterConfigDetail,
  BGPClusterConfigList,
  BGPNodeConfigDetail,
  BGPNodeConfigList,
  BGPNodeConfigOverrideDetail,
  BGPNodeConfigOverrideList,
  BGPPeerConfigDetail,
  BGPPeerConfigList,
  BGPPeeringPolicyDetail,
  BGPPeeringPolicyList,
} from './components/bgp/Views';
import { GroupPage } from './components/common/Views';
import {
  EgressGatewayPolicyDetail,
  EgressGatewayPolicyList,
  LocalRedirectPolicyDetail,
  LocalRedirectPolicyList,
} from './components/egress/Views';
import {
  EndpointDetail,
  EndpointSliceDetail,
  IdentityDetail,
} from './components/endpoints/Details';
import { EndpointList, EndpointSliceList, IdentityList } from './components/endpoints/Lists';
import {
  ClusterwideEnvoyConfigDetail,
  ClusterwideEnvoyConfigList,
  EnvoyConfigDetail,
  EnvoyConfigList,
} from './components/envoy/Views';
import {
  L2AnnouncementPolicyDetail,
  L2AnnouncementPolicyList,
  LBIPPoolDetail,
  LBIPPoolList,
  PodIPPoolDetail,
  PodIPPoolList,
} from './components/lb/Views';
import {
  CiliumNodeDetail,
  CiliumNodeList,
  NodeConfigDetail,
  NodeConfigList,
} from './components/nodes/Views';
import { Overview } from './components/overview/Overview';
import {
  CIDRGroupDetail,
  ClusterwideNetworkPolicyDetail,
  NetworkPolicyDetail,
} from './components/policies/Details';
import {
  CIDRGroupList,
  ClusterwideNetworkPolicyList,
  NetworkPolicyList,
} from './components/policies/Lists';
import { ciliumIcon } from './icons/ciliumIcon';
import { ciliumMapSource } from './integrations/mapSource';
import { CiliumNativeSection } from './integrations/NativeSections';
import {
  CRDS,
  crdsOfGroup,
  detailPath,
  GroupId,
  groupPath,
  groupRouteName,
  GROUPS,
  SIDEBAR_ROOT,
  URL_PREFIX,
} from './resources/registry';
import { API_GROUP } from './resources/types';
import { ADVANCED_ROUTE, GENERIC_DETAIL_ROUTE, OVERVIEW_ROUTE } from './routes';
import { validateResource } from './utils/validation';

registerResourceValidator(validateResource);

const VIEWS: Record<string, { List: React.ComponentType; Detail: React.ComponentType }> = {
  CiliumNetworkPolicy: { List: NetworkPolicyList, Detail: NetworkPolicyDetail },
  CiliumClusterwideNetworkPolicy: {
    List: ClusterwideNetworkPolicyList,
    Detail: ClusterwideNetworkPolicyDetail,
  },
  CiliumCIDRGroup: { List: CIDRGroupList, Detail: CIDRGroupDetail },
  CiliumEndpoint: { List: EndpointList, Detail: EndpointDetail },
  CiliumEndpointSlice: { List: EndpointSliceList, Detail: EndpointSliceDetail },
  CiliumIdentity: { List: IdentityList, Detail: IdentityDetail },
  CiliumNode: { List: CiliumNodeList, Detail: CiliumNodeDetail },
  CiliumNodeConfig: { List: NodeConfigList, Detail: NodeConfigDetail },
  CiliumBGPClusterConfig: { List: BGPClusterConfigList, Detail: BGPClusterConfigDetail },
  CiliumBGPPeerConfig: { List: BGPPeerConfigList, Detail: BGPPeerConfigDetail },
  CiliumBGPAdvertisement: { List: BGPAdvertisementList, Detail: BGPAdvertisementDetail },
  CiliumBGPNodeConfig: { List: BGPNodeConfigList, Detail: BGPNodeConfigDetail },
  CiliumBGPNodeConfigOverride: {
    List: BGPNodeConfigOverrideList,
    Detail: BGPNodeConfigOverrideDetail,
  },
  CiliumBGPPeeringPolicy: { List: BGPPeeringPolicyList, Detail: BGPPeeringPolicyDetail },
  CiliumLoadBalancerIPPool: { List: LBIPPoolList, Detail: LBIPPoolDetail },
  CiliumL2AnnouncementPolicy: {
    List: L2AnnouncementPolicyList,
    Detail: L2AnnouncementPolicyDetail,
  },
  CiliumPodIPPool: { List: PodIPPoolList, Detail: PodIPPoolDetail },
  CiliumEgressGatewayPolicy: { List: EgressGatewayPolicyList, Detail: EgressGatewayPolicyDetail },
  CiliumLocalRedirectPolicy: { List: LocalRedirectPolicyList, Detail: LocalRedirectPolicyDetail },
  CiliumEnvoyConfig: { List: EnvoyConfigList, Detail: EnvoyConfigDetail },
  CiliumClusterwideEnvoyConfig: {
    List: ClusterwideEnvoyConfigList,
    Detail: ClusterwideEnvoyConfigDetail,
  },
};

const OVERVIEW_SIDEBAR = `${SIDEBAR_ROOT}-overview`;
const ADVANCED_SIDEBAR = `${SIDEBAR_ROOT}-advanced`;

// Main sidebar group, opening the overview.
registerSidebarEntry({
  parent: null,
  name: SIDEBAR_ROOT,
  label: 'Cilium',
  url: `${URL_PREFIX}/overview`,
  icon: ciliumIcon,
});

registerSidebarEntry({
  parent: SIDEBAR_ROOT,
  name: OVERVIEW_SIDEBAR,
  label: 'Overview',
  url: `${URL_PREFIX}/overview`,
});

registerRoute({
  path: `${URL_PREFIX}/overview`,
  sidebar: OVERVIEW_SIDEBAR,
  name: OVERVIEW_ROUTE,
  exact: true,
  component: withBoundary(Overview),
});

function groupLists(group: GroupId): Record<string, React.ComponentType> {
  const lists: Record<string, React.ComponentType> = {};
  for (const info of crdsOfGroup(group)) lists[info.kind] = VIEWS[info.kind].List;
  return lists;
}

for (const group of GROUPS) {
  const name = groupRouteName(group.id);
  const lists = groupLists(group.id);
  const Page = () => <GroupPage group={group.id} lists={lists} />;

  registerSidebarEntry({
    parent: SIDEBAR_ROOT,
    name,
    label: group.label,
    url: groupPath(group.id),
  });

  // One route per group; the optional segment selects the tab (the CRD) inside the page.
  registerRoute({
    path: `${groupPath(group.id)}/:plural?`,
    sidebar: name,
    name,
    exact: true,
    component: withBoundary(Page),
  });
}

for (const info of CRDS) {
  registerRoute({
    path: detailPath(info),
    sidebar: groupRouteName(info.group),
    name: info.cls.detailsRoute,
    exact: true,
    component: withBoundary(VIEWS[info.kind].Detail),
  });

  registerKindIcon(
    info.kind,
    { icon: <Icon icon={ciliumIcon} width="100%" height="100%" /> },
    API_GROUP
  );
}

registerSidebarEntry({
  parent: SIDEBAR_ROOT,
  name: ADVANCED_SIDEBAR,
  label: 'Advanced',
  url: `${URL_PREFIX}/advanced`,
});

registerRoute({
  path: `${URL_PREFIX}/advanced/:plural?`,
  sidebar: ADVANCED_SIDEBAR,
  name: ADVANCED_ROUTE,
  exact: true,
  component: withBoundary(AdvancedPage),
});

// Detail page for cilium.io kinds without dedicated views (namespace "-" = cluster-scoped).
registerRoute({
  path: `${URL_PREFIX}/advanced/:plural/:namespace/:name`,
  sidebar: ADVANCED_SIDEBAR,
  name: GENERIC_DETAIL_ROUTE,
  exact: true,
  component: withBoundary(GenericResourceDetail),
});

// Hide the groups whose CRDs are all missing in the current cluster. Discovery runs lazily;
// until it completes every entry is shown (the pages themselves explain a missing CRD).
const GROUP_BY_ENTRY = new Map(GROUPS.map(group => [groupRouteName(group.id), group.id]));
registerSidebarEntryFilter(entry => {
  const group = GROUP_BY_ENTRY.get(entry.name);
  if (!group) return entry;
  const cluster = getCluster();
  const availability = getCachedAvailability(cluster);
  if (!availability) {
    if (cluster) discoverAvailability(cluster).catch(() => undefined);
    return entry;
  }
  if (!availability.groupInstalled) return entry;
  return crdsOfGroup(group).some(info => isAvailable(availability, info.plural)) ? entry : null;
});

// Cilium details on Headlamp's own Pod, Namespace, Node and Service pages.
registerDetailsViewSection(({ resource }) => <CiliumNativeSection resource={resource} />);

registerMapSource(ciliumMapSource);
