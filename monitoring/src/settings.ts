import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

export const PLUGIN_NAME = 'monitoring';

export interface ClusterMonitoringSettings {
  /** Selected Prometheus CR as "namespace/name". */
  prometheus?: string;
  /** Selected Alertmanager CR as "namespace/name". */
  alertmanager?: string;
  /** Manual service override, e.g. "monitoring/thanos-query:http". */
  prometheusOverride?: string;
  alertmanagerOverride?: string;
}

export interface MonitoringSettings {
  /** Auto refresh interval for live data in seconds (0 = off). */
  refreshInterval?: number;
  clusters?: Record<string, ClusterMonitoringSettings>;
}

export const DEFAULT_REFRESH_SECONDS = 30;

export const settingsStore = new ConfigStore<MonitoringSettings>(PLUGIN_NAME);

const useSettingsConfig = settingsStore.useConfig();
const EMPTY: MonitoringSettings = {};

export function useMonitoringSettings(): MonitoringSettings {
  return useSettingsConfig() || EMPTY;
}

export function getClusterSettings(
  settings: MonitoringSettings,
  cluster: string | null
): ClusterMonitoringSettings {
  return (cluster && settings.clusters?.[cluster]) || {};
}

export function updateClusterSettings(
  cluster: string | null,
  patch: Partial<ClusterMonitoringSettings>
) {
  if (!cluster) return;
  const current = settingsStore.get() || {};
  const clusters = { ...(current.clusters || {}) };
  clusters[cluster] = { ...(clusters[cluster] || {}), ...patch };
  settingsStore.update({ clusters });
}

export function refreshIntervalMs(settings: MonitoringSettings): number {
  const seconds = settings.refreshInterval ?? DEFAULT_REFRESH_SECONDS;
  return seconds > 0 ? seconds * 1000 : 0;
}
