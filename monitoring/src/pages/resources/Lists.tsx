import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import type {
  ColumnType,
  ResourceTableColumn,
} from '@kinvolk/headlamp-plugin/lib/components/common/Resource/ResourceTable';
import { Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { SelectorSummary, TagList } from '../../components/common/Selectors';
import { WorkloadHealthChip } from '../../components/common/StatusChip';
import { receiverTypesOf } from '../../components/forms/AlertmanagerConfigForm';
import { CreateResourceMenu } from '../../components/forms/registry';
import { SelectedByCell } from '../../components/relations/SelectedBy';
import { useCrdAvailability } from '../../hooks/useClusterData';
import { useSelectingWorkloads } from '../../hooks/useWorkloads';
import {
  Alertmanager,
  AlertmanagerConfig,
  ConfigResource,
  MonitoringResourceClass,
  PodMonitor,
  Probe,
  Prometheus,
  PrometheusAgent,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
  ThanosRuler,
} from '../../resources/crds';
import { MonitorNamespaceSelector } from '../../types';
import { SelectableKind } from '../../utils/relations';

const { ResourceListView } = CommonComponents;

type ListColumns = React.ComponentProps<typeof ResourceListView>['columns'];
type Columns<T> = Array<ColumnType | ResourceTableColumn<T>>;

/** Wraps a list with a "CRD not installed" empty state and a Create button. */
function MonitoringList<C extends MonitoringResourceClass>({
  title,
  resourceClass,
  columns,
}: {
  title: string;
  resourceClass: C;
  columns: Columns<InstanceType<C>>;
}) {
  const { t } = useText();
  const available = useCrdAvailability();
  if (available && !available.has(resourceClass.apiName)) {
    return (
      <EmptyState
        icon="mdi:monitor-eye"
        title={t('{{kind}} is not available in this cluster', { kind: resourceClass.kind })}
        description={t(
          'The {{kind}} CRD (monitoring.coreos.com) is not installed. Install or upgrade kube-prometheus-stack / the Prometheus Operator CRDs.',
          { kind: resourceClass.kind }
        )}
      />
    );
  }
  return (
    <ResourceListView
      title={title}
      resourceClass={resourceClass}
      // ResourceListView types its columns for any KubeObject; the rows are instances of
      // resourceClass, which is what the columns expect.
      columns={columns as ListColumns}
      headerProps={{
        titleSideActions: [<CreateResourceMenu key="create" resourceClass={resourceClass} />],
      }}
    />
  );
}

function nsScope(
  sel: MonitorNamespaceSelector | undefined,
  own: string | undefined,
  t: (s: string) => string
) {
  if (sel?.any) return t('All');
  if (sel?.matchNames?.length) return sel.matchNames.join(', ');
  return own || '-';
}

function workloadColumns<T extends Prometheus | Alertmanager | ThanosRuler>(
  t: (s: string) => string,
  withRetention: boolean
): Array<ResourceTableColumn<T>> {
  return [
    {
      id: 'status',
      label: t('Status'),
      getValue: (item: T) => item.getHealth(),
      render: (item: T) => <WorkloadHealthChip health={item.getHealth()} />,
    },
    {
      id: 'replicas',
      label: t('Replicas'),
      getValue: (item: T) => item.getReplicasText(),
    },
    {
      id: 'version',
      label: t('Version'),
      getValue: (item: T) => item.jsonData.spec?.version || '-',
    },
    ...(withRetention
      ? [
          {
            id: 'retention',
            label: t('Retention'),
            getValue: (item: T) => item.jsonData.spec?.retention || '-',
          },
        ]
      : []),
  ];
}

function selectedByColumn<T extends ConfigResource>(
  t: (s: string) => string,
  evaluate: ReturnType<typeof useSelectingWorkloads>['evaluate']
): ResourceTableColumn<T> {
  return {
    id: 'selectedBy',
    label: t('Selected by'),
    getValue: (item: T) =>
      evaluate(item.jsonData)
        .filter(s => s.result !== 'not-selected')
        .map(s => s.workload.metadata.name)
        .join(','),
    render: (item: T) => <SelectedByCell selections={evaluate(item.jsonData)} />,
  };
}

function useSelectedBy<T extends ConfigResource>(kind: SelectableKind) {
  const { t } = useText();
  const { evaluate } = useSelectingWorkloads(kind);
  return selectedByColumn<T>(t, evaluate);
}

export function PrometheusList() {
  const { t } = useText();
  return (
    <MonitoringList
      title={t('Prometheuses')}
      resourceClass={Prometheus}
      columns={['name', 'namespace', ...workloadColumns(t, true), 'age']}
    />
  );
}

export function PrometheusAgentList() {
  const { t } = useText();
  return (
    <MonitoringList
      title={t('Prometheus Agents')}
      resourceClass={PrometheusAgent}
      columns={[
        'name',
        'namespace',
        {
          id: 'replicas',
          label: t('Replicas'),
          getValue: (item: PrometheusAgent) =>
            `${item.status.availableReplicas ?? 0}/${item.spec.replicas ?? 1}`,
        },
        {
          id: 'version',
          label: t('Version'),
          getValue: (item: PrometheusAgent) => item.spec.version || '-',
        },
        'age',
      ]}
    />
  );
}

export function AlertmanagerList() {
  const { t } = useText();
  return (
    <MonitoringList
      title={t('Alertmanagers')}
      resourceClass={Alertmanager}
      columns={['name', 'namespace', ...workloadColumns(t, true), 'age']}
    />
  );
}

export function ThanosRulerList() {
  const { t } = useText();
  return (
    <MonitoringList
      title={t('Thanos Rulers')}
      resourceClass={ThanosRuler}
      columns={['name', 'namespace', ...workloadColumns(t, true), 'age']}
    />
  );
}

export function ServiceMonitorList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<ServiceMonitor>('ServiceMonitor');
  return (
    <MonitoringList
      title={t('Service Monitors')}
      resourceClass={ServiceMonitor}
      columns={[
        'name',
        'namespace',
        {
          id: 'selector',
          label: t('Selector'),
          getValue: (item: ServiceMonitor) => JSON.stringify(item.spec.selector || {}),
          render: (item: ServiceMonitor) => <SelectorSummary selector={item.spec.selector} />,
        },
        {
          id: 'ports',
          label: t('Endpoints'),
          getValue: (item: ServiceMonitor) =>
            (item.spec.endpoints || []).map(e => e.port || e.targetPort).join(', '),
          render: (item: ServiceMonitor) => (
            <TagList
              items={(item.spec.endpoints || []).map(
                e =>
                  `${e.port || e.targetPort || '?'}${e.path && e.path !== '/metrics' ? e.path : ''}`
              )}
            />
          ),
        },
        {
          id: 'nsScope',
          label: t('Namespaces'),
          getValue: (item: ServiceMonitor) =>
            nsScope(item.spec.namespaceSelector, item.metadata.namespace, t),
        },
        selectedBy,
        'age',
      ]}
    />
  );
}

export function PodMonitorList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<PodMonitor>('PodMonitor');
  return (
    <MonitoringList
      title={t('Pod Monitors')}
      resourceClass={PodMonitor}
      columns={[
        'name',
        'namespace',
        {
          id: 'selector',
          label: t('Selector'),
          getValue: (item: PodMonitor) => JSON.stringify(item.spec.selector || {}),
          render: (item: PodMonitor) => <SelectorSummary selector={item.spec.selector} />,
        },
        {
          id: 'ports',
          label: t('Endpoints'),
          getValue: (item: PodMonitor) =>
            (item.spec.podMetricsEndpoints || []).map(e => e.port || e.targetPort).join(', '),
          render: (item: PodMonitor) => (
            <TagList
              items={(item.spec.podMetricsEndpoints || []).map(
                e => `${e.port || e.portNumber || e.targetPort || '?'}`
              )}
            />
          ),
        },
        {
          id: 'nsScope',
          label: t('Namespaces'),
          getValue: (item: PodMonitor) =>
            nsScope(item.spec.namespaceSelector, item.metadata.namespace, t),
        },
        selectedBy,
        'age',
      ]}
    />
  );
}

export function ProbeList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<Probe>('Probe');
  return (
    <MonitoringList
      title={t('Probes')}
      resourceClass={Probe}
      columns={[
        'name',
        'namespace',
        {
          id: 'prober',
          label: t('Prober'),
          getValue: (item: Probe) => item.spec.prober?.url || '-',
        },
        { id: 'module', label: t('Module'), getValue: (item: Probe) => item.spec.module || '-' },
        {
          id: 'targets',
          label: t('Targets'),
          getValue: (item: Probe) =>
            item.spec.targets?.staticConfig?.static?.length ??
            (item.spec.targets?.ingress ? t('Ingress') : 0),
        },
        selectedBy,
        'age',
      ]}
    />
  );
}

export function ScrapeConfigList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<ScrapeConfig>('ScrapeConfig');
  const sdTypes = (item: ScrapeConfig) =>
    Object.keys(item.spec)
      .filter(
        k =>
          /SDConfigs$|^staticConfigs$/.test(k) &&
          Array.isArray(item.spec[k]) &&
          (item.spec[k] as unknown[]).length
      )
      .map(k => k.replace(/SDConfigs$/, '').replace(/^staticConfigs$/, 'static'));
  return (
    <MonitoringList
      title={t('Scrape Configs')}
      resourceClass={ScrapeConfig}
      columns={[
        'name',
        'namespace',
        { id: 'job', label: t('Job'), getValue: (item: ScrapeConfig) => item.spec.jobName || '-' },
        {
          id: 'sd',
          label: t('Discovery'),
          getValue: (item: ScrapeConfig) => sdTypes(item).join(', '),
          render: (item: ScrapeConfig) => <TagList items={sdTypes(item)} />,
        },
        selectedBy,
        'age',
      ]}
    />
  );
}

export function PrometheusRuleList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<PrometheusRule>('PrometheusRule');
  return (
    <MonitoringList
      title={t('Prometheus Rules')}
      resourceClass={PrometheusRule}
      columns={[
        'name',
        'namespace',
        {
          id: 'groups',
          label: t('Groups'),
          getValue: (item: PrometheusRule) => item.spec.groups?.length || 0,
        },
        {
          id: 'alerts',
          label: t('Alerts'),
          getValue: (item: PrometheusRule) => item.getRuleCount().alerts,
        },
        {
          id: 'records',
          label: t('Records'),
          getValue: (item: PrometheusRule) => item.getRuleCount().records,
        },
        selectedBy,
        'age',
      ]}
    />
  );
}

export function AlertmanagerConfigList() {
  const { t } = useText();
  const selectedBy = useSelectedBy<AlertmanagerConfig>('AlertmanagerConfig');
  return (
    <MonitoringList
      title={t('Alertmanager Configs')}
      resourceClass={AlertmanagerConfig}
      columns={[
        'name',
        'namespace',
        {
          id: 'receivers',
          label: t('Receivers'),
          getValue: (item: AlertmanagerConfig) =>
            (item.spec.receivers || []).map(r => r.name).join(', '),
          render: (item: AlertmanagerConfig) => (
            <Tooltip
              title={(item.spec.receivers || [])
                .map(
                  r =>
                    `${r.name}: ${
                      receiverTypesOf(r)
                        .map(rt => rt.label)
                        .join(', ') || 'null'
                    }`
                )
                .join(' · ')}
            >
              <span>
                <TagList items={(item.spec.receivers || []).map(r => r.name)} />
              </span>
            </Tooltip>
          ),
        },
        {
          id: 'routes',
          label: t('Routes'),
          getValue: (item: AlertmanagerConfig) =>
            item.spec.route ? 1 + (item.spec.route.routes?.length || 0) : 0,
          render: (item: AlertmanagerConfig) =>
            item.spec.route ? (
              <Typography variant="body2">{1 + (item.spec.route.routes?.length || 0)}</Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                -
              </Typography>
            ),
        },
        selectedBy,
        'age',
      ]}
    />
  );
}
