import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import React, { useMemo } from 'react';
import { useNamespaceLabels } from '../hooks/useClusterData';
import {
  Alertmanager,
  AlertmanagerConfig,
  ConfigResource,
  PodMonitor,
  Probe,
  Prometheus,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
} from '../resources/crds';
import {
  prometheusAlertmanagerServices,
  SelectableKind,
  serviceMonitorMatchesService,
  workloadSelects,
} from '../utils/relations';

interface Edge {
  id: string;
  source: string;
  target: string;
}

/**
 * Resource map source: Prometheus -> (ServiceMonitor|PodMonitor|Probe|ScrapeConfig|PrometheusRule)
 * -> Service/Pod, Prometheus -> Alertmanager -> AlertmanagerConfig.
 * Node ids are object UIDs so they merge with Headlamp's built-in Service/Pod nodes.
 */
function useMonitoringGraph() {
  const nsLabels = useNamespaceLabels();
  const [proms] = Prometheus.useList();
  const [ams] = Alertmanager.useList();
  const [sms] = ServiceMonitor.useList();
  const [pms] = PodMonitor.useList();
  const [probes] = Probe.useList();
  const [scs] = ScrapeConfig.useList();
  const [rules] = PrometheusRule.useList();
  const [amcs] = AlertmanagerConfig.useList();
  const [services] = K8s.ResourceClasses.Service.useList();
  const [pods] = K8s.ResourceClasses.Pod.useList();

  return useMemo(() => {
    if (!proms && !ams) return null;
    const nodes = new Map<string, { id: string; kubeObject: KubeObject }>();
    const edges: Edge[] = [];
    const add = (o: KubeObject) => nodes.set(o.metadata.uid, { id: o.metadata.uid, kubeObject: o });
    const link = (a: KubeObject, b: KubeObject) =>
      edges.push({
        id: `mon-${a.metadata.uid}-${b.metadata.uid}`,
        source: a.metadata.uid,
        target: b.metadata.uid,
      });

    const selectable: Array<[SelectableKind, ConfigResource[] | null]> = [
      ['ServiceMonitor', sms],
      ['PodMonitor', pms],
      ['Probe', probes],
      ['ScrapeConfig', scs],
      ['PrometheusRule', rules],
    ];
    for (const p of proms || []) {
      add(p);
      for (const [kind, items] of selectable) {
        for (const item of items || []) {
          if (workloadSelects(p.jsonData, kind, item.jsonData, nsLabels) !== 'not-selected') {
            add(item);
            link(p, item);
          }
        }
      }
      for (const target of prometheusAlertmanagerServices(p.jsonData)) {
        for (const am of ams || []) {
          if (
            am.metadata.namespace === target.namespace &&
            (target.name === 'alertmanager-operated' || target.name.startsWith(am.metadata.name))
          ) {
            add(am);
            link(p, am);
          }
        }
      }
    }
    for (const am of ams || []) {
      add(am);
      for (const c of amcs || []) {
        if (
          workloadSelects(am.jsonData, 'AlertmanagerConfig', c.jsonData, nsLabels) !==
          'not-selected'
        ) {
          add(c);
          link(am, c);
        }
      }
    }
    for (const sm of sms || []) {
      if (!nodes.has(sm.metadata.uid)) continue;
      for (const svc of services || []) {
        if (serviceMonitorMatchesService(sm.jsonData, svc.jsonData)) {
          add(svc);
          link(sm, svc);
        }
      }
    }
    for (const pm of pms || []) {
      if (!nodes.has(pm.metadata.uid)) continue;
      for (const pod of pods || []) {
        if (serviceMonitorMatchesService(pm.jsonData, pod.jsonData)) {
          add(pod);
          link(pm, pod);
        }
      }
    }
    return { nodes: [...nodes.values()], edges };
  }, [nsLabels, proms, ams, sms, pms, probes, scs, rules, amcs, services, pods]);
}

export const monitoringMapSource = {
  id: 'monitoring',
  label: 'Monitoring',
  icon: <Icon icon="mdi:monitor-eye" width="100%" height="100%" />,
  isEnabledByDefault: false,
  useData: useMonitoringGraph,
};
