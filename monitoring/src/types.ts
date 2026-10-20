/**
 * Types for Prometheus Operator (monitoring.coreos.com) resources and for the
 * Prometheus / Alertmanager HTTP APIs. Only the fields the plugin uses are typed;
 * everything else stays reachable through the index signature.
 */
import type { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';

export type Labels = Record<string, string>;

export interface LabelSelectorRequirement {
  key: string;
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist' | string;
  values?: string[];
}

export interface LabelSelector {
  matchLabels?: Labels;
  matchExpressions?: LabelSelectorRequirement[];
}

/** ServiceMonitor/PodMonitor/Probe style namespace selector. */
export interface MonitorNamespaceSelector {
  any?: boolean;
  matchNames?: string[];
}

export interface SecretKeySelector {
  name: string;
  key: string;
  optional?: boolean;
}

export interface SafeTLSConfig {
  insecureSkipVerify?: boolean;
  serverName?: string;
  ca?: { secret?: SecretKeySelector; configMap?: SecretKeySelector };
  cert?: { secret?: SecretKeySelector; configMap?: SecretKeySelector };
  keySecret?: SecretKeySelector;
}

export interface BasicAuth {
  username?: SecretKeySelector;
  password?: SecretKeySelector;
}

export interface RelabelConfig {
  sourceLabels?: string[];
  separator?: string;
  targetLabel?: string;
  regex?: string;
  modulus?: number;
  replacement?: string;
  action?: string;
}

export interface MonitorEndpoint {
  port?: string;
  portNumber?: number;
  targetPort?: string | number;
  path?: string;
  scheme?: 'http' | 'https' | string;
  interval?: string;
  scrapeTimeout?: string;
  honorLabels?: boolean;
  honorTimestamps?: boolean;
  params?: Record<string, string[]>;
  tlsConfig?: SafeTLSConfig;
  basicAuth?: BasicAuth;
  bearerTokenSecret?: SecretKeySelector;
  authorization?: { type?: string; credentials?: SecretKeySelector };
  relabelings?: RelabelConfig[];
  metricRelabelings?: RelabelConfig[];
  [key: string]: unknown;
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

/** status.bindings reported by newer operator versions on "config" resources. */
export interface WorkloadBinding {
  group: string;
  resource: string;
  name: string;
  namespace: string;
  conditions?: Condition[];
}

export interface ConfigResourceStatus {
  bindings?: WorkloadBinding[];
}

export interface ServiceMonitorSpec {
  jobLabel?: string;
  targetLabels?: string[];
  podTargetLabels?: string[];
  endpoints: MonitorEndpoint[];
  selector: LabelSelector;
  namespaceSelector?: MonitorNamespaceSelector;
  sampleLimit?: number;
  attachMetadata?: { node?: boolean };
  [key: string]: unknown;
}

export interface PodMonitorSpec {
  jobLabel?: string;
  podTargetLabels?: string[];
  podMetricsEndpoints?: MonitorEndpoint[];
  selector: LabelSelector;
  namespaceSelector?: MonitorNamespaceSelector;
  sampleLimit?: number;
  [key: string]: unknown;
}

export interface ProbeSpec {
  jobName?: string;
  prober?: { url: string; scheme?: string; path?: string };
  module?: string;
  interval?: string;
  scrapeTimeout?: string;
  targets?: {
    staticConfig?: { static?: string[]; labels?: Labels };
    ingress?: { selector?: LabelSelector; namespaceSelector?: MonitorNamespaceSelector };
  };
  [key: string]: unknown;
}

export interface ScrapeConfigSpec {
  jobName?: string;
  staticConfigs?: Array<{ targets?: string[]; labels?: Labels }>;
  kubernetesSDConfigs?: Array<{ role?: string }>;
  httpSDConfigs?: Array<{ url?: string }>;
  metricsPath?: string;
  scrapeInterval?: string;
  scheme?: string;
  [key: string]: unknown;
}

export interface Rule {
  alert?: string;
  record?: string;
  expr: string | number;
  for?: string;
  keep_firing_for?: string;
  labels?: Labels;
  annotations?: Labels;
}

export interface RuleGroup {
  name: string;
  interval?: string;
  limit?: number;
  partial_response_strategy?: string;
  rules: Rule[];
}

export interface PrometheusRuleSpec {
  groups?: RuleGroup[];
}

export interface AlertmanagerEndpoint {
  namespace?: string;
  name: string;
  port: string | number;
  scheme?: string;
  pathPrefix?: string;
  apiVersion?: string;
}

export interface CommonWorkloadSpec {
  replicas?: number;
  shards?: number;
  version?: string;
  image?: string;
  paused?: boolean;
  serviceAccountName?: string;
  logLevel?: string;
  logFormat?: string;
  retention?: string;
  retentionSize?: string;
  externalUrl?: string;
  routePrefix?: string;
  nodeSelector?: Labels;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  storage?: {
    volumeClaimTemplate?: {
      spec?: {
        storageClassName?: string;
        accessModes?: string[];
        resources?: { requests?: { storage?: string } };
      };
    };
    emptyDir?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface PrometheusSpec extends CommonWorkloadSpec {
  scrapeInterval?: string;
  evaluationInterval?: string;
  externalLabels?: Labels;
  enableAdminAPI?: boolean;
  serviceMonitorSelector?: LabelSelector | null;
  serviceMonitorNamespaceSelector?: LabelSelector | null;
  podMonitorSelector?: LabelSelector | null;
  podMonitorNamespaceSelector?: LabelSelector | null;
  probeSelector?: LabelSelector | null;
  probeNamespaceSelector?: LabelSelector | null;
  scrapeConfigSelector?: LabelSelector | null;
  scrapeConfigNamespaceSelector?: LabelSelector | null;
  ruleSelector?: LabelSelector | null;
  ruleNamespaceSelector?: LabelSelector | null;
  alerting?: { alertmanagers?: AlertmanagerEndpoint[] };
  remoteWrite?: Array<{ url: string; name?: string }>;
  thanos?: Record<string, unknown>;
}

export interface AlertmanagerSpec extends CommonWorkloadSpec {
  alertmanagerConfigSelector?: LabelSelector | null;
  alertmanagerConfigNamespaceSelector?: LabelSelector | null;
  alertmanagerConfigMatcherStrategy?: { type?: 'OnNamespace' | 'None' | string };
  alertmanagerConfiguration?: { name?: string };
  configSecret?: string;
}

export interface ThanosRulerSpec extends CommonWorkloadSpec {
  queryEndpoints?: string[];
  evaluationInterval?: string;
  ruleSelector?: LabelSelector | null;
  ruleNamespaceSelector?: LabelSelector | null;
}

export interface WorkloadStatus {
  replicas?: number;
  availableReplicas?: number;
  updatedReplicas?: number;
  unavailableReplicas?: number;
  paused?: boolean;
  conditions?: Condition[];
  shards?: number;
}

export interface AMCMatcher {
  name: string;
  value?: string;
  /** v1alpha1 */
  regex?: boolean;
  /** v1alpha1 (newer) and v1beta1 */
  matchType?: '=' | '!=' | '=~' | '!~';
}

export interface AMCRoute {
  receiver?: string;
  groupBy?: string[];
  groupWait?: string;
  groupInterval?: string;
  repeatInterval?: string;
  matchers?: AMCMatcher[];
  continue?: boolean;
  routes?: AMCRoute[];
  muteTimeIntervals?: string[];
  activeTimeIntervals?: string[];
}

export type ReceiverConfig = Record<string, unknown> & { sendResolved?: boolean };

export interface AMCReceiver {
  name: string;
  slackConfigs?: ReceiverConfig[];
  emailConfigs?: ReceiverConfig[];
  webhookConfigs?: ReceiverConfig[];
  pagerdutyConfigs?: ReceiverConfig[];
  msteamsConfigs?: ReceiverConfig[];
  telegramConfigs?: ReceiverConfig[];
  opsgenieConfigs?: ReceiverConfig[];
  [key: string]: unknown;
}

export interface AMCInhibitRule {
  sourceMatch?: AMCMatcher[];
  targetMatch?: AMCMatcher[];
  equal?: string[];
}

export interface AlertmanagerConfigSpec {
  route?: AMCRoute;
  receivers?: AMCReceiver[];
  inhibitRules?: AMCInhibitRule[];
  muteTimeIntervals?: Array<{ name: string }>;
  timeIntervals?: Array<{ name: string }>;
}

export interface MonitoringObject<Spec, Status = ConfigResourceStatus> extends KubeObjectInterface {
  spec: Spec;
  status?: Status;
}

export type KubeServiceMonitor = MonitoringObject<ServiceMonitorSpec>;
export type KubePodMonitor = MonitoringObject<PodMonitorSpec>;
export type KubeProbe = MonitoringObject<ProbeSpec>;
export type KubeScrapeConfig = MonitoringObject<ScrapeConfigSpec>;
export type KubePrometheusRule = MonitoringObject<PrometheusRuleSpec>;
export type KubeAlertmanagerConfig = MonitoringObject<AlertmanagerConfigSpec>;
export type KubePrometheus = MonitoringObject<PrometheusSpec, WorkloadStatus>;
export type KubePrometheusAgent = MonitoringObject<PrometheusSpec, WorkloadStatus>;
export type KubeAlertmanager = MonitoringObject<AlertmanagerSpec, WorkloadStatus>;
export type KubeThanosRuler = MonitoringObject<ThanosRulerSpec, WorkloadStatus>;

// ---------------------------------------------------------------------------
// Prometheus HTTP API
// ---------------------------------------------------------------------------

export interface PromTarget {
  discoveredLabels?: Labels;
  labels: Labels;
  scrapePool: string;
  scrapeUrl: string;
  globalUrl?: string;
  lastError: string;
  lastScrape: string;
  lastScrapeDuration: number;
  health: 'up' | 'down' | 'unknown';
  scrapeInterval?: string;
  scrapeTimeout?: string;
}

export interface PromAlert {
  labels: Labels;
  annotations: Labels;
  state: 'firing' | 'pending' | 'inactive';
  activeAt?: string;
  value?: string;
}

export interface PromRule {
  name: string;
  query: string;
  duration?: number;
  keepFiringFor?: number;
  labels?: Labels;
  annotations?: Labels;
  alerts?: PromAlert[];
  health: 'ok' | 'err' | 'unknown';
  lastError?: string;
  type: 'alerting' | 'recording';
  state?: 'firing' | 'pending' | 'inactive';
  lastEvaluation?: string;
  evaluationTime?: number;
}

export interface PromRuleGroup {
  name: string;
  file: string;
  interval: number;
  rules: PromRule[];
  lastEvaluation?: string;
  evaluationTime?: number;
}

export interface PromSeriesResult {
  metric: Labels;
  value?: [number, string];
  values?: Array<[number, string]>;
}

export interface PromQueryData {
  resultType: 'matrix' | 'vector' | 'scalar' | 'string';
  result: PromSeriesResult[] | [number, string];
}

// ---------------------------------------------------------------------------
// Alertmanager v2 API
// ---------------------------------------------------------------------------

export interface AMMatcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual?: boolean;
}

export interface AMSilence {
  id: string;
  matchers: AMMatcher[];
  startsAt: string;
  endsAt: string;
  updatedAt?: string;
  createdBy: string;
  comment: string;
  status: { state: 'active' | 'pending' | 'expired' };
}

export interface AMAlert {
  labels: Labels;
  annotations: Labels;
  startsAt: string;
  endsAt: string;
  updatedAt?: string;
  fingerprint: string;
  generatorURL?: string;
  receivers: Array<{ name: string }>;
  status: {
    state: 'active' | 'suppressed' | 'unprocessed';
    silencedBy: string[];
    inhibitedBy: string[];
  };
}
