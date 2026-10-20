import { Icon } from '@iconify/react';
import { CommonComponents, K8s, Router } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  LinearProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import React, { useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { useText } from '../common/i18n';
import { CodeBlock } from '../components/common/CodeBlock';
import { ApiErrorAlert } from '../components/common/Feedback';
import {
  SeverityChip,
  severityTone,
  StatusChip,
  WorkloadHealthChip,
} from '../components/common/StatusChip';
import { getServedVersions, useCrdAvailability, useNamespaceLabels } from '../hooks/useClusterData';
import { useAlertmanagerEndpoint, usePrometheusEndpoint } from '../hooks/useMonitoringEndpoint';
import { usePolling } from '../hooks/usePolling';
import { WorkloadObject } from '../hooks/useWorkloads';
import {
  Alertmanager,
  AlertmanagerConfig,
  ConfigResource,
  listRouteName,
  MONITORING_GROUP,
  PodMonitor,
  Probe,
  Prometheus,
  PrometheusAgent,
  PrometheusRule,
  ScrapeConfig,
  ServiceMonitor,
  ThanosRuler,
} from '../resources/crds';
import { refreshIntervalMs, useMonitoringSettings } from '../settings';
import { ConfigResourceStatus, PromAlert, PromTarget, WorkloadStatus } from '../types';
import { timeAgo } from '../utils/duration';
import { amSilences, promAlerts, promRuntimeInfo, promTargets } from '../utils/monitoringApi';
import { SelectableKind, summarizeTargets, workloadSelects } from '../utils/relations';
import { ScrapePoolSource } from './Targets';

const { SectionBox, SimpleTable, Link } = CommonComponents;

// ─── Model ──────────────────────────────────────────────────────────────────

type Health = 'healthy' | 'problem' | 'unknown';

type Translate = ReturnType<typeof useText>['t'];

/** Any object listed on the overview: a workload or a configuration resource. */
type MonitoringItem = WorkloadObject | ConfigResource;

interface KindSummary {
  kind: string;
  plural: string;
  label: string;
  icon: string;
  /** Workloads report Available; configuration resources report "selected". */
  role: 'workload' | 'config';
  items: MonitoringItem[] | null;
  error: unknown;
  /** Health of one item plus a human readable reason when it is not healthy. */
  health: (item: MonitoringItem) => { health: Health; reason?: string; notSelected?: boolean };
}

function workloadHealth(item: MonitoringItem): { health: Health; reason?: string } {
  const h = 'getHealth' in item ? item.getHealth() : 'Unknown';
  if (h === 'Available' || h === 'Paused') return { health: 'healthy' };
  const status = item.jsonData.status as WorkloadStatus | undefined;
  const available = status?.conditions?.find(c => c.type === 'Available');
  if (h === 'Degraded') {
    return { health: 'problem', reason: available?.message || available?.reason || 'Degraded' };
  }
  if (h === 'Reconciling') return { health: 'unknown', reason: 'Reconciling' };
  // PrometheusAgent has no getHealth(): fall back to its Available condition.
  if (available?.status === 'True') return { health: 'healthy' };
  if (available && available.status !== 'True') {
    return { health: 'problem', reason: available.message || available.reason };
  }
  return { health: 'unknown' };
}

function useSummaries(t: Translate): KindSummary[] {
  const nsLabels = useNamespaceLabels();
  const [proms, promsErr] = Prometheus.useList();
  const [agents, agentsErr] = PrometheusAgent.useList();
  const [ams, amsErr] = Alertmanager.useList();
  const [rulers, rulersErr] = ThanosRuler.useList();
  const [sms, smsErr] = ServiceMonitor.useList();
  const [pms, pmsErr] = PodMonitor.useList();
  const [probes, probesErr] = Probe.useList();
  const [scs, scsErr] = ScrapeConfig.useList();
  const [rules, rulesErr] = PrometheusRule.useList();
  const [amcs, amcsErr] = AlertmanagerConfig.useList();

  return useMemo(() => {
    const scrapers = [...(proms || []), ...(agents || [])];
    const evaluators = [...(proms || []), ...(rulers || [])];
    const selected =
      (kind: SelectableKind, workloads: WorkloadObject[]) => (item: MonitoringItem) => {
        const status = item.jsonData.status as ConfigResourceStatus | undefined;
        const rejected = (status?.bindings || [])
          .flatMap(b => b.conditions || [])
          .find(c => c.type === 'Accepted' && c.status === 'False');
        if (rejected) {
          return { health: 'problem' as Health, reason: rejected.message || rejected.reason };
        }
        const results = workloads.map(w =>
          workloadSelects(w.jsonData, kind, item.jsonData, nsLabels)
        );
        if (results.includes('selected')) return { health: 'healthy' as Health };
        if (results.includes('unknown')) return { health: 'unknown' as Health };
        return {
          health: 'problem' as Health,
          reason: t('Not selected by any workload: it has no effect.'),
          notSelected: true,
        };
      };
    return [
      {
        kind: 'Prometheus',
        plural: 'prometheuses',
        label: t('Prometheuses'),
        icon: 'mdi:database',
        role: 'workload',
        items: proms,
        error: promsErr,
        health: workloadHealth,
      },
      {
        kind: 'Alertmanager',
        plural: 'alertmanagers',
        label: t('Alertmanagers'),
        icon: 'mdi:email-alert',
        role: 'workload',
        items: ams,
        error: amsErr,
        health: workloadHealth,
      },
      {
        kind: 'ServiceMonitor',
        plural: 'servicemonitors',
        label: t('Service Monitors'),
        icon: 'mdi:eye-outline',
        role: 'config',
        items: sms,
        error: smsErr,
        health: selected('ServiceMonitor', scrapers),
      },
      {
        kind: 'PodMonitor',
        plural: 'podmonitors',
        label: t('Pod Monitors'),
        icon: 'mdi:cube-outline',
        role: 'config',
        items: pms,
        error: pmsErr,
        health: selected('PodMonitor', scrapers),
      },
      {
        kind: 'Probe',
        plural: 'probes',
        label: t('Probes'),
        icon: 'mdi:radar',
        role: 'config',
        items: probes,
        error: probesErr,
        health: selected('Probe', scrapers),
      },
      {
        kind: 'ScrapeConfig',
        plural: 'scrapeconfigs',
        label: t('Scrape Configs'),
        icon: 'mdi:file-code-outline',
        role: 'config',
        items: scs,
        error: scsErr,
        health: selected('ScrapeConfig', scrapers),
      },
      {
        kind: 'PrometheusRule',
        plural: 'prometheusrules',
        label: t('Prometheus Rules'),
        icon: 'mdi:format-list-checks',
        role: 'config',
        items: rules,
        error: rulesErr,
        health: selected('PrometheusRule', evaluators),
      },
      {
        kind: 'AlertmanagerConfig',
        plural: 'alertmanagerconfigs',
        label: t('Alertmanager Configs'),
        icon: 'mdi:bell-cog',
        role: 'config',
        items: amcs,
        error: amcsErr,
        health: selected('AlertmanagerConfig', ams || []),
      },
      {
        kind: 'PrometheusAgent',
        plural: 'prometheusagents',
        label: t('Prometheus Agents'),
        icon: 'mdi:robot-outline',
        role: 'workload',
        items: agents,
        error: agentsErr,
        health: workloadHealth,
      },
      {
        kind: 'ThanosRuler',
        plural: 'thanosrulers',
        label: t('Thanos Rulers'),
        icon: 'mdi:gavel',
        role: 'workload',
        items: rulers,
        error: rulersErr,
        health: workloadHealth,
      },
    ] as KindSummary[];
    // t is included so labels refresh once plugin translations are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    t,
    nsLabels,
    proms,
    agents,
    ams,
    rulers,
    sms,
    pms,
    probes,
    scs,
    rules,
    amcs,
    promsErr,
    agentsErr,
    amsErr,
    rulersErr,
    smsErr,
    pmsErr,
    probesErr,
    scsErr,
    rulesErr,
    amcsErr,
  ]);
}

function counts(s: KindSummary) {
  const c = { total: 0, healthy: 0, problem: 0, unknown: 0 };
  for (const i of s.items || []) {
    c.total++;
    c[s.health(i).health]++;
  }
  return c;
}

// ─── Resource count cards ───────────────────────────────────────────────────

function ResourceCard({ summary }: { summary: KindSummary }) {
  const { t } = useText();
  const history = useHistory();
  const loading = summary.items === null && !summary.error;
  const c = counts(summary);
  const okLabel = summary.role === 'workload' ? t('available') : t('selected');

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea
        sx={{ height: '100%' }}
        onClick={() => history.push(Router.createRouteURL(listRouteName(summary.plural)))}
        aria-label={t('Open {{kind}}', { kind: summary.label })}
      >
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'action.hover',
              color: 'primary.main',
              flexShrink: 0,
            }}
          >
            <Icon icon={summary.icon} width={28} height={28} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            {loading ? (
              <CircularProgress size={24} />
            ) : (
              <Typography variant="h4" component="p" fontWeight={700}>
                {summary.error ? '—' : c.total}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" noWrap>
              {summary.label}
            </Typography>
            {!loading && !summary.error && c.total > 0 && (
              <Typography variant="caption" color={c.problem ? 'warning.main' : 'success.main'}>
                {c.healthy}/{c.total} {okLabel}
              </Typography>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

// ─── Health by kind ─────────────────────────────────────────────────────────

function HealthByKind({ summaries }: { summaries: KindSummary[] }) {
  const { t } = useText();
  const rows = summaries.map(s => ({ s, ...counts(s) }));
  type Row = (typeof rows)[number];
  return (
    <SectionBox title={t('Health by Resource Type')}>
      <SimpleTable
        data={rows}
        columns={[
          {
            label: t('Resource'),
            getter: (r: Row) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon icon={r.s.icon} width={18} height={18} />
                <Link routeName={listRouteName(r.s.plural)}>{r.s.label}</Link>
              </Box>
            ),
          },
          { label: t('Total'), getter: (r: Row) => (r.s.error ? '—' : r.total) },
          {
            label: t('Healthy'),
            getter: (r: Row) => {
              if (r.s.error) return t('Unavailable');
              if (r.total === 0) return '-';
              const pct = Math.round((r.healthy / r.total) * 100);
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    color={pct === 100 ? 'success' : 'warning'}
                    sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
                    aria-label={t('{{kind}} healthy ratio', { kind: r.s.label })}
                  />
                  <Typography variant="caption">{pct}%</Typography>
                </Box>
              );
            },
          },
          {
            label: t('Problems'),
            getter: (r: Row) =>
              r.problem > 0 ? <Chip size="small" color="error" label={r.problem} /> : r.problem,
          },
          { label: t('Unknown'), getter: (r: Row) => r.unknown },
        ]}
      />
      <Typography variant="caption" color="text.secondary">
        {t(
          'Workloads are healthy when Available; configuration resources when a workload selects them and the operator accepted them.'
        )}
      </Typography>
    </SectionBox>
  );
}

// ─── Live status (Prometheus / Alertmanager APIs) ───────────────────────────

const SEVERITIES = ['critical', 'warning', 'info', 'none'];

interface LiveData {
  alerts: PromAlert[];
  targets: PromTarget[];
  reloadOk: boolean | null;
  lastConfig?: string;
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <Box sx={{ flex: '1 1 110px', minWidth: 110 }}>
      <Typography variant="h5" component="p" fontWeight={700} color={tone}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function LiveStatus({
  live,
  loading,
  error,
  silences,
  hasPrometheus,
  hasAlertmanager,
}: {
  live?: LiveData;
  loading: boolean;
  error: unknown;
  silences?: number;
  hasPrometheus: boolean;
  hasAlertmanager: boolean;
}) {
  const { t } = useText();
  const firing = (live?.alerts || []).filter(a => a.state === 'firing');
  const pending = (live?.alerts || []).filter(a => a.state === 'pending').length;
  const targets = summarizeTargets(live?.targets || []);
  const bySeverity = SEVERITIES.map(sev => ({
    sev,
    count: firing.filter(a => {
      const s = (a.labels.severity || 'none').toLowerCase();
      return sev === 'none' ? !['critical', 'warning', 'info'].includes(s) : s === sev;
    }).length,
  }));

  return (
    <SectionBox title={t('Live Status')}>
      {!hasPrometheus ? (
        <Typography variant="body2" color="text.secondary">
          {t('No Prometheus instance reachable; live data is unavailable.')}
        </Typography>
      ) : loading && !live ? (
        <CircularProgress size={24} />
      ) : (
        <>
          <ApiErrorAlert error={error} />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
            <StatTile
              label={t('Firing alerts')}
              value={firing.length}
              tone={firing.length ? 'error.main' : 'success.main'}
            />
            <StatTile
              label={t('Pending alerts')}
              value={pending}
              tone={pending ? 'warning.main' : undefined}
            />
            <StatTile
              label={t('Targets up')}
              value={`${targets.up}/${targets.total}`}
              tone={targets.down ? 'warning.main' : 'success.main'}
            />
            <StatTile
              label={t('Active silences')}
              value={hasAlertmanager ? silences ?? '–' : '—'}
            />
          </Box>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('Firing alerts by severity')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            {bySeverity.map(({ sev, count }) => (
              <Box key={sev} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ width: 110, flexShrink: 0 }}>
                  <SeverityChip severity={sev} />
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={firing.length ? (count / firing.length) * 100 : 0}
                  color={
                    severityTone(sev) === 'default'
                      ? 'inherit'
                      : (severityTone(sev) as 'error' | 'warning' | 'info')
                  }
                  sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
                  aria-label={t('{{severity}} share', { severity: sev })}
                />
                <Typography variant="body2" sx={{ width: 32, textAlign: 'right' }}>
                  {count}
                </Typography>
              </Box>
            ))}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {live?.reloadOk === false ? (
              <StatusChip
                tone="error"
                icon="mdi:alert-circle"
                label={t('Configuration reload failed')}
              />
            ) : live?.reloadOk ? (
              <StatusChip
                tone="success"
                icon="mdi:check-circle"
                variant="outlined"
                label={t('Configuration loaded {{ago}} ago', { ago: timeAgo(live.lastConfig) })}
              />
            ) : null}
            <Link routeName="monitoring-alerting">{t('Open alerting')}</Link>
            <Link routeName="monitoring-targets">{t('Open targets')}</Link>
          </Box>
        </>
      )}
    </SectionBox>
  );
}

// ─── Components (workloads) ─────────────────────────────────────────────────

function Components({ summaries }: { summaries: KindSummary[] }) {
  const { t } = useText();
  const rows = summaries
    .filter(s => s.role === 'workload')
    // Workload summaries only list workloads.
    .flatMap(s => (s.items || []).map(item => ({ s, item: item as WorkloadObject })));
  type Row = (typeof rows)[number];
  return (
    <SectionBox title={t('Components')}>
      <SimpleTable
        data={rows}
        emptyMessage={t('No Prometheus or Alertmanager resources found.')}
        columns={[
          {
            label: t('Name'),
            getter: (r: Row) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Icon icon={r.s.icon} width={18} height={18} />
                <Link kubeObject={r.item}>{r.item.metadata.name}</Link>
              </Box>
            ),
          },
          {
            label: t('Type'),
            getter: (r: Row) => <Chip size="small" variant="outlined" label={r.s.kind} />,
          },
          { label: t('Namespace'), getter: (r: Row) => r.item.metadata.namespace },
          {
            label: t('Status'),
            getter: (r: Row) =>
              'getHealth' in r.item ? (
                <WorkloadHealthChip health={r.item.getHealth()} />
              ) : (
                <WorkloadHealthChip
                  health={workloadHealth(r.item).health === 'healthy' ? 'Available' : 'Unknown'}
                />
              ),
          },
          {
            label: t('Replicas'),
            getter: (r: Row) =>
              `${r.item.jsonData.status?.availableReplicas ?? 0}/${
                r.item.jsonData.spec?.replicas ?? 1
              }`,
          },
          {
            label: t('Version'),
            getter: (r: Row) => r.item.jsonData.spec?.version || t('operator default'),
          },
          { label: t('Retention'), getter: (r: Row) => r.item.jsonData.spec?.retention || '-' },
        ]}
      />
    </SectionBox>
  );
}

// ─── Needs attention ────────────────────────────────────────────────────────

interface Problem {
  id: string;
  /** Errors break monitoring; warnings are resources that currently have no effect. */
  severity: 'error' | 'warning';
  resource: React.ReactNode;
  type: string;
  namespace: string;
  reason: React.ReactNode;
}

/** Everything that needs attention; shared by the header status and the table. */
function collectProblems(
  summaries: KindSummary[],
  live: LiveData | undefined,
  t: Translate
): Problem[] {
  const problems: Problem[] = [];

  for (const s of summaries) {
    for (const item of s.items || []) {
      const h = s.health(item);
      if (h.health !== 'problem') continue;
      problems.push({
        id: `${s.kind}/${item.metadata.uid}`,
        severity: h.notSelected ? 'warning' : 'error',
        resource: (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon icon="mdi:alert-circle-outline" width={18} height={18} />
            <Link kubeObject={item}>{item.metadata.name}</Link>
          </Box>
        ),
        type: s.kind,
        namespace: item.metadata.namespace || '-',
        reason: h.reason || '-',
      });
    }
  }

  // Down scrape targets, one row per scrape pool.
  const pools = new Map<string, PromTarget[]>();
  for (const tg of live?.targets || []) {
    if (tg.health !== 'down') continue;
    pools.set(tg.scrapePool, [...(pools.get(tg.scrapePool) || []), tg]);
  }
  for (const [pool, down] of pools) {
    const total = (live?.targets || []).filter(tg => tg.scrapePool === pool).length;
    problems.push({
      id: `pool/${pool}`,
      severity: 'error',
      resource: <ScrapePoolSource pool={pool} />,
      type: t('Scrape targets'),
      namespace: pool.split('/')[1] || '-',
      reason: (
        <Box>
          <StatusChip
            tone="error"
            label={t('{{down}}/{{total}} down', { down: down.length, total })}
          />
          {down[0].lastError && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, wordBreak: 'break-word' }}
            >
              {down[0].lastError}
            </Typography>
          )}
        </Box>
      ),
    });
  }

  if (live?.reloadOk === false) {
    problems.push({
      id: 'prometheus-reload',
      severity: 'error',
      resource: <Link routeName={listRouteName('prometheuses')}>Prometheus</Link>,
      type: 'Prometheus',
      namespace: '-',
      reason: t('Prometheus failed to reload its configuration'),
    });
  }

  // Errors first, so the table leads with what is actually broken.
  return problems.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1));
}

function NeedsAttention({ problems }: { problems: Problem[] }) {
  const { t } = useText();

  return (
    <SectionBox title={t('Needs Attention')}>
      {problems.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'success.main' }}>
          <Icon icon="mdi:check-circle" />
          <Typography variant="body2">
            {t(
              'All workloads are available, every configuration resource is selected and all targets are up.'
            )}
          </Typography>
        </Box>
      ) : (
        <SimpleTable
          data={problems}
          columns={[
            { label: t('Resource'), getter: (p: Problem) => p.resource },
            {
              label: t('Severity'),
              getter: (p: Problem) =>
                p.severity === 'error' ? (
                  <StatusChip tone="error" label={t('Error')} />
                ) : (
                  <StatusChip tone="warning" label={t('Warning')} variant="outlined" />
                ),
            },
            { label: t('Type'), getter: (p: Problem) => p.type },
            { label: t('Namespace'), getter: (p: Problem) => p.namespace },
            { label: t('Reason'), getter: (p: Problem) => p.reason },
          ]}
        />
      )}
    </SectionBox>
  );
}

// ─── Firing alerts ──────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
  success: 3,
  default: 4,
};

function FiringAlerts({ live, hasPrometheus }: { live?: LiveData; hasPrometheus: boolean }) {
  const { t } = useText();
  if (!hasPrometheus) return null;
  const firing = (live?.alerts || [])
    .filter(a => a.state === 'firing')
    .sort(
      (a, b) =>
        SEVERITY_RANK[severityTone(a.labels.severity)] -
          SEVERITY_RANK[severityTone(b.labels.severity)] ||
        new Date(a.activeAt || 0).getTime() - new Date(b.activeAt || 0).getTime()
    );
  const shown = firing.slice(0, 10);
  return (
    <SectionBox title={t('Firing Alerts')}>
      <SimpleTable
        data={shown}
        emptyMessage={live ? t('No alerts are firing.') : t('Loading…')}
        columns={[
          {
            label: t('Alert'),
            getter: (a: PromAlert) => (
              <Typography variant="body2" fontWeight={600}>
                {a.labels.alertname}
              </Typography>
            ),
          },
          {
            label: t('Severity'),
            getter: (a: PromAlert) => <SeverityChip severity={a.labels.severity} />,
          },
          { label: t('Namespace'), getter: (a: PromAlert) => a.labels.namespace || '-' },
          {
            label: t('Summary'),
            getter: (a: PromAlert) => (
              <Typography variant="body2" sx={{ maxWidth: 520 }}>
                {a.annotations?.summary ||
                  a.annotations?.message ||
                  a.annotations?.description ||
                  '-'}
              </Typography>
            ),
          },
          { label: t('Active for'), getter: (a: PromAlert) => timeAgo(a.activeAt) },
        ]}
      />
      {firing.length > shown.length && (
        <Box sx={{ mt: 1 }}>
          <Link routeName="monitoring-alerting" search={{ state: 'firing' }}>
            {t('Show all {{count}} firing alerts', { count: firing.length })}
          </Link>
        </Box>
      )}
    </SectionBox>
  );
}

// ─── Recently created ───────────────────────────────────────────────────────

function RecentActivity({ summaries }: { summaries: KindSummary[] }) {
  const { t } = useText();
  const recent = summaries
    .flatMap(s => (s.items || []).map(item => ({ s, item })))
    .filter(r => !!r.item.metadata.creationTimestamp)
    .sort(
      (a, b) =>
        new Date(b.item.metadata.creationTimestamp).getTime() -
        new Date(a.item.metadata.creationTimestamp).getTime()
    )
    .slice(0, 10);
  type Row = (typeof recent)[number];
  return (
    <SectionBox title={t('Recently Created')}>
      <SimpleTable
        data={recent}
        emptyMessage={t('No monitoring resources found.')}
        columns={[
          {
            label: t('Name'),
            getter: (r: Row) => <Link kubeObject={r.item}>{r.item.metadata.name}</Link>,
          },
          {
            label: t('Type'),
            getter: (r: Row) => <Chip size="small" variant="outlined" label={r.s.kind} />,
          },
          { label: t('Namespace'), getter: (r: Row) => r.item.metadata.namespace || '-' },
          { label: t('Age'), getter: (r: Row) => timeAgo(r.item.metadata.creationTimestamp) },
        ]}
      />
    </SectionBox>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

/**
 * Page header (same layout as the Cilium plugin): icon badge, title with
 * version chips, where the stack runs, and the overall health on the right.
 */
function Header({
  prometheus,
  versions,
  problems,
  loading,
  notInstalled,
}: {
  prometheus: Prometheus | null;
  versions: string[];
  problems: Problem[];
  loading: boolean;
  notInstalled: boolean;
}) {
  const { t } = useText();
  const errors = problems.filter(p => p.severity === 'error').length;
  const warnings = problems.length - errors;
  const tone: 'error' | 'warning' | 'success' =
    notInstalled || (errors === 0 && warnings > 0) ? 'warning' : errors > 0 ? 'error' : 'success';
  const status = notInstalled
    ? t('Not installed')
    : problems.length === 0
    ? t('Healthy')
    : [
        errors ? t('{{count}} error(s)', { count: errors }) : '',
        warnings ? t('{{count}} warning(s)', { count: warnings }) : '',
      ]
        .filter(Boolean)
        .join(' · ');
  const version = prometheus?.spec.version;
  const namespace = prometheus?.metadata.namespace;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        background: theme =>
          `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(
            theme.palette.primary.main,
            0
          )} 60%)`,
      }}
    >
      <Box
        sx={theme => ({
          width: 56,
          height: 56,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          bgcolor: alpha(theme.palette.primary.main, 0.14),
          color: theme.palette.primary.main,
        })}
      >
        <Icon icon="mdi:chart-line" width={31} height={31} />
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {t('Monitoring')}
          </Typography>
          {version && (
            <Tooltip title={t('Prometheus version')}>
              <Chip label={version} size="small" color="primary" />
            </Tooltip>
          )}
          {versions.map(v => (
            <Chip key={v} size="small" variant="outlined" label={v} />
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary" component="div">
          {namespace ? (
            <>
              {t('Running in namespace')}{' '}
              <Link routeName="namespace" params={{ name: namespace }}>
                {namespace}
              </Link>
            </>
          ) : (
            t(
              'Prometheus Operator workloads, scrape configuration, rules and alert routing (kube-prometheus-stack).'
            )
          )}
        </Typography>
      </Box>
      {loading && !notInstalled ? (
        <CircularProgress size={20} aria-label={t('Loading')} />
      ) : (
        <Chip
          icon={
            <Icon icon={tone === 'success' ? 'mdi:check-circle' : 'mdi:alert-circle'} width={18} />
          }
          label={status}
          color={tone}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      )}
    </Paper>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function Overview() {
  const { t } = useText();
  const cluster = K8s.useCluster();
  const settings = useMonitoringSettings();
  const interval = refreshIntervalMs(settings);
  const available = useCrdAvailability();
  const prom = usePrometheusEndpoint();
  const am = useAlertmanagerEndpoint();
  const summaries = useSummaries(t);

  const live = usePolling<LiveData>(
    prom.baseUrl
      ? async () => {
          const [alerts, targets, runtime] = await Promise.all([
            promAlerts(prom.baseUrl),
            promTargets(prom.baseUrl),
            promRuntimeInfo(prom.baseUrl).catch(() => null),
          ]);
          return {
            alerts,
            targets,
            reloadOk: runtime ? runtime.reloadConfigSuccess : null,
            lastConfig: runtime?.lastConfigTime,
          };
        }
      : null,
    [prom.baseUrl],
    interval
  );
  const silences = usePolling(
    am.baseUrl ? () => amSilences(am.baseUrl) : null,
    [am.baseUrl],
    interval
  );

  // Belt and braces: if any monitoring list returned objects, the CRDs exist,
  // whatever discovery said.
  const anyListed = summaries.some(s => (s.items?.length || 0) > 0);
  const notInstalled = !!available && available.size === 0 && !anyListed;
  const visible = summaries.filter(s => !available || available.has(s.plural));
  const versions = getServedVersions(cluster);

  const problems = collectProblems(visible, live.data, t);
  // Until the first list answers there is nothing to judge health on.
  const loading = summaries.every(s => s.items === null && !s.error);

  return (
    // Bottom padding keeps the last section clear of the window edge.
    <Box sx={{ pb: 8 }}>
      <Box sx={{ display: 'grid', gap: 2, px: { xs: 1, md: 2 }, pt: 2, pb: 1 }}>
        <Header
          prometheus={prom.instance}
          versions={versions}
          problems={problems}
          loading={loading}
          notInstalled={notInstalled}
        />

        {notInstalled ? (
          <Alert severity="warning">
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t(
                'The {{group}} API group was not found on this cluster. Install kube-prometheus-stack, for example with Helm:',
                {
                  group: MONITORING_GROUP,
                }
              )}
            </Typography>
            <CodeBlock
              code={
                'helm repo add prometheus-community https://prometheus-community.github.io/helm-charts\n' +
                'helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \\\n' +
                '  --namespace monitoring --create-namespace'
              }
            />
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {visible.map(s => (
              <Grid item xs={12} sm={6} md={4} xl={12 / 5} key={s.kind}>
                <ResourceCard summary={s} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {!notInstalled && (
        <>
          <Grid container spacing={0} columnSpacing={2}>
            <Grid item xs={12} lg={7}>
              <HealthByKind summaries={visible} />
            </Grid>
            <Grid item xs={12} lg={5}>
              <LiveStatus
                live={live.data}
                loading={live.loading || prom.loading}
                error={live.error}
                silences={silences.data?.filter(s => s.status.state === 'active').length}
                hasPrometheus={!!prom.baseUrl}
                hasAlertmanager={!!am.baseUrl}
              />
            </Grid>
          </Grid>

          <NeedsAttention problems={problems} />
          <FiringAlerts live={live.data} hasPrometheus={!!prom.baseUrl} />
          <Components summaries={visible} />
          <RecentActivity summaries={visible} />
        </>
      )}
    </Box>
  );
}
