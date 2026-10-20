import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, Typography } from '@mui/material';
import React, { useMemo } from 'react';
import { useText } from '../common/i18n';
import { TargetHealthChip } from '../components/common/StatusChip';
import { usePrometheusEndpoint } from '../hooks/useMonitoringEndpoint';
import { usePolling } from '../hooks/usePolling';
import { PodMonitor, ServiceMonitor } from '../resources/crds';
import { PromTarget } from '../types';
import { promTargets } from '../utils/monitoringApi';
import { serviceMonitorMatchesService, targetsForResource } from '../utils/relations';

const { SectionBox, SimpleTable, Link } = CommonComponents;

interface Row {
  monitor: ServiceMonitor | PodMonitor;
  targets: PromTarget[];
}

/**
 * Appended to Headlamp's Service and Pod details pages: which ServiceMonitors /
 * PodMonitors scrape this object and the health of the resulting targets.
 * Renders nothing when the object is not monitored.
 */
function MonitoredBy({ resource, kind }: { resource: KubeObject; kind: 'Service' | 'Pod' }) {
  const { t } = useText();
  const monitorClass = kind === 'Service' ? ServiceMonitor : PodMonitor;
  const [monitors] = (monitorClass as typeof ServiceMonitor).useList();
  const matching = useMemo(
    () => (monitors || []).filter(m => serviceMonitorMatchesService(m.jsonData, resource.jsonData)),
    [monitors, resource]
  );
  const prom = usePrometheusEndpoint();
  const targets = usePolling(
    prom.baseUrl && matching.length ? () => promTargets(prom.baseUrl) : null,
    [prom.baseUrl, matching.length],
    60_000
  );

  if (!matching.length) return null;

  const podName = kind === 'Pod' ? resource.metadata.name : null;
  const svcName = kind === 'Service' ? resource.metadata.name : null;
  const rows: Row[] = matching.map(m => {
    const all = targetsForResource(
      targets.data || [],
      m.kind,
      m.metadata.namespace!,
      m.metadata.name
    );
    // Narrow to the targets that belong to this very object.
    const own = all.filter(tg =>
      podName
        ? tg.labels.pod === podName
        : svcName
        ? tg.labels.service === svcName && tg.labels.namespace === resource.metadata.namespace
        : true
    );
    return { monitor: m, targets: own };
  });

  return (
    <SectionBox title={t('Monitoring')}>
      <SimpleTable
        data={rows}
        columns={[
          {
            label: kind === 'Service' ? t('ServiceMonitor') : t('PodMonitor'),
            getter: (r: Row) => (
              <Link kubeObject={r.monitor}>
                {r.monitor.metadata.namespace}/{r.monitor.metadata.name}
              </Link>
            ),
          },
          {
            label: t('Targets'),
            getter: (r: Row) =>
              !prom.baseUrl ? (
                '-'
              ) : targets.loading ? (
                t('Loading…')
              ) : r.targets.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('No active targets (not selected by Prometheus?)')}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {r.targets.map(tg => (
                    <Box key={tg.scrapeUrl} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TargetHealthChip health={tg.health} error={tg.lastError} />
                      <Typography
                        variant="body2"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                      >
                        {tg.scrapeUrl}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ),
          },
        ]}
      />
    </SectionBox>
  );
}

export default function MonitoredBySection({ resource }: { resource: KubeObject | null }) {
  const kind = resource?.kind;
  if (!resource || (kind !== 'Service' && kind !== 'Pod')) return null;
  return <MonitoredBy resource={resource} kind={kind} />;
}
