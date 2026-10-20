import { CommonComponents } from '@kinvolk/headlamp-plugin/lib';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../common/i18n';
import { ApiErrorAlert } from '../components/common/Feedback';
import { ChipFilter, FilterBar, SearchField, textMatches } from '../components/common/Filters';
import { EndpointGate, InstanceBar } from '../components/common/InstanceBar';
import { TargetHealthChip } from '../components/common/StatusChip';
import { usePrometheusEndpoint } from '../hooks/useMonitoringEndpoint';
import { usePolling } from '../hooks/usePolling';
import { useQueryParam } from '../hooks/useQueryParam';
import { detailsRouteName } from '../resources/crds';
import { refreshIntervalMs, useMonitoringSettings } from '../settings';
import { PromTarget } from '../types';
import { formatSeconds, timeAgo } from '../utils/duration';
import { promTargets } from '../utils/monitoringApi';
import { summarizeTargets } from '../utils/relations';

const { SectionBox, SimpleTable, Link } = CommonComponents;

const POOL_KINDS: Record<string, { plural: string; kind: string }> = {
  serviceMonitor: { plural: 'servicemonitors', kind: 'ServiceMonitor' },
  podMonitor: { plural: 'podmonitors', kind: 'PodMonitor' },
  probe: { plural: 'probes', kind: 'Probe' },
  scrapeConfig: { plural: 'scrapeconfigs', kind: 'ScrapeConfig' },
};

/** Maps an operator generated scrape pool back to the resource that produced it. */
export function parseScrapePool(
  pool: string
): { kind: string; plural: string; namespace: string; name: string } | null {
  const [prefix, namespace, name] = pool.split('/');
  const k = POOL_KINDS[prefix];
  if (!k || !namespace || !name) return null;
  return { ...k, namespace, name };
}

export function ScrapePoolSource({ pool }: { pool: string }) {
  const src = parseScrapePool(pool);
  if (!src) {
    return (
      <Typography variant="body2" color="text.secondary">
        {pool}
      </Typography>
    );
  }
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {src.kind}
      </Typography>
      <Link
        routeName={detailsRouteName(src.plural)}
        params={{ namespace: src.namespace, name: src.name }}
      >
        {src.namespace}/{src.name}
      </Link>
    </Box>
  );
}

const IMPORTANT_LABELS = ['job', 'namespace', 'service', 'pod', 'instance'];

export function TargetLabels({ labels }: { labels: Record<string, string> }) {
  const entries = Object.entries(labels);
  const important = entries.filter(([k]) => IMPORTANT_LABELS.includes(k));
  const all = entries.map(([k, v]) => `${k}="${v}"`).join('\n');
  return (
    <Tooltip
      title={
        <Box component="pre" sx={{ m: 0, fontSize: 11 }}>
          {all}
        </Box>
      }
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 420 }}>
        {important.map(([k, v]) => (
          <Chip key={k} size="small" variant="outlined" label={`${k}=${v}`} />
        ))}
        {entries.length > important.length && (
          <Chip size="small" label={`+${entries.length - important.length}`} />
        )}
      </Box>
    </Tooltip>
  );
}

export default function Targets() {
  const { t } = useText();
  const settings = useMonitoringSettings();
  const prom = usePrometheusEndpoint();
  const targets = usePolling(
    prom.baseUrl ? () => promTargets(prom.baseUrl) : null,
    [prom.baseUrl],
    refreshIntervalMs(settings)
  );

  const [search, setSearch] = useQueryParam('q');
  const [healthParam, setHealthParam] = useQueryParam('health');
  const healths = healthParam ? healthParam.split(',') : [];

  const all = targets.data || [];
  const summary = summarizeTargets(all);
  const filtered = all.filter(
    tg =>
      (healths.length === 0 || healths.includes(tg.health)) &&
      textMatches(
        search,
        tg.scrapePool,
        tg.scrapeUrl,
        tg.lastError,
        ...Object.values(tg.labels || {})
      )
  );

  const gate = <EndpointGate kind="Prometheus" ep={prom} />;
  const blocked = prom.loading || prom.error || prom.notFound || !prom.baseUrl;

  return (
    <SectionBox title={t('Targets')}>
      {blocked ? (
        gate
      ) : (
        <>
          <InstanceBar
            kind="Prometheus"
            ep={prom}
            onRefresh={targets.refresh}
            refreshing={targets.refreshing}
            lastUpdated={targets.lastUpdated}
          />
          <ApiErrorAlert error={targets.error} onRetry={targets.refresh} />
          <FilterBar>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t('Search endpoints, labels, errors')}
            />
            <ChipFilter
              ariaLabel={t('Health')}
              options={[
                { value: 'up', label: t('Up'), count: summary.up },
                { value: 'down', label: t('Down'), count: summary.down },
                { value: 'unknown', label: t('Unknown'), count: summary.unknown },
              ]}
              selected={healths}
              onChange={v => setHealthParam(v.join(','))}
            />
          </FilterBar>
          <SimpleTable
            data={filtered}
            reflectInURL="targets"
            emptyMessage={targets.loading ? t('Loading…') : t('No targets match the filters.')}
            columns={[
              {
                label: t('Health'),
                getter: (tg: PromTarget) => (
                  <TargetHealthChip health={tg.health} error={tg.lastError} />
                ),
                sort: (a: PromTarget, b: PromTarget) => a.health.localeCompare(b.health),
              },
              {
                label: t('Endpoint'),
                getter: (tg: PromTarget) => (
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                  >
                    {tg.scrapeUrl}
                  </Typography>
                ),
              },
              {
                label: t('Source'),
                getter: (tg: PromTarget) => <ScrapePoolSource pool={tg.scrapePool} />,
                sort: (a: PromTarget, b: PromTarget) => a.scrapePool.localeCompare(b.scrapePool),
              },
              {
                label: t('Labels'),
                getter: (tg: PromTarget) => <TargetLabels labels={tg.labels || {}} />,
              },
              {
                label: t('Last scrape'),
                getter: (tg: PromTarget) =>
                  `${timeAgo(tg.lastScrape)} (${formatSeconds(tg.lastScrapeDuration)})`,
              },
              {
                label: t('Error'),
                getter: (tg: PromTarget) =>
                  tg.lastError ? (
                    <Typography
                      variant="body2"
                      color="error"
                      sx={{ maxWidth: 360, wordBreak: 'break-word' }}
                    >
                      {tg.lastError}
                    </Typography>
                  ) : (
                    '-'
                  ),
              },
            ]}
          />
        </>
      )}
    </SectionBox>
  );
}
