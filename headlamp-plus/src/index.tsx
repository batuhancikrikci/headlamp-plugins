import './common/icons';
import {
  DefaultDetailsViewSection,
  registerAppBarAction,
  registerAppTheme,
  registerDetailsViewSectionsProcessor,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import { ErrorBoundary, withBoundary } from './common/ErrorBoundary';
import { PLUGIN_NAME } from './config';
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

// The namespace dashboard goes right below the namespace's own details (name, labels, status),
// above Headlamp's sections for quotas, limit ranges, pods and events.
const NAMESPACE_SECTION_ID = 'headlamp-plus.namespace-overview';
/** Id of a details view section; sections can also be plain React nodes. */
function sectionId(section: unknown): string | undefined {
  return (section as { id?: string } | null)?.id;
}

registerDetailsViewSectionsProcessor(function addNamespaceOverview(resource, sections) {
  if (resource?.kind !== 'Namespace' || sections.some(s => sectionId(s) === NAMESPACE_SECTION_ID)) {
    return sections;
  }
  const section = {
    id: NAMESPACE_SECTION_ID,
    section: (
      <ErrorBoundary>
        <NamespaceOverview namespace={resource.metadata.name} />
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
