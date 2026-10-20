import './common/icons';
import { Icon } from '@iconify/react';
import {
  registerKindIcon,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import React from 'react';
import { discoverAvailability, getCachedAvailability, isKindAvailable } from './api/discovery';
import { withBoundary } from './common/ErrorBoundary';
import { registerResourceValidator } from './common/form/validation';
import { SectionPage } from './components/common/Views';
import { Overview } from './components/overview/Overview';
import { EXTRA_TABS, viewsOf } from './components/views';
import { hubIcon } from './icons/hubIcon';
import {
  CRDS,
  crdsOfSection,
  detailPath,
  sectionPath,
  sectionRouteName,
  SECTIONS,
} from './resources/registry';
import { OVERVIEW_ROUTE, SIDEBAR_ROOT, URL_PREFIX } from './routes';
import { validateResource } from './utils/validation';

registerResourceValidator(validateResource);

const OVERVIEW_SIDEBAR = `${SIDEBAR_ROOT}-overview`;

registerSidebarEntry({
  parent: null,
  name: SIDEBAR_ROOT,
  label: 'Multicluster Hub',
  url: `${URL_PREFIX}/overview`,
  icon: hubIcon,
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

for (const section of SECTIONS) {
  const name = sectionRouteName(section.id);
  const lists: Record<string, React.ComponentType> = {};
  for (const info of crdsOfSection(section.id)) lists[info.kind] = viewsOf(info.kind).List;
  const Page = () => (
    <SectionPage section={section.id} lists={lists} extraTabs={EXTRA_TABS[section.id]} />
  );

  registerSidebarEntry({
    parent: SIDEBAR_ROOT,
    name,
    label: section.label,
    url: sectionPath(section.id),
  });

  // One route per section; the optional segment selects the tab (the kind) inside the page.
  registerRoute({
    path: `${sectionPath(section.id)}/:plural?`,
    sidebar: name,
    name,
    exact: true,
    component: withBoundary(Page),
  });
}

for (const info of CRDS) {
  registerRoute({
    path: detailPath(info),
    sidebar: sectionRouteName(info.section),
    name: info.cls.detailsRoute,
    exact: true,
    component: withBoundary(viewsOf(info.kind).Detail),
  });
  // Core and Argo CD kinds keep their own icons.
  if (info.group !== 'certificates.k8s.io' && info.group !== 'argoproj.io') {
    registerKindIcon(
      info.kind,
      { icon: <Icon icon={hubIcon} width="100%" height="100%" /> },
      info.group
    );
  }
}

// Hide the sections whose kinds are all missing in the current cluster. Discovery runs lazily;
// until it completes every entry is shown (the pages themselves explain a missing CRD).
const SECTION_BY_ENTRY = new Map(SECTIONS.map(s => [sectionRouteName(s.id), s.id]));
registerSidebarEntryFilter(entry => {
  const section = SECTION_BY_ENTRY.get(entry.name);
  if (!section) return entry;
  const cluster = getCluster();
  const availability = getCachedAvailability(cluster);
  if (!availability) {
    if (cluster) discoverAvailability(cluster).catch(() => undefined);
    return entry;
  }
  const kinds = crdsOfSection(section).filter(c => c.group !== 'certificates.k8s.io');
  return kinds.some(info => isKindAvailable(availability, info)) ? entry : null;
});
