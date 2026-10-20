import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Grid, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Discovery, isServed } from '../../api/discovery';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { SummaryTiles } from '../../components/common/SummaryTiles';
import { UsageBar } from '../../components/common/UsageBar';
import { EventJson } from '../../components/detail/EventsPanel';
import { docsTargets } from '../../components/docs/docsTargets';
import { MetricsSourceNote } from '../../components/engines/EngineMetricsView';
import { useCatalog } from '../../hooks/useCatalog';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { EngineMetricsState, useEngineMetrics, useVllmEngines } from '../../hooks/useVllmEngines';
import { ModelEndpoint } from '../../resources/endpoint';
import { VllmEngine } from '../../resources/engine';
import { totals } from '../../resources/gpu';
import { InferencePoolJson, normalizePool } from '../../resources/inference';
import { deployUrl, PAGES } from '../../routes';
import { aggregate, formatRate, VllmMetrics } from '../../utils/vllmMetrics';
import { Header } from './Header';
import { aiWarnings, healthCounts, platformStatus, trafficByEndpoint } from './overview';
import {
  AttentionList,
  COMMAND_CENTER_LINKS,
  HealthBar,
  Panel,
  TrafficTable,
  WarningsList,
} from './Panels';
import { PlatformReadiness } from './PlatformReadiness';

function GpuPanel() {
  const fleet = useGpuFleet();
  const sum = totals(fleet.nodes);
  const utils = fleet.metrics
    ? Array.from(fleet.metrics.values())
        .flatMap(m => m.gpus.map(g => g.util))
        .filter((v): v is number => v !== undefined)
    : [];
  const busy = utils.filter(u => u >= 5).length;
  const avg = utils.length ? utils.reduce((s, v) => s + v, 0) / utils.length : undefined;

  let body: React.ReactNode;
  if (fleet.nodesForbidden)
    body = (
      <Typography variant="body2" color="text.secondary">
        {t('You cannot list nodes.')}
      </Typography>
    );
  else if (!fleet.loading && fleet.nodes.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary">
        {t('No GPU nodes in this cluster.')}
      </Typography>
    );
  } else {
    body = (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t('Requested of schedulable devices')}
          </Typography>
          <UsageBar
            used={fleet.podsForbidden ? 0 : sum.requested}
            total={Math.max(1, sum.allocatable)}
            width="fill"
            label={fleet.podsForbidden ? t('unknown') : `${sum.requested} / ${sum.allocatable}`}
          />
        </Box>
        <Box>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t('GPUs busy (utilization ≥ 5%)')}
          </Typography>
          {utils.length ? (
            <UsageBar
              used={busy}
              total={utils.length}
              width="fill"
              label={`${busy} / ${utils.length}`}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('Needs DCGM metrics in Prometheus.')}
            </Typography>
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t('{{n}} GPU nodes · {{p}} physical GPUs', { n: sum.nodes, p: sum.physical })}
          {avg !== undefined && ` · ${t('average utilization {{u}}%', { u: Math.round(avg) })}`}
        </Typography>
      </Box>
    );
  }
  return (
    <Panel
      title={t('GPU capacity')}
      icon="mdi:expansion-card-variant"
      to={COMMAND_CENTER_LINKS.gpu}
    >
      {body}
    </Panel>
  );
}

function TrafficPanel({
  engines,
  state,
  endpoints,
}: {
  engines: VllmEngine[];
  state: EngineMetricsState;
  endpoints: ModelEndpoint[];
}) {
  const rows = React.useMemo(
    () => trafficByEndpoint(engines, state.metrics, endpoints),
    [engines, state.metrics, endpoints]
  );
  return (
    <Panel
      title={t('Top models by traffic')}
      icon="mdi:chart-bar"
      to={COMMAND_CENTER_LINKS.engines}
    >
      <Box sx={{ mb: 1 }}>
        <MetricsSourceNote state={state} />
      </Box>
      {engines.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('No vLLM engines are running.')}
        </Typography>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {state.reason ? t(state.reason) : t('Waiting for engine metrics…')}
        </Typography>
      ) : (
        <TrafficTable rows={rows} />
      )}
    </Panel>
  );
}

function WarningsPanel() {
  const { endpoints } = useEndpoints();
  const events = useCoreList<EventJson>(
    'v1',
    'events',
    true,
    { fieldSelector: 'type=Warning' },
    30000
  );
  const warnings = React.useMemo(
    () => aiWarnings(events.items, endpoints),
    [events.items, endpoints]
  );
  return (
    <Panel title={t('Recent warnings')} icon="mdi:alert-outline">
      {events.forbidden ? (
        <Typography variant="body2" color="text.secondary">
          {t('You cannot list events in all namespaces.')}
        </Typography>
      ) : (
        <WarningsList events={warnings} />
      )}
    </Panel>
  );
}

function CatalogPanel() {
  const catalog = useCatalog();
  const count = (h: string) => catalog.entries.filter(e => e.health.health === h).length;
  return (
    <Panel title={t('Model catalog')} icon="mdi:bookshelf" to={COMMAND_CENTER_LINKS.catalog}>
      <Typography variant="h5">{catalog.entries.length}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('{{c}} fully cached · {{d}} downloading · {{f}} with errors', {
          c: count('ready'),
          d: count('progressing'),
          f: count('failed'),
        })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t('{{n}} deployed', { n: catalog.entries.filter(e => e.users.length > 0).length })}
      </Typography>
    </Panel>
  );
}

function RoutingPanel() {
  const pools = useResourceList<InferencePoolJson>('inferencepools', {}, 60000);
  const normalized = pools.items.map(normalizePool);
  const failed = normalized.filter(p => p.health.health === 'failed').length;
  return (
    <Panel
      title={t('Inference routing')}
      icon="mdi:scale-balance"
      to={COMMAND_CENTER_LINKS.gateway}
    >
      <Typography variant="h5">{normalized.length}</Typography>
      <Typography variant="body2" color={failed ? 'error.main' : 'text.secondary'}>
        {normalized.length === 0
          ? t('No inference pools yet')
          : failed
          ? t('{{n}} inference pool(s) with problems', { n: failed })
          : t('Inference pools without reported problems')}
      </Typography>
    </Panel>
  );
}

function Overview({ discovery }: { discovery: Discovery }) {
  const history = useHistory();
  const state = useDiscovery();
  const { endpoints, notInstalled } = useEndpoints();
  const counts = healthCounts(endpoints);
  const fleet = useGpuFleet({ withMetrics: false });
  const gpu = totals(fleet.nodes);
  const { engines } = useVllmEngines();
  const engineState = useEngineMetrics(engines);
  const load: VllmMetrics = aggregate(Array.from(engineState.metrics.values()));
  const catalogServed = isServed(discovery, 'localmodelcaches');
  const poolsServed = isServed(discovery, 'inferencepools');

  return (
    // Padding keeps the banner and the last panel clear of the window edges.
    <Box sx={{ pt: 2, pb: 8 }}>
      <SectionBox>
        <Header
          summary={
            notInstalled
              ? t('Model serving on Kubernetes with KServe, llm-d, vLLM and NVIDIA GPUs')
              : t('{{e}} model endpoints · {{v}} vLLM engines · {{n}} GPU nodes', {
                  e: endpoints.length,
                  v: engines.length,
                  n: gpu.nodes,
                })
          }
          status={platformStatus(counts, notInstalled)}
          actions={
            <>
              <DocsDrawer
                iconOnly
                targets={docsTargets(discovery, ['llminferenceservices', 'inferenceservices'])}
              />
              <Button
                variant="contained"
                startIcon={<Icon icon="mdi:rocket-launch-outline" />}
                disabled={notInstalled}
                onClick={() => history.push(deployUrl())}
              >
                {t('Deploy model')}
              </Button>
            </>
          }
        />
        <SummaryTiles
          tiles={[
            {
              id: 'ready',
              label: t('Endpoints ready'),
              value: `${counts.ready}/${endpoints.length}`,
              icon: 'mdi:check-circle-outline',
              color: 'success.main',
              onClick: () => history.push(Router.createRouteURL(PAGES.endpoints.name)),
            },
            {
              id: 'failed',
              label: t('Endpoints failing'),
              value: counts.failed,
              icon: 'mdi:alert-circle-outline',
              color: counts.failed ? 'error.main' : 'text.secondary',
            },
            {
              id: 'gpus',
              label: t('GPUs requested'),
              value: fleet.podsForbidden ? '—' : `${gpu.requested}/${gpu.allocatable}`,
              icon: 'mdi:expansion-card-variant',
              color: 'primary.main',
            },
            {
              id: 'tps',
              label: t('Tokens / s'),
              value: formatRate(load.generationTps, ''),
              icon: 'mdi:speedometer',
              color: 'text.secondary',
            },
            {
              id: 'running',
              label: t('Requests in flight'),
              value: load.running ?? '—',
              icon: 'mdi:play-circle-outline',
              color: 'info.main',
            },
            {
              id: 'waiting',
              label: t('Requests queued'),
              value: load.waiting ?? '—',
              icon: 'mdi:timer-sand',
              color: (load.waiting || 0) > 0 ? 'warning.main' : 'text.secondary',
            },
          ]}
        />

        {notInstalled ? (
          <EmptyState
            icon="mdi:rocket-launch-outline"
            title={t('No model serving platform detected')}
            description={t(
              'Install KServe to deploy models. The readiness checks below show what is missing.'
            )}
          />
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12} lg={6}>
              <Panel
                title={t('Model endpoints')}
                icon="mdi:api"
                to={COMMAND_CENTER_LINKS.endpoints}
              >
                {endpoints.length === 0 ? (
                  <EmptyState
                    dense
                    icon="mdi:rocket-launch-outline"
                    title={t('No endpoints yet')}
                    action={
                      <Button variant="outlined" onClick={() => history.push(deployUrl())}>
                        {t('Deploy your first model')}
                      </Button>
                    }
                  />
                ) : (
                  <>
                    <HealthBar counts={counts} />
                    <AttentionList endpoints={endpoints} />
                  </>
                )}
              </Panel>
            </Grid>
            <Grid item xs={12} lg={6}>
              <GpuPanel />
            </Grid>
            <Grid item xs={12} lg={6}>
              <TrafficPanel engines={engines} state={engineState} endpoints={endpoints} />
            </Grid>
            <Grid item xs={12} lg={6}>
              <WarningsPanel />
            </Grid>
            {/* A lone panel takes the whole row so the grid stays balanced. */}
            {catalogServed && (
              <Grid item xs={12} lg={poolsServed ? 6 : 12}>
                <CatalogPanel />
              </Grid>
            )}
            {poolsServed && (
              <Grid item xs={12} lg={catalogServed ? 6 : 12}>
                <RoutingPanel />
              </Grid>
            )}
          </Grid>
        )}
      </SectionBox>
      <PlatformReadiness
        discovery={discovery}
        onRescan={state.rescan}
        rescanning={state.status === 'ready' && state.rescanning}
      />
    </Box>
  );
}

export function CommandCenter() {
  return (
    <DiscoveryGate title={t('Command Center')}>
      {discovery => <Overview discovery={discovery} />}
    </DiscoveryGate>
  );
}
