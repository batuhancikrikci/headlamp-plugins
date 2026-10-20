/**
 * Inference Hub settings, persisted with Headlamp's plugin ConfigStore. Cluster specific values live
 * under `clusters[<cluster name>]`.
 */
import { ConfigStore } from '@kinvolk/headlamp-plugin/lib';

export const PLUGIN_NAME = 'inference-hub';

export type PrometheusMode = 'auto' | 'service' | 'url' | 'off';

export interface PrometheusServiceRef {
  namespace: string;
  name: string;
  port: number;
  scheme?: 'http' | 'https';
  /** Path prefix in front of /api/v1, e.g. "/prometheus" for Mimir. */
  pathPrefix?: string;
}

export interface PrometheusSettings {
  mode: PrometheusMode;
  service?: PrometheusServiceRef;
  /** Direct URL (reached from the browser, not through the cluster). */
  url?: string;
  /** Tenant header for multi-tenant backends such as Mimir or Cortex. */
  orgId?: string;
}

export interface ClusterSettings {
  prometheus?: PrometheusSettings;
  /** Namespace preselected in namespaced pages and the deploy wizard. */
  defaultNamespace?: string;
}

export interface FeatureToggles {
  /** Chat with endpoints through the Kubernetes service proxy. */
  playground: boolean;
  /** Read /metrics of vLLM pods through the pod proxy when Prometheus is not available. */
  podMetricsScrape: boolean;
  /** GPU section on native Node detail pages. */
  nodeGpuSection: boolean;
  /** AI workload section on native Pod detail pages. */
  podAiSection: boolean;
}

export interface InferenceHubSettings {
  /** Refresh interval of live data in seconds. */
  refreshSeconds?: number;
  features?: Partial<FeatureToggles>;
  clusters?: Record<string, ClusterSettings>;
}

export const DEFAULT_REFRESH_SECONDS = 15;
export const MIN_REFRESH_SECONDS = 5;

export const DEFAULT_FEATURES: FeatureToggles = {
  playground: true,
  podMetricsScrape: true,
  nodeGpuSection: true,
  podAiSection: true,
};

export const DEFAULT_PROMETHEUS: PrometheusSettings = { mode: 'auto' };

export const settingsStore = new ConfigStore<InferenceHubSettings>(PLUGIN_NAME);

const useSettingsConfig = settingsStore.useConfig();
const EMPTY: InferenceHubSettings = {};

export function useSettings(): InferenceHubSettings {
  return useSettingsConfig() || EMPTY;
}

export function getSettings(): InferenceHubSettings {
  return settingsStore.get() || EMPTY;
}

export function refreshMs(settings: InferenceHubSettings): number {
  const seconds = settings.refreshSeconds ?? DEFAULT_REFRESH_SECONDS;
  return Math.max(MIN_REFRESH_SECONDS, seconds) * 1000;
}

export function featuresOf(settings: InferenceHubSettings): FeatureToggles {
  return { ...DEFAULT_FEATURES, ...(settings.features || {}) };
}

export function clusterSettingsOf(
  settings: InferenceHubSettings,
  cluster: string | null | undefined
): ClusterSettings {
  return (cluster && settings.clusters?.[cluster]) || {};
}

export function updateClusterSettings(
  cluster: string | null | undefined,
  patch: Partial<ClusterSettings>
) {
  if (!cluster) return;
  const current = getSettings();
  const clusters = { ...(current.clusters || {}) };
  clusters[cluster] = { ...(clusters[cluster] || {}), ...patch };
  settingsStore.update({ clusters });
}
