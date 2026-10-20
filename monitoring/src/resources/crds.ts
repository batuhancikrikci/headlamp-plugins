/**
 * KubeObject classes for every CRD shipped by kube-prometheus-stack
 * (monitoring.coreos.com). Multi-version CRDs use an apiVersion array: Headlamp
 * probes the listed versions and uses the first one that is served.
 */
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  AlertmanagerConfigSpec,
  AlertmanagerSpec,
  Condition,
  KubeAlertmanager,
  KubeAlertmanagerConfig,
  KubePodMonitor,
  KubeProbe,
  KubePrometheus,
  KubePrometheusAgent,
  KubePrometheusRule,
  KubeScrapeConfig,
  KubeServiceMonitor,
  KubeThanosRuler,
  PodMonitorSpec,
  ProbeSpec,
  PrometheusRuleSpec,
  PrometheusSpec,
  ScrapeConfigSpec,
  ServiceMonitorSpec,
  ThanosRulerSpec,
  WorkloadBinding,
  WorkloadStatus,
} from '../types';

export const MONITORING_GROUP = 'monitoring.coreos.com';

/** Route names used by the plugin (see index.tsx). */
export const listRouteName = (plural: string) => `monitoring-${plural}`;
export const detailsRouteName = (plural: string) => `monitoring-${plural}-detail`;

// ---------------------------------------------------------------------------
// Workloads (StatefulSet-backed, have status.conditions)
// ---------------------------------------------------------------------------

abstract class WorkloadObject<
  T extends KubePrometheus | KubeAlertmanager | KubeThanosRuler
> extends KubeObject<T> {
  get status(): WorkloadStatus {
    return this.jsonData.status || {};
  }

  getCondition(type: string): Condition | undefined {
    return this.status.conditions?.find(c => c.type === type);
  }

  /** "Available"/"Degraded"/"Paused"/"Unknown" summarised from status. */
  getHealth(): 'Available' | 'Degraded' | 'Paused' | 'Reconciling' | 'Unknown' {
    if (this.jsonData.spec?.paused) return 'Paused';
    const available = this.getCondition('Available');
    const reconciled = this.getCondition('Reconciled');
    if (available?.status === 'True') {
      return reconciled && reconciled.status !== 'True' ? 'Reconciling' : 'Available';
    }
    if (available?.status === 'Degraded' || available?.status === 'False') return 'Degraded';
    return 'Unknown';
  }

  getReplicasText(): string {
    const desired = this.jsonData.spec?.replicas ?? 1;
    const available = this.status.availableReplicas ?? 0;
    return `${available}/${desired}`;
  }
}

export class Prometheus extends WorkloadObject<KubePrometheus> {
  static kind = 'Prometheus';
  static apiName = 'prometheuses';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('prometheuses');
  }
  static get detailsRoute() {
    return detailsRouteName('prometheuses');
  }
  get spec(): PrometheusSpec {
    return this.jsonData.spec || {};
  }
}

export class PrometheusAgent extends KubeObject<KubePrometheusAgent> {
  static kind = 'PrometheusAgent';
  static apiName = 'prometheusagents';
  static apiVersion = `${MONITORING_GROUP}/v1alpha1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('prometheusagents');
  }
  static get detailsRoute() {
    return detailsRouteName('prometheusagents');
  }
  get spec(): PrometheusSpec {
    return this.jsonData.spec || {};
  }
  get status(): WorkloadStatus {
    return this.jsonData.status || {};
  }
}

export class Alertmanager extends WorkloadObject<KubeAlertmanager> {
  static kind = 'Alertmanager';
  static apiName = 'alertmanagers';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('alertmanagers');
  }
  static get detailsRoute() {
    return detailsRouteName('alertmanagers');
  }
  get spec(): AlertmanagerSpec {
    return this.jsonData.spec || {};
  }
}

export class ThanosRuler extends WorkloadObject<KubeThanosRuler> {
  static kind = 'ThanosRuler';
  static apiName = 'thanosrulers';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('thanosrulers');
  }
  static get detailsRoute() {
    return detailsRouteName('thanosrulers');
  }
  get spec(): ThanosRulerSpec {
    return this.jsonData.spec || {};
  }
}

// ---------------------------------------------------------------------------
// Configuration resources (selected by workloads)
// ---------------------------------------------------------------------------

abstract class ConfigObject<
  T extends
    | KubeServiceMonitor
    | KubePodMonitor
    | KubeProbe
    | KubeScrapeConfig
    | KubePrometheusRule
    | KubeAlertmanagerConfig
> extends KubeObject<T> {
  /** Workloads that reported (via status.bindings) they picked this resource. */
  getBindings(): WorkloadBinding[] {
    return this.jsonData.status?.bindings || [];
  }
}

export class ServiceMonitor extends ConfigObject<KubeServiceMonitor> {
  static kind = 'ServiceMonitor';
  static apiName = 'servicemonitors';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('servicemonitors');
  }
  static get detailsRoute() {
    return detailsRouteName('servicemonitors');
  }
  get spec(): ServiceMonitorSpec {
    return this.jsonData.spec || { endpoints: [], selector: {} };
  }
}

export class PodMonitor extends ConfigObject<KubePodMonitor> {
  static kind = 'PodMonitor';
  static apiName = 'podmonitors';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('podmonitors');
  }
  static get detailsRoute() {
    return detailsRouteName('podmonitors');
  }
  get spec(): PodMonitorSpec {
    return this.jsonData.spec || { selector: {} };
  }
}

export class Probe extends ConfigObject<KubeProbe> {
  static kind = 'Probe';
  static apiName = 'probes';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('probes');
  }
  static get detailsRoute() {
    return detailsRouteName('probes');
  }
  get spec(): ProbeSpec {
    return this.jsonData.spec || {};
  }
}

export class ScrapeConfig extends ConfigObject<KubeScrapeConfig> {
  static kind = 'ScrapeConfig';
  static apiName = 'scrapeconfigs';
  static apiVersion = `${MONITORING_GROUP}/v1alpha1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('scrapeconfigs');
  }
  static get detailsRoute() {
    return detailsRouteName('scrapeconfigs');
  }
  get spec(): ScrapeConfigSpec {
    return this.jsonData.spec || {};
  }
}

export class PrometheusRule extends ConfigObject<KubePrometheusRule> {
  static kind = 'PrometheusRule';
  static apiName = 'prometheusrules';
  static apiVersion = `${MONITORING_GROUP}/v1`;
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('prometheusrules');
  }
  static get detailsRoute() {
    return detailsRouteName('prometheusrules');
  }
  get spec(): PrometheusRuleSpec {
    return this.jsonData.spec || {};
  }
  getRuleCount(): { alerts: number; records: number } {
    let alerts = 0;
    let records = 0;
    for (const g of this.spec.groups || []) {
      for (const r of g.rules || []) {
        if (r.alert) alerts++;
        else if (r.record) records++;
      }
    }
    return { alerts, records };
  }
}

export class AlertmanagerConfig extends ConfigObject<KubeAlertmanagerConfig> {
  static kind = 'AlertmanagerConfig';
  static apiName = 'alertmanagerconfigs';
  // v1alpha1 is the storage version and the schema this plugin renders/creates.
  static apiVersion = [`${MONITORING_GROUP}/v1alpha1`, `${MONITORING_GROUP}/v1beta1`];
  static isNamespaced = true;
  static get listRoute() {
    return listRouteName('alertmanagerconfigs');
  }
  static get detailsRoute() {
    return detailsRouteName('alertmanagerconfigs');
  }
  get spec(): AlertmanagerConfigSpec {
    return this.jsonData.spec || {};
  }
}

/** Configuration resources that workloads select (see utils/relations.ts). */
export type ConfigResource =
  | ServiceMonitor
  | PodMonitor
  | Probe
  | ScrapeConfig
  | PrometheusRule
  | AlertmanagerConfig;

export type MonitoringResourceClass =
  | typeof Prometheus
  | typeof PrometheusAgent
  | typeof Alertmanager
  | typeof ThanosRuler
  | typeof ServiceMonitor
  | typeof PodMonitor
  | typeof Probe
  | typeof ScrapeConfig
  | typeof PrometheusRule
  | typeof AlertmanagerConfig;

/** Version used when creating new objects from the plugin's forms. */
export function creationApiVersion(cls: MonitoringResourceClass): string {
  return Array.isArray(cls.apiVersion) ? cls.apiVersion[0] : cls.apiVersion;
}
