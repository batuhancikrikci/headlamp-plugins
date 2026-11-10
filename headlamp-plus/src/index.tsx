import './common/icons';
import {
  DefaultDetailsViewSection,
  registerAppBarAction,
  registerAppTheme,
  registerDetailsViewSectionsProcessor,
  registerRoute,
  registerSidebarEntry,
} from '@kinvolk/headlamp-plugin/lib';
import { ErrorBoundary, withBoundary } from './common/ErrorBoundary';
import { PLUGIN_NAME } from './config';
import { EfficiencyDashboard } from './dashboards/EfficiencyDashboard';
import { JobsDashboard } from './dashboards/JobsDashboard';
import { NetworkDashboard } from './dashboards/NetworkDashboard';
import { NodeDetailJson } from './dashboards/node';
import { NodeOverview } from './dashboards/NodeOverview';
import { SecurityDashboard } from './dashboards/SecurityDashboard';
import { StorageDashboard } from './dashboards/StorageDashboard';
import { UpgradeDashboard } from './dashboards/UpgradeDashboard';
import { enforceLanguage } from './language';
import { completeOidcReturn, installOidcRedirect } from './oidcRedirect';
import { ClusterOverview } from './overview/ClusterOverview';
import { NamespaceOverview } from './overview/NamespaceOverview';
import { WorkloadsOverview } from './overview/WorkloadsOverview';
import { injectGlobalStyles } from './styles';
import { hideForeignThemeCards, persistTheme, ThemeLock } from './themeLock';
import { darkTheme, lightTheme } from './themes';

registerAppTheme(lightTheme);
registerAppTheme(darkTheme);
registerAppBarAction(ThemeLock);
// Same path, name and sidebar item as Headlamp's stock pages: plugin routes are matched first,
// so these dashboards take their place.
registerRoute({
  path: '/',
  exact: true,
  name: 'Cluster',
  sidebar: 'cluster',
  component: withBoundary(ClusterOverview),
});
registerRoute({
  path: '/workloads',
  exact: true,
  name: 'Workloads',
  sidebar: 'workloads',
  component: withBoundary(WorkloadsOverview),
});

// Further dashboards in a sidebar group of their own.
const DASHBOARDS: Array<{ path: string; label: string; component: React.ComponentType }> = [
  { path: 'storage', label: 'Storage', component: StorageDashboard },
  { path: 'security', label: 'Security', component: SecurityDashboard },
  { path: 'network', label: 'Network', component: NetworkDashboard },
  { path: 'jobs', label: 'Jobs', component: JobsDashboard },
  { path: 'upgrade', label: 'Upgrade readiness', component: UpgradeDashboard },
  { path: 'efficiency', label: 'Resource efficiency', component: EfficiencyDashboard },
];
const DASHBOARDS_ROOT = 'headlamp-plus-dashboards';
registerSidebarEntry({
  parent: null,
  name: DASHBOARDS_ROOT,
  label: 'Dashboards',
  url: `/dashboards/${DASHBOARDS[0].path}`,
  icon: 'mdi:view-dashboard-outline',
});
for (const dashboard of DASHBOARDS) {
  const name = `${DASHBOARDS_ROOT}-${dashboard.path}`;
  registerSidebarEntry({
    parent: DASHBOARDS_ROOT,
    name,
    label: dashboard.label,
    url: `/dashboards/${dashboard.path}`,
  });
  registerRoute({
    path: `/dashboards/${dashboard.path}`,
    exact: true,
    name,
    sidebar: name,
    component: withBoundary(dashboard.component),
  });
}

// The namespace and node dashboards go right below the object's own details (name, labels,
// status), above Headlamp's other sections.
const NAMESPACE_SECTION_ID = 'headlamp-plus.namespace-overview';
const NODE_SECTION_ID = 'headlamp-plus.node-overview';
/** Id of a details view section; sections can also be plain React nodes. */
function sectionId(section: unknown): string | undefined {
  return (section as { id?: string } | null)?.id;
}

registerDetailsViewSectionsProcessor(function addOverviewSections(resource, sections) {
  const kind = resource?.kind;
  const id =
    kind === 'Namespace' ? NAMESPACE_SECTION_ID : kind === 'Node' ? NODE_SECTION_ID : undefined;
  if (!resource || !id || sections.some(s => sectionId(s) === id)) return sections;
  const section = {
    id,
    section: (
      <ErrorBoundary>
        {kind === 'Namespace' ? (
          <NamespaceOverview namespace={resource.metadata.name} />
        ) : (
          <NodeOverview node={resource.jsonData as NodeDetailJson} />
        )}
      </ErrorBoundary>
    ),
  };
  const after = sections.findIndex(s => sectionId(s) === DefaultDetailsViewSection.METADATA);
  const at = after >= 0 ? after + 1 : Math.min(1, sections.length);
  return [...sections.slice(0, at), section, ...sections.slice(at)];
});

/** DOM checks run at most once per animation frame to stay cheap on large tables. */
function startDomObserver(): void {
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (enforceLanguage()) return;
    if (window.location.href.includes('/settings')) hideForeignThemeCards();
  };

  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }).observe(document.body, { childList: true, subtree: true });

  flush();
}

function init(): void {
  // Guard against double initialisation when Headlamp re-evaluates plugins (dev reloads).
  const flags = window as unknown as Record<string, boolean | undefined>;
  const flag = `__${PLUGIN_NAME}-initialized`;
  if (flags[flag]) return;
  flags[flag] = true;

  if (completeOidcReturn()) return;
  installOidcRedirect();
  if (enforceLanguage()) return;
  persistTheme();
  injectGlobalStyles();
  startDomObserver();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
