import './common/icons';
import {
  registerDetailsViewSection,
  registerPluginSettings,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { registerKindDocs } from './common/docs/kindDocs';
import { ErrorBoundary, withBoundary } from './common/ErrorBoundary';
import { KIND_DOCS } from './components/docs/kindDocs';
import { INFERENCE_HUB_ICON } from './icons';
import { NodeGpuSection } from './integrations/NodeGpuSection';
import { PodAiSection } from './integrations/PodAiSection';
import { CatalogEntryPage } from './pages/catalog/CatalogEntryPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { CommandCenter } from './pages/commandCenter/CommandCenter';
import { EndpointDetailPage } from './pages/endpoints/EndpointDetailPage';
import { EndpointsPage } from './pages/endpoints/EndpointsPage';
import { VllmEnginesPage } from './pages/engines/VllmEnginesPage';
import { InferenceGatewayPage } from './pages/gateway/InferenceGatewayPage';
import { GpuFleetPage } from './pages/gpuFleet/GpuFleetPage';
import { PlaygroundPage } from './pages/playground/PlaygroundPage';
import { ProfileDetailPage } from './pages/profiles/ProfileDetailPage';
import { ProfilesPage } from './pages/profiles/ProfilesPage';
import { PluginSettingsPanel, SettingsPage } from './pages/settings/SettingsPage';
import { ModelStoragePage } from './pages/storage/ModelStoragePage';
import { DETAIL_PAGES, PAGES, SIDEBAR_ROOT } from './routes';
import { PLUGIN_NAME } from './settings/settings';
import { DeployWizardPage } from './wizards/deploy/DeployWizardPage';

registerKindDocs(KIND_DOCS);

interface PageRegistration {
  page: { name: string; path: string };
  label: string;
  icon: string;
  component: React.ComponentType;
}

/** Sidebar order of the Inference Hub product pages. */
const SIDEBAR_PAGES: PageRegistration[] = [
  {
    page: PAGES.commandCenter,
    label: 'Command Center',
    icon: 'mdi:view-dashboard-outline',
    component: CommandCenter,
  },
  {
    page: PAGES.catalog,
    label: 'Model Catalog',
    icon: 'mdi:bookshelf',
    component: CatalogPage,
  },
  {
    page: PAGES.endpoints,
    label: 'Model Endpoints',
    icon: 'mdi:api',
    component: EndpointsPage,
  },
  {
    page: PAGES.playground,
    label: 'Playground',
    icon: 'mdi:chat-processing-outline',
    component: PlaygroundPage,
  },
  {
    page: PAGES.gateway,
    label: 'Inference Gateway',
    icon: 'mdi:scale-balance',
    component: InferenceGatewayPage,
  },
  {
    page: PAGES.profiles,
    label: 'Serving Profiles',
    icon: 'mdi:tune-variant',
    component: ProfilesPage,
  },
  {
    page: PAGES.engines,
    label: 'vLLM Engines',
    icon: 'mdi:engine-outline',
    component: VllmEnginesPage,
  },
  {
    page: PAGES.gpuFleet,
    label: 'GPU Fleet',
    icon: 'mdi:expansion-card-variant',
    component: GpuFleetPage,
  },
  {
    page: PAGES.storage,
    label: 'Model Storage',
    icon: 'mdi:harddisk',
    component: ModelStoragePage,
  },
  { page: PAGES.settings, label: 'Settings', icon: 'mdi:cog-outline', component: SettingsPage },
];

const DETAIL_ROUTES: Array<{
  route: { name: string; path: string; sidebar: string };
  component: React.ComponentType;
}> = [
  { route: DETAIL_PAGES.endpoint, component: EndpointDetailPage },
  { route: DETAIL_PAGES.profile, component: ProfileDetailPage },
  { route: DETAIL_PAGES.catalogEntry, component: CatalogEntryPage },
  { route: DETAIL_PAGES.deploy, component: DeployWizardPage },
];

registerSidebarEntry({
  parent: null,
  name: SIDEBAR_ROOT,
  label: 'Inference Hub',
  url: PAGES.commandCenter.path,
  icon: INFERENCE_HUB_ICON,
});

for (const { page, label, icon, component } of SIDEBAR_PAGES) {
  registerSidebarEntry({ parent: SIDEBAR_ROOT, name: page.name, label, url: page.path, icon });
  registerRoute({
    path: page.path,
    sidebar: page.name,
    name: page.name,
    exact: true,
    component: withBoundary(component),
  });
}

for (const { route, component } of DETAIL_ROUTES) {
  registerRoute({
    path: route.path,
    sidebar: route.sidebar,
    name: route.name,
    exact: true,
    component: withBoundary(component),
  });
}

// Native page integrations. Failures stay inside the section (fallback renders nothing).
registerDetailsViewSection(({ resource }) => (
  <ErrorBoundary fallback={null}>
    <NodeGpuSection resource={resource} />
  </ErrorBoundary>
));
registerDetailsViewSection(({ resource }) => (
  <ErrorBoundary fallback={null}>
    <PodAiSection resource={resource} />
  </ErrorBoundary>
));

registerPluginSettings(PLUGIN_NAME, PluginSettingsPanel, false);
