import './common/icons';
import { Icon } from '@iconify/react';
import {
  K8s,
  registerAppBarAction,
  registerDetailsViewSection,
  registerKindIcon,
  registerMapSource,
  registerPluginSettings,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
  Utils,
} from '@kinvolk/headlamp-plugin/lib';
import React, { useEffect } from 'react';
import { ErrorBoundary } from './common/ErrorBoundary';
import { ensureCrdAvailability, getCachedCrdAvailability } from './hooks/useClusterData';
import { monitoringMapSource } from './integrations/mapSource';
import MonitoredBySection from './integrations/MonitoredBySection';
import MonitoringSettings from './integrations/Settings';
import Alerting from './pages/alerting/Alerting';
import Metrics from './pages/Metrics';
import Overview from './pages/Overview';
import {
  AlertmanagerConfigDetails,
  PodMonitorDetails,
  ProbeDetails,
  PrometheusRuleDetails,
  ScrapeConfigDetails,
  ServiceMonitorDetails,
} from './pages/resources/ConfigDetails';
import {
  AlertmanagerConfigList,
  AlertmanagerList,
  PodMonitorList,
  ProbeList,
  PrometheusAgentList,
  PrometheusList,
  PrometheusRuleList,
  ScrapeConfigList,
  ServiceMonitorList,
  ThanosRulerList,
} from './pages/resources/Lists';
import {
  AlertmanagerDetails,
  PrometheusAgentDetails,
  PrometheusDetails,
  ThanosRulerDetails,
} from './pages/resources/WorkloadDetails';
import Targets from './pages/Targets';
import { detailsRouteName, listRouteName, MONITORING_GROUP } from './resources/crds';
import { PLUGIN_NAME } from './settings';

const ROOT = 'monitoring';

function withBoundary(Component: React.ComponentType) {
  return () => (
    <ErrorBoundary>
      <Component />
    </ErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Sidebar + routes
// ---------------------------------------------------------------------------

registerSidebarEntry({
  parent: null,
  name: ROOT,
  label: 'Monitoring',
  url: '/monitoring/overview',
  icon: 'mdi:chart-line',
});

const PAGES = [
  { name: 'overview', label: 'Overview', icon: 'mdi:view-dashboard', component: Overview },
  { name: 'alerting', label: 'Alerting', icon: 'mdi:bell-ring', component: Alerting },
  { name: 'metrics', label: 'Metrics', icon: 'mdi:chart-box-outline', component: Metrics },
  { name: 'targets', label: 'Targets', icon: 'mdi:target', component: Targets },
];

for (const page of PAGES) {
  const entryName = `${ROOT}-${page.name}`;
  registerSidebarEntry({
    parent: ROOT,
    name: entryName,
    label: page.label,
    url: `/monitoring/${page.name}`,
    icon: page.icon,
  });
  registerRoute({
    path: `/monitoring/${page.name}`,
    sidebar: entryName,
    name: entryName,
    exact: true,
    component: withBoundary(page.component),
  });
}

/** Ordered by how often they are used; workloads first, then configuration. */
const RESOURCES = [
  {
    plural: 'prometheuses',
    kind: 'Prometheus',
    label: 'Prometheuses',
    icon: 'mdi:database',
    List: PrometheusList,
    Details: PrometheusDetails,
  },
  {
    plural: 'alertmanagers',
    kind: 'Alertmanager',
    label: 'Alertmanagers',
    icon: 'mdi:email-alert',
    List: AlertmanagerList,
    Details: AlertmanagerDetails,
  },
  {
    plural: 'servicemonitors',
    kind: 'ServiceMonitor',
    label: 'Service Monitors',
    icon: 'mdi:eye-outline',
    List: ServiceMonitorList,
    Details: ServiceMonitorDetails,
  },
  {
    plural: 'podmonitors',
    kind: 'PodMonitor',
    label: 'Pod Monitors',
    icon: 'mdi:cube-outline',
    List: PodMonitorList,
    Details: PodMonitorDetails,
  },
  {
    plural: 'probes',
    kind: 'Probe',
    label: 'Probes',
    icon: 'mdi:radar',
    List: ProbeList,
    Details: ProbeDetails,
  },
  {
    plural: 'scrapeconfigs',
    kind: 'ScrapeConfig',
    label: 'Scrape Configs',
    icon: 'mdi:file-code-outline',
    List: ScrapeConfigList,
    Details: ScrapeConfigDetails,
  },
  {
    plural: 'prometheusrules',
    kind: 'PrometheusRule',
    label: 'Prometheus Rules',
    icon: 'mdi:format-list-checks',
    List: PrometheusRuleList,
    Details: PrometheusRuleDetails,
  },
  {
    plural: 'alertmanagerconfigs',
    kind: 'AlertmanagerConfig',
    label: 'Alertmanager Configs',
    icon: 'mdi:bell-cog',
    List: AlertmanagerConfigList,
    Details: AlertmanagerConfigDetails,
  },
  {
    plural: 'prometheusagents',
    kind: 'PrometheusAgent',
    label: 'Prometheus Agents',
    icon: 'mdi:robot-outline',
    List: PrometheusAgentList,
    Details: PrometheusAgentDetails,
  },
  {
    plural: 'thanosrulers',
    kind: 'ThanosRuler',
    label: 'Thanos Rulers',
    icon: 'mdi:gavel',
    List: ThanosRulerList,
    Details: ThanosRulerDetails,
  },
];

for (const res of RESOURCES) {
  const entryName = listRouteName(res.plural);
  registerSidebarEntry({
    parent: ROOT,
    name: entryName,
    label: res.label,
    url: `/monitoring/${res.plural}`,
    icon: res.icon,
  });
  registerRoute({
    path: `/monitoring/${res.plural}`,
    sidebar: entryName,
    name: entryName,
    exact: true,
    component: withBoundary(res.List),
  });
  registerRoute({
    path: `/monitoring/${res.plural}/:namespace/:name`,
    sidebar: entryName,
    name: detailsRouteName(res.plural),
    exact: true,
    component: withBoundary(res.Details),
  });
  registerKindIcon(
    res.kind,
    { icon: <Icon icon={res.icon} width="70%" height="70%" /> },
    MONITORING_GROUP
  );
}

// Hide CRD entries that the current cluster does not serve (e.g. ThanosRuler,
// ScrapeConfig on older operators). Entries stay visible until detection ran.
const PLURAL_BY_ENTRY = new Map(RESOURCES.map(r => [listRouteName(r.plural), r.plural]));
registerSidebarEntryFilter(entry => {
  const plural = PLURAL_BY_ENTRY.get(entry.name);
  if (!plural) return entry;
  const available = getCachedCrdAvailability(Utils.getCluster());
  if (available && available.size > 0 && !available.has(plural)) return null;
  return entry;
});

/** Invisible app-bar component that (re)detects served CRDs when the cluster changes. */
function CrdAvailabilityWatcher() {
  const cluster = K8s.useCluster();
  useEffect(() => {
    // Transient failures are retried by the pages that need the result.
    if (cluster) ensureCrdAvailability(cluster).catch(() => {});
  }, [cluster]);
  return null;
}
registerAppBarAction(<CrdAvailabilityWatcher />);

// ---------------------------------------------------------------------------
// Integrations with core Headlamp views
// ---------------------------------------------------------------------------

registerDetailsViewSection(MonitoredBySection);
registerMapSource(monitoringMapSource);
registerPluginSettings(PLUGIN_NAME, MonitoringSettings, false);
