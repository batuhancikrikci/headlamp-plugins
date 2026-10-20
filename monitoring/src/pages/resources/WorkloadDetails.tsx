import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { ApiErrorAlert } from '../../components/common/Feedback';
import {
  LabelChips,
  SelectorDisplay,
  TagList,
  WorkloadNamespaceSelectorDisplay,
} from '../../components/common/Selectors';
import { StatusChip, WorkloadHealthChip } from '../../components/common/StatusChip';
import { useNamespaceLabels } from '../../hooks/useClusterData';
import { useInstanceBaseUrl } from '../../hooks/useMonitoringEndpoint';
import { usePolling } from '../../hooks/usePolling';
import { WorkloadObject } from '../../hooks/useWorkloads';
import {
  Alertmanager,
  AlertmanagerConfig,
  ConfigResource,
  detailsRouteName,
  PodMonitor,
  Probe,
  Prometheus,
  PrometheusAgent,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
  ThanosRuler,
} from '../../resources/crds';
import { formatServiceEndpoint } from '../../utils/discovery';
import { timeAgo } from '../../utils/duration';
import {
  amAlerts,
  amSilences,
  amStatus,
  promBuildInfo,
  promRuleGroups,
  promRuntimeInfo,
  promTargets,
} from '../../utils/monitoringApi';
import {
  prometheusAlertmanagerServices,
  SelectableKind,
  SelectionResult,
  selectorFieldsFor,
  summarizeTargets,
  workloadSelects,
} from '../../utils/relations';
import { ConditionsSection, DetailsPage, NameValueRow } from './DetailsPage';

const { SectionBox, SimpleTable, NameValueTable, Link } = CommonComponents;

function commonInfo(
  item: Prometheus | Alertmanager | ThanosRuler,
  t: (s: string) => string
): NameValueRow[] {
  const spec = item.jsonData.spec || {};
  return [
    { name: t('Status'), value: <WorkloadHealthChip health={item.getHealth()} /> },
    { name: t('Replicas'), value: item.getReplicasText() },
    { name: t('Version'), value: spec.version || t('operator default') },
    { name: t('Retention'), value: spec.retention || '-', hide: !spec.retention },
    { name: t('Retention size'), value: spec.retentionSize || '-', hide: !spec.retentionSize },
    { name: t('Paused'), value: t('Yes'), hide: !spec.paused },
    { name: t('External URL'), value: spec.externalUrl, hide: !spec.externalUrl },
    { name: t('Service account'), value: spec.serviceAccountName || '-' },
    {
      name: t('Storage'),
      value: spec.storage?.volumeClaimTemplate
        ? `${spec.storage.volumeClaimTemplate.spec?.resources?.requests?.storage || '?'} (${
            spec.storage.volumeClaimTemplate.spec?.storageClassName || t('default class')
          })`
        : spec.storage?.emptyDir
        ? 'emptyDir'
        : t('none (ephemeral)'),
    },
  ];
}

const SELECTABLE: Array<{ kind: SelectableKind; label: string }> = [
  { kind: 'ServiceMonitor', label: 'ServiceMonitors' },
  { kind: 'PodMonitor', label: 'PodMonitors' },
  { kind: 'Probe', label: 'Probes' },
  { kind: 'ScrapeConfig', label: 'ScrapeConfigs' },
  { kind: 'PrometheusRule', label: 'PrometheusRules' },
  { kind: 'AlertmanagerConfig', label: 'AlertmanagerConfigs' },
];

function SelectorsSection({ item, kinds }: { item: WorkloadObject; kinds: SelectableKind[] }) {
  const { t } = useText();
  const spec = (item.jsonData.spec || {}) as Record<string, any>;
  return (
    <SectionBox title={t('Selectors')}>
      <SimpleTable
        data={SELECTABLE.filter(s => kinds.includes(s.kind))}
        columns={[
          { label: t('Resource'), getter: (s: { label: string }) => s.label },
          {
            label: t('Selector'),
            getter: (s: { kind: SelectableKind }) => (
              <SelectorDisplay selector={spec[selectorFieldsFor(s.kind)[0]]} nilMeaning="none" />
            ),
          },
          {
            label: t('Namespaces'),
            getter: (s: { kind: SelectableKind }) => (
              <WorkloadNamespaceSelectorDisplay
                selector={spec[selectorFieldsFor(s.kind)[1]]}
                ownNamespace={item.metadata.namespace}
              />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

interface SelectedRow {
  kind: SelectableKind;
  obj: ConfigResource;
  result: SelectionResult;
}

/** Everything the workload picks up, computed with the operator's selector semantics. */
function SelectedResourcesSection({
  item,
  kinds,
}: {
  item: WorkloadObject;
  kinds: SelectableKind[];
}) {
  const { t } = useText();
  const nsLabels = useNamespaceLabels();
  const [sms] = ServiceMonitor.useList();
  const [pms] = PodMonitor.useList();
  const [probes] = Probe.useList();
  const [scs] = ScrapeConfig.useList();
  const [rules] = PrometheusRule.useList();
  const [amcs] = AlertmanagerConfig.useList();
  const byKind: Record<SelectableKind, ConfigResource[] | null> = {
    ServiceMonitor: sms,
    PodMonitor: pms,
    Probe: probes,
    ScrapeConfig: scs,
    PrometheusRule: rules,
    AlertmanagerConfig: amcs,
  };
  const rows: SelectedRow[] = kinds.flatMap(kind =>
    (byKind[kind] || [])
      .map(obj => ({
        kind,
        obj,
        result: workloadSelects(item.jsonData, kind, obj.jsonData, nsLabels),
      }))
      .filter(r => r.result !== 'not-selected')
  );
  const counts = kinds.map(k => `${k}: ${rows.filter(r => r.kind === k).length}`).join(' · ');
  return (
    <SectionBox title={t('Selected resources')}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {counts}
      </Typography>
      <SimpleTable
        data={rows}
        emptyMessage={t('This workload does not select any resource.')}
        columns={[
          {
            label: t('Kind'),
            getter: (r: SelectedRow) => r.kind,
            sort: (a: SelectedRow, b: SelectedRow) => a.kind.localeCompare(b.kind),
          },
          {
            label: t('Name'),
            getter: (r: SelectedRow) => <Link kubeObject={r.obj}>{r.obj.metadata.name}</Link>,
            sort: (a: SelectedRow, b: SelectedRow) =>
              a.obj.metadata.name.localeCompare(b.obj.metadata.name),
          },
          { label: t('Namespace'), getter: (r: SelectedRow) => r.obj.metadata.namespace },
          {
            label: t('Selection'),
            getter: (r: SelectedRow) =>
              r.result === 'selected' ? (
                <StatusChip tone="success" label={t('Selected')} variant="outlined" />
              ) : (
                <StatusChip
                  tone="default"
                  label={t('Unknown')}
                  tooltip={t('Depends on namespace labels that cannot be read')}
                />
              ),
          },
        ]}
      />
    </SectionBox>
  );
}

function PrometheusLiveSection({ item }: { item: Prometheus }) {
  const { t } = useText();
  const ep = useInstanceBaseUrl('Prometheus', item.jsonData);
  const live = usePolling(
    ep.baseUrl
      ? async () => {
          const [build, runtime, targets, groups] = await Promise.all([
            promBuildInfo(ep.baseUrl).catch(() => null),
            promRuntimeInfo(ep.baseUrl).catch(() => null),
            promTargets(ep.baseUrl),
            promRuleGroups(ep.baseUrl),
          ]);
          return { build, runtime, targets: summarizeTargets(targets), groups };
        }
      : null,
    [ep.baseUrl],
    30_000
  );
  const d = live.data;
  return (
    <SectionBox title={t('Live status')}>
      {!ep.loading && !ep.endpoint && (
        <Typography color="text.secondary">{t('No Service routes to this instance.')}</Typography>
      )}
      <ApiErrorAlert error={live.error || ep.error} onRetry={live.refresh} />
      {ep.endpoint && (
        <NameValueTable
          rows={[
            {
              name: t('Service'),
              value: (
                <Link
                  routeName="service"
                  params={{ namespace: ep.endpoint.namespace, name: ep.endpoint.name }}
                >
                  {formatServiceEndpoint(ep.endpoint)}
                </Link>
              ),
            },
            { name: t('Running version'), value: d?.build?.version || '-' },
            {
              name: t('Configuration'),
              value: d?.runtime ? (
                d.runtime.reloadConfigSuccess ? (
                  <StatusChip
                    tone="success"
                    label={t('Loaded {{ago}} ago', { ago: timeAgo(d.runtime.lastConfigTime) })}
                    variant="outlined"
                  />
                ) : (
                  <StatusChip tone="error" label={t('Last reload failed')} />
                )
              ) : (
                '-'
              ),
            },
            {
              name: t('Targets'),
              value: d ? (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <StatusChip
                    tone="success"
                    label={`${d.targets.up} ${t('up')}`}
                    variant="outlined"
                  />
                  {d.targets.down > 0 && (
                    <StatusChip tone="error" label={`${d.targets.down} ${t('down')}`} />
                  )}
                  <Link
                    routeName="monitoring-targets"
                    search={d.targets.down ? { health: 'down' } : undefined}
                  >
                    {t('View targets')}
                  </Link>
                </Box>
              ) : (
                '-'
              ),
            },
            {
              name: t('Rules'),
              value: d
                ? t('{{groups}} groups, {{rules}} rules', {
                    groups: d.groups.length,
                    rules: d.groups.reduce((n, g) => n + g.rules.length, 0),
                  })
                : '-',
            },
          ]}
        />
      )}
    </SectionBox>
  );
}

function AlertmanagerLiveSection({ item }: { item: Alertmanager }) {
  const { t } = useText();
  const ep = useInstanceBaseUrl('Alertmanager', item.jsonData);
  const live = usePolling(
    ep.baseUrl
      ? async () => {
          const [status, alerts, silences] = await Promise.all([
            amStatus(ep.baseUrl).catch(() => null),
            amAlerts(ep.baseUrl),
            amSilences(ep.baseUrl),
          ]);
          return { status, alerts, silences };
        }
      : null,
    [ep.baseUrl],
    30_000
  );
  const d = live.data;
  return (
    <SectionBox title={t('Live status')}>
      {!ep.loading && !ep.endpoint && (
        <Typography color="text.secondary">{t('No Service routes to this instance.')}</Typography>
      )}
      <ApiErrorAlert error={live.error || ep.error} onRetry={live.refresh} />
      {ep.endpoint && (
        <NameValueTable
          rows={[
            {
              name: t('Service'),
              value: (
                <Link
                  routeName="service"
                  params={{ namespace: ep.endpoint.namespace, name: ep.endpoint.name }}
                >
                  {formatServiceEndpoint(ep.endpoint)}
                </Link>
              ),
            },
            { name: t('Running version'), value: d?.status?.versionInfo?.version || '-' },
            { name: t('Cluster'), value: d?.status?.cluster?.status || '-' },
            {
              name: t('Alerts'),
              value: d
                ? t('{{active}} active, {{suppressed}} suppressed', {
                    active: d.alerts.filter(a => a.status.state === 'active').length,
                    suppressed: d.alerts.filter(a => a.status.state === 'suppressed').length,
                  })
                : '-',
            },
            {
              name: t('Silences'),
              value: d ? (
                <Link routeName="monitoring-alerting" search={{ tab: 'silences' }}>
                  {t('{{count}} active', {
                    count: d.silences.filter(s => s.status.state === 'active').length,
                  })}
                </Link>
              ) : (
                '-'
              ),
            },
          ]}
        />
      )}
    </SectionBox>
  );
}

function AlertmanagersSection({ item }: { item: Prometheus }) {
  const { t } = useText();
  const [ams] = Alertmanager.useList();
  const targets = prometheusAlertmanagerServices(item.jsonData);
  return (
    <SectionBox title={t('Alertmanagers')}>
      <SimpleTable
        data={targets}
        emptyMessage={t(
          'This Prometheus does not send alerts to any Alertmanager (spec.alerting is empty).'
        )}
        columns={[
          {
            label: t('Service'),
            getter: (a: { namespace: string; name: string }) => (
              <Link routeName="service" params={{ namespace: a.namespace, name: a.name }}>
                {a.namespace}/{a.name}
              </Link>
            ),
          },
          { label: t('Port'), getter: (a: { port: string | number }) => String(a.port) },
          {
            label: t('Alertmanager resource'),
            getter: (a: { namespace: string; name: string }) => {
              const candidates = (ams || []).filter(
                am =>
                  am.metadata.namespace === a.namespace &&
                  (a.name === 'alertmanager-operated' ||
                    a.name === am.metadata.name ||
                    a.name.startsWith(am.metadata.name))
              );
              if (!candidates.length) return '-';
              return (
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {candidates.map(am => (
                    <Link key={am.metadata.uid} kubeObject={am}>
                      {am.metadata.name}
                    </Link>
                  ))}
                </Box>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}

const PROM_KINDS: SelectableKind[] = [
  'ServiceMonitor',
  'PodMonitor',
  'Probe',
  'ScrapeConfig',
  'PrometheusRule',
];
const AGENT_KINDS: SelectableKind[] = ['ServiceMonitor', 'PodMonitor', 'Probe', 'ScrapeConfig'];

export function PrometheusDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={Prometheus}
      extraInfo={item => [
        ...commonInfo(item, t),
        { name: t('Scrape interval'), value: item.spec.scrapeInterval || '30s' },
        { name: t('Evaluation interval'), value: item.spec.evaluationInterval || '30s' },
        { name: t('External labels'), value: <LabelChips labels={item.spec.externalLabels} /> },
        {
          name: t('Remote write'),
          value: <TagList items={(item.spec.remoteWrite || []).map(r => r.name || r.url)} />,
          hide: !item.spec.remoteWrite?.length,
        },
      ]}
      sections={item => [
        { id: 'monitoring-live', section: <PrometheusLiveSection item={item} /> },
        { id: 'monitoring-conditions', section: <ConditionsSection item={item} /> },
        {
          id: 'monitoring-selectors',
          section: <SelectorsSection item={item} kinds={PROM_KINDS} />,
        },
        {
          id: 'monitoring-selected',
          section: <SelectedResourcesSection item={item} kinds={PROM_KINDS} />,
        },
        { id: 'monitoring-alertmanagers', section: <AlertmanagersSection item={item} /> },
      ]}
    />
  );
}

export function PrometheusAgentDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={PrometheusAgent}
      extraInfo={item => [
        {
          name: t('Replicas'),
          value: `${item.status.availableReplicas ?? 0}/${item.spec.replicas ?? 1}`,
        },
        { name: t('Version'), value: item.spec.version || t('operator default') },
        { name: t('Scrape interval'), value: item.spec.scrapeInterval || '30s' },
        {
          name: t('Remote write'),
          value: <TagList items={(item.spec.remoteWrite || []).map(r => r.name || r.url)} />,
        },
      ]}
      sections={item => [
        { id: 'monitoring-conditions', section: <ConditionsSection item={item} /> },
        {
          id: 'monitoring-selectors',
          section: <SelectorsSection item={item} kinds={AGENT_KINDS} />,
        },
        {
          id: 'monitoring-selected',
          section: <SelectedResourcesSection item={item} kinds={AGENT_KINDS} />,
        },
      ]}
    />
  );
}

export function AlertmanagerDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={Alertmanager}
      extraInfo={item => [
        ...commonInfo(item, t),
        {
          name: t('Config matcher strategy'),
          value: item.spec.alertmanagerConfigMatcherStrategy?.type || 'OnNamespace',
        },
        {
          name: t('Global configuration'),
          value: item.spec.alertmanagerConfiguration?.name ? (
            <Link
              routeName={detailsRouteName('alertmanagerconfigs')}
              params={{
                namespace: item.metadata.namespace,
                name: item.spec.alertmanagerConfiguration.name,
              }}
            >
              {item.spec.alertmanagerConfiguration.name}
            </Link>
          ) : (
            '-'
          ),
        },
        {
          name: t('Config secret'),
          value: item.spec.configSecret ? (
            <Link
              routeName="secret"
              params={{ namespace: item.metadata.namespace, name: item.spec.configSecret }}
            >
              {item.spec.configSecret}
            </Link>
          ) : (
            `alertmanager-${item.metadata.name}`
          ),
        },
      ]}
      sections={item => [
        { id: 'monitoring-live', section: <AlertmanagerLiveSection item={item} /> },
        { id: 'monitoring-conditions', section: <ConditionsSection item={item} /> },
        {
          id: 'monitoring-selectors',
          section: <SelectorsSection item={item} kinds={['AlertmanagerConfig']} />,
        },
        {
          id: 'monitoring-selected',
          section: <SelectedResourcesSection item={item} kinds={['AlertmanagerConfig']} />,
        },
      ]}
    />
  );
}

export function ThanosRulerDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={ThanosRuler}
      extraInfo={item => [
        ...commonInfo(item, t),
        { name: t('Evaluation interval'), value: item.spec.evaluationInterval || '-' },
        { name: t('Query endpoints'), value: <TagList items={item.spec.queryEndpoints} /> },
      ]}
      sections={item => [
        { id: 'monitoring-conditions', section: <ConditionsSection item={item} /> },
        {
          id: 'monitoring-selectors',
          section: <SelectorsSection item={item} kinds={['PrometheusRule']} />,
        },
        {
          id: 'monitoring-selected',
          section: <SelectedResourcesSection item={item} kinds={['PrometheusRule']} />,
        },
      ]}
    />
  );
}
