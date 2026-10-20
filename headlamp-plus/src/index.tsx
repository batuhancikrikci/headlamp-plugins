import './common/icons';
import {
  registerAppBarAction,
  registerAppTheme,
  registerRoute,
} from '@kinvolk/headlamp-plugin/lib';
import { withBoundary } from './common/ErrorBoundary';
import { PLUGIN_NAME } from './config';
import { enforceLanguage } from './language';
import { completeOidcReturn, installOidcRedirect } from './oidcRedirect';
import { ClusterOverview } from './overview/ClusterOverview';
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
