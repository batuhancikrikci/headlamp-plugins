import { Icon } from '@iconify/react';
import { CommonComponents, K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import * as yaml from 'js-yaml';
import React, { useMemo } from 'react';
import { useText } from '../../common/i18n';
import { CodeBlock, Mono } from '../../components/common/CodeBlock';
import { ApiErrorAlert } from '../../components/common/Feedback';
import {
  MonitorNamespaceSelectorDisplay,
  SelectorDisplay,
  TagList,
} from '../../components/common/Selectors';
import {
  AlertStateChip,
  RuleHealthChip,
  SeverityChip,
  StatusChip,
  TargetHealthChip,
} from '../../components/common/StatusChip';
import { receiverTypesOf } from '../../components/forms/AlertmanagerConfigForm';
import { SelectedBySection } from '../../components/relations/SelectedBy';
import { usePrometheusEndpoint } from '../../hooks/useMonitoringEndpoint';
import { usePolling } from '../../hooks/usePolling';
import { useSelectingWorkloads } from '../../hooks/useWorkloads';
import {
  AlertmanagerConfig,
  ConfigResource,
  PodMonitor,
  Probe,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
} from '../../resources/crds';
import {
  AMCInhibitRule,
  AMCReceiver,
  AMCRoute,
  MonitorEndpoint,
  PromRule,
  PromTarget,
  Rule,
  SecretKeySelector,
} from '../../types';
import { formatSeconds, timeAgo } from '../../utils/duration';
import { formatAMCMatcher } from '../../utils/matchers';
import { promRuleGroups, promTargets } from '../../utils/monitoringApi';
import {
  ruleGroupsForRule,
  scrapePoolPrefix,
  SelectableKind,
  serviceMonitorMatchesService,
  summarizeTargets,
  targetsForResource,
} from '../../utils/relations';
import { DetailsPage } from './DetailsPage';

const { SectionBox, SimpleTable, Link } = CommonComponents;

type ScrapeKind = 'ServiceMonitor' | 'PodMonitor' | 'Probe' | 'ScrapeConfig';

interface NamedPort {
  name?: string;
}

// ---------------------------------------------------------------------------
// Shared sections
// ---------------------------------------------------------------------------

function SelectedBy({ kind, item }: { kind: SelectableKind; item: ConfigResource }) {
  const { evaluate } = useSelectingWorkloads(kind);
  return (
    <SelectedBySection
      kind={kind}
      selections={evaluate(item.jsonData)}
      resourceLabels={item.jsonData.metadata.labels}
      bindings={item.getBindings()}
    />
  );
}

/** Live Prometheus targets produced by this monitor, from the selected Prometheus instance. */
function LiveTargetsSection({
  kind,
  namespace,
  name,
}: {
  kind: ScrapeKind;
  namespace: string;
  name: string;
}) {
  const { t } = useText();
  const prom = usePrometheusEndpoint();
  const targets = usePolling(
    prom.baseUrl ? () => promTargets(prom.baseUrl) : null,
    [prom.baseUrl],
    30_000
  );
  const mine = useMemo(
    () => targetsForResource(targets.data || [], kind, namespace, name),
    [targets.data, kind, namespace, name]
  );
  const summary = summarizeTargets(mine);
  const pool = scrapePoolPrefix(kind, namespace, name);
  return (
    <SectionBox title={t('Scrape targets')}>
      {prom.instance && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('As seen by Prometheus {{name}}', {
            name: `${prom.instance.metadata.namespace}/${prom.instance.metadata.name}`,
          })}
        </Typography>
      )}
      {!prom.loading && !prom.baseUrl && (
        <Typography color="text.secondary">
          {t('No Prometheus instance available to query live targets.')}
        </Typography>
      )}
      <ApiErrorAlert error={targets.error} onRetry={targets.refresh} />
      {prom.baseUrl && (
        <>
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <StatusChip tone="success" label={`${summary.up} ${t('up')}`} variant="outlined" />
            {summary.down > 0 && <StatusChip tone="error" label={`${summary.down} ${t('down')}`} />}
            <Link routeName="monitoring-targets" search={{ q: pool }}>
              {t('Open in Targets')}
            </Link>
          </Box>
          <SimpleTable
            data={mine}
            emptyMessage={
              targets.loading
                ? t('Loading…')
                : t(
                    'Prometheus has no targets for this resource. It may not be selected, or its selector matches nothing.'
                  )
            }
            columns={[
              {
                label: t('Health'),
                getter: (tg: PromTarget) => (
                  <TargetHealthChip health={tg.health} error={tg.lastError} />
                ),
              },
              { label: t('Endpoint'), getter: (tg: PromTarget) => <Mono>{tg.scrapeUrl}</Mono> },
              {
                label: t('Last scrape'),
                getter: (tg: PromTarget) =>
                  `${timeAgo(tg.lastScrape)} (${formatSeconds(tg.lastScrapeDuration)})`,
              },
              { label: t('Error'), getter: (tg: PromTarget) => tg.lastError || '-' },
            ]}
          />
        </>
      )}
    </SectionBox>
  );
}

function relabelSummary(ep: MonitorEndpoint) {
  const r = ep.relabelings?.length || 0;
  const m = ep.metricRelabelings?.length || 0;
  if (!r && !m) return '-';
  return (
    <Tooltip
      title={
        <Box component="pre" sx={{ m: 0, fontSize: 11 }}>
          {yaml.dump({ relabelings: ep.relabelings, metricRelabelings: ep.metricRelabelings })}
        </Box>
      }
    >
      <span>{`${r} / ${m}`}</span>
    </Tooltip>
  );
}

function authSummary(ep: MonitorEndpoint, t: (s: string) => string) {
  const parts: string[] = [];
  if (ep.basicAuth) parts.push(t('basic auth'));
  if (ep.authorization || ep.bearerTokenSecret) parts.push(t('bearer token'));
  if (ep.tlsConfig) parts.push(ep.tlsConfig.insecureSkipVerify ? t('TLS (insecure)') : 'TLS');
  return parts.join(', ') || '-';
}

function EndpointsSection({ endpoints }: { endpoints: MonitorEndpoint[] }) {
  const { t } = useText();
  return (
    <SectionBox title={t('Endpoints')}>
      <SimpleTable
        data={endpoints}
        emptyMessage={t('No endpoints')}
        columns={[
          {
            label: t('Port'),
            getter: (ep: MonitorEndpoint) => ep.port || (ep.portNumber ?? ep.targetPort ?? '-'),
          },
          { label: t('Path'), getter: (ep: MonitorEndpoint) => ep.path || '/metrics' },
          { label: t('Scheme'), getter: (ep: MonitorEndpoint) => ep.scheme || 'http' },
          { label: t('Interval'), getter: (ep: MonitorEndpoint) => ep.interval || t('default') },
          {
            label: t('Timeout'),
            getter: (ep: MonitorEndpoint) => ep.scrapeTimeout || t('default'),
          },
          { label: t('Auth / TLS'), getter: (ep: MonitorEndpoint) => authSummary(ep, t) },
          { label: t('Relabelings / metric'), getter: relabelSummary },
          {
            label: t('Honor labels'),
            getter: (ep: MonitorEndpoint) => (ep.honorLabels ? t('Yes') : t('No')),
            sort: false,
          },
        ]}
      />
    </SectionBox>
  );
}

/** Services (or Pods) currently matched by the monitor's selector, with port checks. */
function MatchedTargetsSection({
  item,
  kind,
}: {
  item: ServiceMonitor | PodMonitor;
  kind: 'ServiceMonitor' | 'PodMonitor';
}) {
  const { t } = useText();
  const spec = item.jsonData.spec || {};
  const nsSel = spec.namespaceSelector;
  const namespaces = nsSel?.any
    ? undefined
    : nsSel?.matchNames?.length
    ? nsSel.matchNames
    : [item.metadata.namespace!];
  const cls = kind === 'ServiceMonitor' ? K8s.ResourceClasses.Service : K8s.ResourceClasses.Pod;
  const [objects, error] = (cls as typeof K8s.ResourceClasses.Service).useList(
    namespaces ? { namespace: namespaces } : {}
  );
  const endpoints: MonitorEndpoint[] =
    (kind === 'ServiceMonitor'
      ? (item as ServiceMonitor).spec.endpoints
      : (item as PodMonitor).spec.podMetricsEndpoints) || [];
  const portNames = endpoints.map(e => e.port).filter(Boolean) as string[];

  const matched = (objects || []).filter(o =>
    serviceMonitorMatchesService(item.jsonData, o.jsonData)
  );
  const exposedPorts = (o: KubeObject): string[] => {
    const objSpec = o.jsonData.spec as
      | { ports?: NamedPort[]; containers?: Array<{ ports?: NamedPort[] }> }
      | undefined;
    const ports =
      kind === 'ServiceMonitor'
        ? objSpec?.ports || []
        : (objSpec?.containers || []).flatMap(c => c.ports || []);
    return ports.map(p => p.name).filter((n): n is string => !!n);
  };

  return (
    <SectionBox title={kind === 'ServiceMonitor' ? t('Matched services') : t('Matched pods')}>
      {error && <ApiErrorAlert error={error} />}
      <SimpleTable
        data={matched}
        emptyMessage={
          objects === null
            ? t('Loading…')
            : kind === 'ServiceMonitor'
            ? t('No Service matches the selector in the selected namespaces.')
            : t('No Pod matches the selector in the selected namespaces.')
        }
        columns={[
          {
            label: t('Name'),
            getter: (o: KubeObject) => <Link kubeObject={o}>{o.metadata.name}</Link>,
          },
          { label: t('Namespace'), getter: (o: KubeObject) => o.metadata.namespace },
          {
            label: t('Ports'),
            getter: (o: KubeObject) => {
              const exposed = exposedPorts(o);
              return (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {portNames.map(p =>
                    exposed.includes(p) ? (
                      <Chip key={p} size="small" color="success" variant="outlined" label={p} />
                    ) : (
                      <Tooltip key={p} title={t('Endpoint port not exposed by this object')}>
                        <Chip
                          size="small"
                          color="warning"
                          icon={<Icon icon="mdi:alert" />}
                          label={p}
                        />
                      </Tooltip>
                    )
                  )}
                  {!portNames.length && <TagList items={exposed} />}
                </Box>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}

// ---------------------------------------------------------------------------
// ServiceMonitor / PodMonitor
// ---------------------------------------------------------------------------

function monitorInfo(item: ServiceMonitor | PodMonitor, t: (s: string) => string) {
  const spec = item.spec;
  const targetLabels =
    item.jsonData.kind === 'ServiceMonitor'
      ? (item as ServiceMonitor).spec.targetLabels
      : undefined;
  return [
    { name: t('Job label'), value: spec.jobLabel || '-' },
    {
      name: t('Namespaces'),
      value: (
        <MonitorNamespaceSelectorDisplay
          selector={spec.namespaceSelector}
          ownNamespace={item.metadata.namespace}
        />
      ),
    },
    { name: t('Selector'), value: <SelectorDisplay selector={spec.selector} nilMeaning="all" /> },
    {
      name: t('Target labels'),
      value: <TagList items={targetLabels} />,
      hide: !targetLabels?.length,
    },
    {
      name: t('Pod target labels'),
      value: <TagList items={spec.podTargetLabels} />,
      hide: !spec.podTargetLabels?.length,
    },
    { name: t('Sample limit'), value: String(spec.sampleLimit), hide: !spec.sampleLimit },
  ];
}

export function ServiceMonitorDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={ServiceMonitor}
      extraInfo={item => monitorInfo(item, t)}
      sections={item => [
        {
          id: 'monitoring-endpoints',
          section: <EndpointsSection endpoints={item.spec.endpoints || []} />,
        },
        {
          id: 'monitoring-matched',
          section: <MatchedTargetsSection item={item} kind="ServiceMonitor" />,
        },
        { id: 'monitoring-selected-by', section: <SelectedBy kind="ServiceMonitor" item={item} /> },
        {
          id: 'monitoring-targets',
          section: (
            <LiveTargetsSection
              kind="ServiceMonitor"
              namespace={item.metadata.namespace!}
              name={item.metadata.name}
            />
          ),
        },
      ]}
    />
  );
}

export function PodMonitorDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={PodMonitor}
      extraInfo={item => monitorInfo(item, t)}
      sections={item => [
        {
          id: 'monitoring-endpoints',
          section: <EndpointsSection endpoints={item.spec.podMetricsEndpoints || []} />,
        },
        {
          id: 'monitoring-matched',
          section: <MatchedTargetsSection item={item} kind="PodMonitor" />,
        },
        { id: 'monitoring-selected-by', section: <SelectedBy kind="PodMonitor" item={item} /> },
        {
          id: 'monitoring-targets',
          section: (
            <LiveTargetsSection
              kind="PodMonitor"
              namespace={item.metadata.namespace!}
              name={item.metadata.name}
            />
          ),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Probe / ScrapeConfig
// ---------------------------------------------------------------------------

export function ProbeDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={Probe}
      extraInfo={item => [
        { name: t('Prober'), value: item.spec.prober?.url || '-' },
        { name: t('Module'), value: item.spec.module || '-' },
        { name: t('Interval'), value: item.spec.interval || t('default') },
        { name: t('Job name'), value: item.spec.jobName || '-' },
        {
          name: t('Static targets'),
          value: <TagList items={item.spec.targets?.staticConfig?.static} />,
        },
        {
          name: t('Ingress targets'),
          value: (
            <SelectorDisplay selector={item.spec.targets?.ingress?.selector} nilMeaning="all" />
          ),
          hide: !item.spec.targets?.ingress,
        },
      ]}
      sections={item => [
        { id: 'monitoring-selected-by', section: <SelectedBy kind="Probe" item={item} /> },
        {
          id: 'monitoring-targets',
          section: (
            <LiveTargetsSection
              kind="Probe"
              namespace={item.metadata.namespace!}
              name={item.metadata.name}
            />
          ),
        },
      ]}
    />
  );
}

export function ScrapeConfigDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={ScrapeConfig}
      extraInfo={item => {
        const sd = Object.keys(item.spec).filter(k => /SDConfigs$/.test(k));
        return [
          { name: t('Job name'), value: item.spec.jobName || '-' },
          { name: t('Metrics path'), value: item.spec.metricsPath || '/metrics' },
          { name: t('Scrape interval'), value: item.spec.scrapeInterval || t('default') },
          { name: t('Service discovery'), value: <TagList items={sd} />, hide: !sd.length },
          {
            name: t('Static targets'),
            value: (
              <TagList items={(item.spec.staticConfigs || []).flatMap(s => s.targets || [])} />
            ),
            hide: !item.spec.staticConfigs?.length,
          },
        ];
      }}
      sections={item => [
        {
          id: 'monitoring-spec',
          section: (
            <SectionBox title={t('Specification')}>
              <CodeBlock code={yaml.dump(item.spec)} maxHeight={400} />
            </SectionBox>
          ),
        },
        { id: 'monitoring-selected-by', section: <SelectedBy kind="ScrapeConfig" item={item} /> },
        {
          id: 'monitoring-targets',
          section: (
            <LiveTargetsSection
              kind="ScrapeConfig"
              namespace={item.metadata.namespace!}
              name={item.metadata.name}
            />
          ),
        },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// PrometheusRule
// ---------------------------------------------------------------------------

function RuleGroupsSection({ item }: { item: PrometheusRule }) {
  const { t } = useText();
  const prom = usePrometheusEndpoint();
  const live = usePolling(
    prom.baseUrl ? () => promRuleGroups(prom.baseUrl) : null,
    [prom.baseUrl],
    30_000
  );
  const liveGroups = useMemo(
    () =>
      ruleGroupsForRule(
        live.data || [],
        item.metadata.namespace!,
        item.metadata.name,
        item.metadata.uid
      ),
    [live.data, item]
  );
  const liveRule = (groupName: string, r: Rule): PromRule | undefined =>
    liveGroups.find(g => g.name === groupName)?.rules.find(lr => lr.name === (r.alert || r.record));
  const loaded = !!live.data && liveGroups.length > 0;

  return (
    <>
      {prom.baseUrl && live.data && !loaded && (
        <SectionBox title={t('Rule evaluation')}>
          <Typography color="text.secondary">
            {t('Prometheus {{name}} has not loaded these rules. Check the "Selected by" section.', {
              name: prom.instance?.metadata.name || '',
            })}
          </Typography>
        </SectionBox>
      )}
      {(item.spec.groups || []).map(g => (
        <SectionBox key={g.name} title={t('Group: {{name}}', { name: g.name })}>
          {g.interval && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('Evaluation interval: {{interval}}', { interval: g.interval })}
            </Typography>
          )}
          <SimpleTable
            data={g.rules || []}
            columns={[
              {
                label: t('Rule'),
                getter: (r: Rule) => (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {r.alert ? t('Alert') : t('Record')}
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {r.alert || r.record}
                    </Typography>
                  </Box>
                ),
              },
              {
                label: t('Severity'),
                getter: (r: Rule) =>
                  r.alert ? <SeverityChip severity={r.labels?.severity} /> : '-',
              },
              { label: t('For'), getter: (r: Rule) => r.for || '-' },
              {
                label: t('Expression'),
                getter: (r: Rule) => (
                  <Box sx={{ maxWidth: 520 }}>
                    <CodeBlock code={String(r.expr)} maxHeight={120} />
                  </Box>
                ),
              },
              {
                label: t('Live state'),
                getter: (r: Rule) => {
                  const lr = liveRule(g.name, r);
                  if (!lr) return '-';
                  return (
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        alignItems: 'flex-start',
                      }}
                    >
                      {lr.type === 'alerting' && <AlertStateChip state={lr.state} />}
                      <RuleHealthChip health={lr.health} error={lr.lastError} />
                    </Box>
                  );
                },
              },
              {
                label: t('Summary'),
                getter: (r: Rule) => (
                  <Typography variant="body2" sx={{ maxWidth: 360 }}>
                    {r.annotations?.summary ||
                      r.annotations?.description ||
                      r.annotations?.message ||
                      '-'}
                  </Typography>
                ),
              },
            ]}
          />
        </SectionBox>
      ))}
    </>
  );
}

export function PrometheusRuleDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={PrometheusRule}
      extraInfo={item => {
        const c = item.getRuleCount();
        return [
          { name: t('Groups'), value: String(item.spec.groups?.length || 0) },
          { name: t('Alerting rules'), value: String(c.alerts) },
          { name: t('Recording rules'), value: String(c.records) },
        ];
      }}
      sections={item => [
        { id: 'monitoring-selected-by', section: <SelectedBy kind="PrometheusRule" item={item} /> },
        { id: 'monitoring-groups', section: <RuleGroupsSection item={item} /> },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// AlertmanagerConfig
// ---------------------------------------------------------------------------

function RouteNode({ route, depth, isRoot }: { route: AMCRoute; depth: number; isRoot?: boolean }) {
  const { t } = useText();
  return (
    <Box
      sx={{
        borderLeft: depth ? 2 : 0,
        borderColor: 'divider',
        pl: depth ? 2 : 0,
        mt: depth ? 1 : 0,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <Icon icon={isRoot ? 'mdi:sitemap' : 'mdi:arrow-right'} />
        <Typography variant="body2" fontWeight={600}>
          {route.receiver || t('(inherited receiver)')}
        </Typography>
        {(route.matchers || []).map((m, i) => (
          <Chip
            key={i}
            size="small"
            variant="outlined"
            color="primary"
            label={formatAMCMatcher(m)}
          />
        ))}
        {route.continue && <Chip size="small" label={t('continue')} />}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 3 }}>
        {[
          route.groupBy?.length ? `${t('group by')}: ${route.groupBy.join(', ')}` : '',
          route.groupWait ? `${t('wait')}: ${route.groupWait}` : '',
          route.groupInterval ? `${t('interval')}: ${route.groupInterval}` : '',
          route.repeatInterval ? `${t('repeat')}: ${route.repeatInterval}` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      {(route.routes || []).map((r, i) => (
        <RouteNode key={i} route={r} depth={depth + 1} />
      ))}
    </Box>
  );
}

function SecretRef({
  namespace,
  sel,
  existing,
}: {
  namespace: string;
  sel: SecretKeySelector;
  existing: Set<string> | null;
}) {
  const { t } = useText();
  const missing = existing && !existing.has(sel.name);
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Link routeName="secret" params={{ namespace, name: sel.name }}>
        {sel.name}
      </Link>
      <Mono>[{sel.key}]</Mono>
      {missing && (
        <Tooltip title={t('Secret not found in this namespace')}>
          <span>
            <StatusChip tone="error" icon="mdi:alert-circle" label={t('missing')} />
          </span>
        </Tooltip>
      )}
    </Box>
  );
}

function isSecretSelector(v: unknown): v is SecretKeySelector {
  return !!v && typeof v === 'object' && 'name' in (v as object) && 'key' in (v as object);
}

function ReceiversSection({ item }: { item: AlertmanagerConfig }) {
  const { t } = useText();
  const ns = item.metadata.namespace!;
  const [secrets, secretsError] = K8s.ResourceClasses.Secret.useList({ namespace: ns });
  const existing = secrets && !secretsError ? new Set(secrets.map(s => s.metadata.name)) : null;
  const receivers = item.spec.receivers || [];
  return (
    <SectionBox title={t('Receivers')}>
      <SimpleTable
        data={receivers}
        emptyMessage={t('No receivers')}
        columns={[
          {
            label: t('Name'),
            getter: (r: AMCReceiver) => <Typography fontWeight={600}>{r.name}</Typography>,
          },
          {
            label: t('Integrations'),
            getter: (r: AMCReceiver) => {
              const types = receiverTypesOf(r);
              if (!types.length)
                return <Chip size="small" label={t('null (drops notifications)')} />;
              return (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {types.flatMap(rt =>
                    (r[rt.key] as Array<Record<string, unknown>>).map((cfg, i) => (
                      <Box
                        key={`${rt.key}-${i}`}
                        sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}
                      >
                        <Icon icon={rt.icon} style={{ marginTop: 3 }} />
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {rt.label}
                            {cfg.sendResolved === false
                              ? ` · ${t('no resolved notifications')}`
                              : ''}
                          </Typography>
                          {Object.entries(cfg)
                            .filter(([k]) => k !== 'sendResolved')
                            .map(([k, v]) => (
                              <Typography
                                key={k}
                                variant="caption"
                                display="block"
                                sx={{ wordBreak: 'break-word' }}
                              >
                                <strong>{k}:</strong>{' '}
                                {isSecretSelector(v) ? (
                                  <SecretRef namespace={ns} sel={v} existing={existing} />
                                ) : typeof v === 'object' ? (
                                  <Mono>{JSON.stringify(v)}</Mono>
                                ) : (
                                  String(v)
                                )}
                              </Typography>
                            ))}
                        </Box>
                      </Box>
                    ))
                  )}
                </Box>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}

export function AlertmanagerConfigDetails() {
  const { t } = useText();
  return (
    <DetailsPage
      resourceClass={AlertmanagerConfig}
      extraInfo={item => [
        {
          name: t('Receivers'),
          value: <TagList items={(item.spec.receivers || []).map(r => r.name)} />,
        },
        { name: t('Inhibit rules'), value: String(item.spec.inhibitRules?.length || 0) },
        {
          name: t('Time intervals'),
          value: (
            <TagList
              items={(item.spec.timeIntervals || item.spec.muteTimeIntervals || []).map(
                i => i.name
              )}
            />
          ),
          hide: !(item.spec.timeIntervals || item.spec.muteTimeIntervals)?.length,
        },
      ]}
      sections={item => [
        {
          id: 'monitoring-selected-by',
          section: <SelectedBy kind="AlertmanagerConfig" item={item} />,
        },
        {
          id: 'monitoring-route',
          section: (
            <SectionBox title={t('Routing tree')}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t(
                  'With the default OnNamespace strategy the operator adds namespace="{{nsName}}" to the root route.',
                  {
                    nsName: item.metadata.namespace,
                  }
                )}
              </Typography>
              {item.spec.route ? (
                <RouteNode route={item.spec.route} depth={0} isRoot />
              ) : (
                <Typography>-</Typography>
              )}
            </SectionBox>
          ),
        },
        { id: 'monitoring-receivers', section: <ReceiversSection item={item} /> },
        {
          id: 'monitoring-inhibit',
          section: item.spec.inhibitRules?.length ? (
            <SectionBox title={t('Inhibit rules')}>
              <SimpleTable
                data={item.spec.inhibitRules}
                columns={[
                  {
                    label: t('Source'),
                    getter: (r: AMCInhibitRule) => (
                      <TagList items={(r.sourceMatch || []).map(formatAMCMatcher)} />
                    ),
                  },
                  {
                    label: t('Target'),
                    getter: (r: AMCInhibitRule) => (
                      <TagList items={(r.targetMatch || []).map(formatAMCMatcher)} />
                    ),
                  },
                  { label: t('Equal'), getter: (r: AMCInhibitRule) => <TagList items={r.equal} /> },
                ]}
              />
            </SectionBox>
          ) : null,
        },
      ]}
    />
  );
}
