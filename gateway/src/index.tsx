// Must come first: registers the bundled icons before anything renders.
import './common/icons';
import { Icon } from '@iconify/react';
import {
  registerKindIcon,
  registerMapSource,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import { withBoundary } from './common/ErrorBoundary';
import {
  GatewayClassDetail,
  GatewayClassList,
  GatewayDetail,
  GatewayList,
  ListenerSetDetail,
  ListenerSetList,
} from './components/kinds/infrastructure';
import {
  BackendTLSPolicyDetail,
  BackendTLSPolicyList,
  ReferenceGrantDetail,
  ReferenceGrantList,
} from './components/kinds/policies';
import {
  GRPCRouteDetail,
  GRPCRouteList,
  HTTPRouteDetail,
  HTTPRouteList,
  TCPRouteDetail,
  TCPRouteList,
  TLSRouteDetail,
  TLSRouteList,
  UDPRouteDetail,
  UDPRouteList,
} from './components/kinds/routes';
import { Overview } from './components/overview/Overview';
import { makeGatewayApiMapSource } from './components/topology/mapSource';
import { Topology } from './components/topology/Topology';
import {
  discoverAvailability,
  getCachedAvailability,
  onAvailabilityChange,
} from './discovery/discovery';
import { classOf } from './resources/classes';
import {
  BUILTIN_SIDEBAR_NAME,
  detailPath,
  GATEWAY_API_ICON,
  KindName,
  KINDS,
  listPath,
  SIDEBAR_ROOT,
  sidebarName,
  URL_PREFIX,
} from './resources/registry';

const OVERVIEW_SIDEBAR = 'gwapi-overview';
const OVERVIEW_PATH = `${URL_PREFIX}/overview`;
const TOPOLOGY_SIDEBAR = 'gwapi-topology';
const TOPOLOGY_PATH = `${URL_PREFIX}/topology`;

type Page = () => React.ReactNode;

const VIEWS: Record<KindName, { List: Page; Detail: Page }> = {
  GatewayClass: { List: GatewayClassList, Detail: GatewayClassDetail },
  Gateway: { List: GatewayList, Detail: GatewayDetail },
  ListenerSet: { List: ListenerSetList, Detail: ListenerSetDetail },
  HTTPRoute: { List: HTTPRouteList, Detail: HTTPRouteDetail },
  GRPCRoute: { List: GRPCRouteList, Detail: GRPCRouteDetail },
  TLSRoute: { List: TLSRouteList, Detail: TLSRouteDetail },
  TCPRoute: { List: TCPRouteList, Detail: TCPRouteDetail },
  UDPRoute: { List: UDPRouteList, Detail: UDPRouteDetail },
  ReferenceGrant: { List: ReferenceGrantList, Detail: ReferenceGrantDetail },
  BackendTLSPolicy: { List: BackendTLSPolicyList, Detail: BackendTLSPolicyDetail },
};

// ---------------------------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------------------------

type SidebarEntry = Parameters<typeof registerSidebarEntry>[0];

const rootEntry: SidebarEntry = {
  parent: null,
  name: SIDEBAR_ROOT,
  label: 'Gateway API',
  url: OVERVIEW_PATH,
  // Same icon as the built-in "Gateway (beta)" entry this plugin replaces.
  icon: GATEWAY_API_ICON,
};

registerSidebarEntry(rootEntry);
registerSidebarEntry({
  parent: SIDEBAR_ROOT,
  name: OVERVIEW_SIDEBAR,
  label: 'Overview',
  url: OVERVIEW_PATH,
});
registerSidebarEntry({
  parent: SIDEBAR_ROOT,
  name: TOPOLOGY_SIDEBAR,
  label: 'Topology',
  url: TOPOLOGY_PATH,
});

// One entry per kind, in registry order (infrastructure, routes, policies).
for (const info of KINDS) {
  registerSidebarEntry({
    parent: SIDEBAR_ROOT,
    name: sidebarName(info),
    label: info.labelPlural,
    url: listPath(info),
  });
}

const KIND_BY_SIDEBAR = new Map(KINDS.map(info => [sidebarName(info), info]));

registerSidebarEntryFilter(entry => {
  // Headlamp's own Gateway API menu is replaced by this plugin.
  if (entry.name === BUILTIN_SIDEBAR_NAME) return null;

  const info = KIND_BY_SIDEBAR.get(entry.name);
  const isTopology = entry.name === TOPOLOGY_SIDEBAR;
  if (!info && !isTopology) return entry;

  // Hide the kinds that are not installed in the current cluster. Discovery runs lazily; until it
  // completes every entry is shown (the pages themselves explain a missing CRD).
  const cluster = getCluster();
  const availability = getCachedAvailability(cluster);
  if (!availability) {
    if (cluster) discoverAvailability(cluster).catch(() => undefined);
    return entry;
  }
  // Without the Gateway API only the overview remains, which explains how to install it.
  if (!availability.installed) return null;
  if (isTopology) return entry;
  return availability.kinds[info!.kind] ? entry : null;
});

// The sidebar only re-evaluates its filters when the registered entries change, so re-register
// the root entry once discovery has completed to drop the entries of missing kinds.
onAvailabilityChange(() => registerSidebarEntry({ ...rootEntry }));

// ---------------------------------------------------------------------------------------------
// Resource map
// ---------------------------------------------------------------------------------------------

// Registered once, after discovery has shown that the kinds it adds are installed.
let mapSourceRegistered = false;
onAvailabilityChange(() => {
  if (mapSourceRegistered) return;
  const availability = getCachedAvailability(getCluster());
  const source = availability && makeGatewayApiMapSource(availability);
  if (!source) return;
  mapSourceRegistered = true;
  registerMapSource(source);
});

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

registerRoute({
  path: OVERVIEW_PATH,
  sidebar: OVERVIEW_SIDEBAR,
  name: 'Gateway API',
  exact: true,
  component: withBoundary(Overview),
});

registerRoute({
  path: TOPOLOGY_PATH,
  sidebar: TOPOLOGY_SIDEBAR,
  name: 'Gateway API Topology',
  exact: true,
  component: withBoundary(Topology),
});

for (const info of KINDS) {
  const views = VIEWS[info.kind];
  const cls = classOf(info.kind);
  const sidebar = sidebarName(info);
  const List = withBoundary(views.List);
  const Detail = withBoundary(views.Detail);

  // The paths equal those of Headlamp's built-in Gateway API pages where such pages exist. Plugin
  // routes take precedence, so every existing link (resource map, search, other plugins) opens
  // the pages of this plugin instead.
  registerRoute({
    path: listPath(info),
    sidebar,
    name: cls.listRoute,
    exact: true,
    component: List,
  });
  registerRoute({
    path: detailPath(info),
    sidebar,
    name: cls.detailsRoute,
    exact: true,
    component: Detail,
  });

  // Built-in paths that do not follow the `/plural/namespace/name` scheme.
  (info.aliasListPaths || []).forEach(path =>
    registerRoute({
      path,
      sidebar,
      name: cls.listRoute,
      exact: true,
      component: List,
    })
  );
  (info.aliasDetailPaths || []).forEach(path =>
    registerRoute({
      path,
      sidebar,
      name: cls.detailsRoute,
      exact: true,
      component: Detail,
    })
  );

  registerKindIcon(
    info.kind,
    { icon: <Icon icon={info.icon} width="70%" height="70%" /> },
    info.group
  );
}
