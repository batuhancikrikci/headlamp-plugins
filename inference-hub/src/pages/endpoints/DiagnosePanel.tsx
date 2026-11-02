import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EventJson } from '../../components/detail/EventsPanel';
import { fetchLogs } from '../../components/detail/LogsPanel';
import { CheckStatus, diagnose, Finding, LogSample } from '../../diagnostics/diagnose';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { LocalModelCacheJson } from '../../resources/catalog';
import { ModelEndpoint } from '../../resources/endpoint';
import { PodJson } from '../../resources/pod';

/** Pods whose logs are scanned at most; enough to find a failure that all replicas share. */
const MAX_LOG_PODS = 4;
const LOG_TAIL_LINES = 400;

const STATUS_META: Record<CheckStatus, { icon: string; color: string; label: string }> = {
  pass: { icon: 'mdi:check-circle', color: 'success.main', label: 'OK' },
  fail: { icon: 'mdi:close-circle', color: 'error.main', label: 'Problem' },
  warn: { icon: 'mdi:alert', color: 'warning.main', label: 'Warning' },
  progress: { icon: 'mdi:progress-clock', color: 'info.main', label: 'In progress' },
  unknown: { icon: 'mdi:help-circle-outline', color: 'text.secondary', label: 'Unknown' },
  skipped: { icon: 'mdi:minus-circle-outline', color: 'text.secondary', label: 'Skipped' },
};

const VERDICT_SEVERITY: Record<CheckStatus, 'success' | 'error' | 'warning' | 'info'> = {
  pass: 'success',
  fail: 'error',
  warn: 'warning',
  progress: 'info',
  unknown: 'info',
  skipped: 'info',
};

/** Containers worth scanning: the model server and the model download, previous instances too. */
function logTargets(pods: PodJson[]) {
  const servers = pods
    .filter(
      p => !(p.metadata.labels?.['app.kubernetes.io/component'] || '').endsWith('router-scheduler')
    )
    .slice(0, MAX_LOG_PODS);
  return servers.flatMap(pod => {
    const statuses = [
      ...(pod.status?.initContainerStatuses || []).filter(c => c.name === 'storage-initializer'),
      ...(pod.status?.containerStatuses || []),
    ];
    return statuses
      .filter(c => c.state?.running || c.state?.terminated || c.lastState?.terminated)
      .flatMap(c => [
        { pod, container: c.name, previous: false },
        ...(c.restartCount > 0 ? [{ pod, container: c.name, previous: true }] : []),
      ]);
  });
}

function FindingCard({
  finding,
  onOpenTab,
}: {
  finding: Finding;
  onOpenTab: (tab: string) => void;
}) {
  const meta = STATUS_META[finding.status];
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
        <Box sx={{ color: meta.color, pt: 0.25 }}>
          <Icon icon={meta.icon} width={22} />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle2">{t(finding.title)}</Typography>
            <Chip size="small" variant="outlined" label={t(meta.label)} />
          </Box>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t(finding.summary)}
          </Typography>
          {finding.evidence.length > 0 && (
            <Box
              component="pre"
              sx={{
                m: 0,
                mt: 1,
                p: 1,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                bgcolor: 'action.hover',
                borderRadius: 1,
                maxHeight: 180,
                overflow: 'auto',
              }}
            >
              {finding.evidence.join('\n')}
            </Box>
          )}
          {finding.hint && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              <Icon icon="mdi:lightbulb-on-outline" style={{ verticalAlign: 'text-bottom' }} />{' '}
              {t(finding.hint)}
            </Typography>
          )}
        </Box>
        {finding.tab && finding.status !== 'pass' && (
          <Button size="small" onClick={() => onOpenTab(finding.tab!)}>
            {t('Open {{tab}}', { tab: finding.tab })}
          </Button>
        )}
      </Box>
    </Paper>
  );
}

/**
 * "Diagnose" tab of an endpoint: walks the chain from the endpoint to its pods and router and
 * explains what blocks it. Logs are only read when the user asks for them.
 */
export function DiagnosePanel({
  endpoint,
  pods,
  podsForbidden,
  catalogServed,
  onOpenTab,
  children,
}: {
  endpoint: ModelEndpoint;
  pods: PodJson[];
  podsForbidden: boolean;
  catalogServed: boolean;
  onOpenTab: (tab: string) => void;
  /** Rendered below the findings with the diagnosis (e.g. "ask a model"). */
  children?: (diagnosis: ReturnType<typeof diagnose>, logs?: LogSample[]) => React.ReactNode;
}) {
  const cluster = useCurrentCluster();
  const events = useCoreList<EventJson>('v1', 'events', true, { namespace: endpoint.namespace });
  const catalog = useResourceList<LocalModelCacheJson>(
    'localmodelcaches',
    catalogServed ? {} : null,
    60000
  );
  const [logs, setLogs] = React.useState<LogSample[] | undefined>();
  const [scanning, setScanning] = React.useState(false);
  const [logError, setLogError] = React.useState<string | null>(null);

  const diagnosis = React.useMemo(
    () =>
      diagnose({
        endpoint,
        pods: podsForbidden ? null : pods,
        events: events.forbidden ? null : events.items,
        catalog: catalogServed && !catalog.forbidden ? catalog.items : null,
        logs,
        now: Date.now(),
      }),
    [
      endpoint,
      pods,
      podsForbidden,
      events.items,
      events.forbidden,
      catalog.items,
      catalog.forbidden,
      catalogServed,
      logs,
    ]
  );

  const scanLogs = async () => {
    setScanning(true);
    setLogError(null);
    const samples: LogSample[] = [];
    let denied = 0;
    for (const target of logTargets(pods)) {
      try {
        const text = await fetchLogs(
          cluster,
          target.pod,
          target.container,
          LOG_TAIL_LINES,
          target.previous
        );
        samples.push({
          pod: target.pod.metadata.name,
          container: target.container,
          previous: target.previous,
          text,
        });
      } catch (err) {
        if ((err as { status?: number }).status === 403) denied++;
      }
    }
    if (denied > 0 && samples.length === 0) {
      setLogError(t('You are not allowed to read the logs of these pods (pods/log).'));
    }
    setLogs(samples);
    setScanning(false);
  };

  const verdict = diagnosis.verdict;
  return (
    <SectionBox
      title={t('Diagnosis')}
      headerProps={{
        titleSideActions: [
          <Button
            key="logs"
            variant="outlined"
            size="small"
            disabled={scanning || pods.length === 0}
            startIcon={scanning ? <CircularProgress size={14} /> : <Icon icon="mdi:text-search" />}
            onClick={scanLogs}
          >
            {logs ? t('Scan the logs again') : t('Scan the logs')}
          </Button>,
        ],
      }}
    >
      <Alert severity={VERDICT_SEVERITY[verdict.status]} sx={{ mb: 2 }}>
        {t(verdict.summary)}
      </Alert>
      {logError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {logError}
        </Alert>
      )}
      {!logs && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t(
            'The logs are not read automatically. "Scan the logs" reads the last {{n}} lines of the model server and the model download (also of crashed instances) and looks for known failures.',
            { n: LOG_TAIL_LINES }
          )}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {diagnosis.findings.map(f => (
          <FindingCard key={f.id} finding={f} onOpenTab={onOpenTab} />
        ))}
      </Box>
      {children?.(diagnosis, logs)}
    </SectionBox>
  );
}
