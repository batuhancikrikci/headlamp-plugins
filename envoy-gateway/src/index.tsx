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
import { withBoundary } from './common/ErrorBoundary';
import { registerResourceValidator } from './common/form/validation';
import { BackendDetail } from './components/backend/Detail';
import { BackendList } from './components/backend/List';
import { BackendTrafficPolicyDetail } from './components/backendTrafficPolicy/Detail';
import { BackendTrafficPolicyList } from './components/backendTrafficPolicy/List';
import { ClientTrafficPolicyDetail } from './components/clientTrafficPolicy/Detail';
import { ClientTrafficPolicyList } from './components/clientTrafficPolicy/List';
import { EnvoyExtensionPolicyDetail } from './components/envoyExtensionPolicy/Detail';
import { EnvoyExtensionPolicyList } from './components/envoyExtensionPolicy/List';
import { EnvoyPatchPolicyDetail } from './components/envoyPatchPolicy/Detail';
import { EnvoyPatchPolicyList } from './components/envoyPatchPolicy/List';
import { EnvoyProxyDetail } from './components/envoyProxy/Detail';
import { EnvoyProxyList } from './components/envoyProxy/List';
import { HTTPRouteFilterDetail } from './components/httpRouteFilter/Detail';
import { HTTPRouteFilterList } from './components/httpRouteFilter/List';
import { EnvoyGatewayOverview } from './components/overview/Overview';
import { EnvoyGatewayAttachmentsSection } from './components/relations/AttachedResources';
import { envoyGatewayMapSource } from './components/relations/mapSource';
import { SecurityPolicyDetail } from './components/securityPolicy/Detail';
import { SecurityPolicyList } from './components/securityPolicy/List';
import { envoyGatewayIcon } from './icons/envoyGatewayIcon';
import { CRDS, listPath, listRouteName, SIDEBAR_ROOT, URL_PREFIX } from './resources/registry';
import { API_GROUP } from './resources/types';
import { validateResource } from './utils/validation';
import { discoverAvailability, getCachedAvailability, isAvailable } from './utils/versionDiscovery';

registerResourceValidator(validateResource);

const OVERVIEW_SIDEBAR = 'eg-overview';

const VIEWS: Record<string, { List: React.ComponentType; Detail: React.ComponentType }> = {
  EnvoyProxy: { List: EnvoyProxyList, Detail: EnvoyProxyDetail },
  ClientTrafficPolicy: { List: ClientTrafficPolicyList, Detail: ClientTrafficPolicyDetail },
  BackendTrafficPolicy: { List: BackendTrafficPolicyList, Detail: BackendTrafficPolicyDetail },
  SecurityPolicy: { List: SecurityPolicyList, Detail: SecurityPolicyDetail },
  EnvoyExtensionPolicy: { List: EnvoyExtensionPolicyList, Detail: EnvoyExtensionPolicyDetail },
  EnvoyPatchPolicy: { List: EnvoyPatchPolicyList, Detail: EnvoyPatchPolicyDetail },
  Backend: { List: BackendList, Detail: BackendDetail },
  HTTPRouteFilter: { List: HTTPRouteFilterList, Detail: HTTPRouteFilterDetail },
};

// Main sidebar group, opening the overview.
registerSidebarEntry({
  parent: null,
  name: SIDEBAR_ROOT,
  label: 'Envoy Gateway',
  url: `${URL_PREFIX}/overview`,
  icon: envoyGatewayIcon,
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
  name: 'eg-overview',
  exact: true,
  component: withBoundary(EnvoyGatewayOverview),
});

for (const crd of CRDS) {
  const views = VIEWS[crd.kind];
  const sidebarName = listRouteName(crd.plural);

  registerSidebarEntry({
    parent: SIDEBAR_ROOT,
    name: sidebarName,
    label: crd.kind,
    url: listPath(crd.plural),
  });

  registerRoute({
    path: listPath(crd.plural),
    sidebar: sidebarName,
    name: sidebarName,
    exact: true,
    component: withBoundary(views.List),
  });

  registerRoute({
    path: `${listPath(crd.plural)}/:namespace/:name`,
    sidebar: sidebarName,
    name: crd.cls.detailsRoute,
    exact: true,
    component: withBoundary(views.Detail),
  });

  registerKindIcon(
    crd.kind,
    { icon: <Icon icon={envoyGatewayIcon} width="100%" height="100%" /> },
    API_GROUP
  );
}

// Hide the entries of CRDs that are not installed in the current cluster. Discovery runs lazily;
// until it completes every entry is shown (the pages themselves explain a missing CRD).
registerSidebarEntryFilter(entry => {
  if (!entry.name.startsWith('eg-') || entry.name === OVERVIEW_SIDEBAR) return entry;
  const cluster = getCluster();
  const availability = getCachedAvailability(cluster);
  if (!availability) {
    if (cluster) discoverAvailability(cluster).catch(() => undefined);
    return entry;
  }
  const plural = entry.name.slice('eg-'.length);
  return !availability.groupInstalled || isAvailable(availability, plural) ? entry : null;
});

// Envoy Gateway policies and extensions on Gateway, GatewayClass, HTTPRoute and GRPCRoute pages.
registerDetailsViewSection(({ resource }) => (
  <EnvoyGatewayAttachmentsSection resource={resource} />
));

registerMapSource(envoyGatewayMapSource);
