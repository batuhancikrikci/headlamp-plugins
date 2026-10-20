import { Icon } from '@iconify/react';
import { SectionBox, SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Alert, Box } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import {
  EngineCharts,
  EnginesTable,
  EngineTiles,
  MetricsSourceNote,
} from '../../components/engines/EngineMetricsView';
import { MAX_SCRAPED_ENGINES, useEngineMetrics, useVllmEngines } from '../../hooks/useVllmEngines';
import { PodJson } from '../../resources/pod';
import { refreshMs, useSettings } from '../../settings/settings';

function EnginesContent() {
  const { engines, loading, forbidden, error } = useVllmEngines();
  const filterFunc = useFilterFunc<PodJson>(['.spec.containers[*].image']);
  const visible = React.useMemo(
    () => engines.filter(e => filterFunc(e.raw)),
    [engines, filterFunc]
  );
  const state = useEngineMetrics(visible);
  const settings = useSettings();

  let body: React.ReactNode;
  if (forbidden) {
    body = <ForbiddenState what={t('pods in all namespaces')} />;
  } else if (loading && engines.length === 0) {
    body = <LoadingState title={t('Looking for vLLM engines…')} />;
  } else if (error && engines.length === 0) {
    body = <ErrorState error={error} />;
  } else if (engines.length === 0) {
    body = (
      <EmptyState
        icon="mdi:engine-off-outline"
        title={t('No vLLM engines are running')}
        description={t(
          'Engines are detected from pods running vLLM images (vllm/vllm-openai, llm-d model servers), "vllm serve" commands and the KServe Hugging Face runtime. Deploy a model endpoint to see it here.'
        )}
      />
    );
  } else {
    body = (
      <>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <MetricsSourceNote
            state={state}
            intervalLabel={t('every {{s}} s', { s: refreshMs(settings) / 1000 })}
          />
        </Box>
        {state.source === 'none' && state.reason && (
          <Alert severity="info" sx={{ mb: 2 }} icon={<Icon icon="mdi:chart-line" />}>
            {t(state.reason)}
          </Alert>
        )}
        {state.skipped > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t(
              'Only the first {{max}} engines are read directly ({{n}} skipped). Configure Prometheus in Settings for large fleets.',
              { max: MAX_SCRAPED_ENGINES, n: state.skipped }
            )}
          </Alert>
        )}
        <EngineTiles engines={visible} state={state} />
        {state.source === 'prometheus' && (
          <Box sx={{ mb: 2 }}>
            <EngineCharts matcher={'namespace=~".+"'} />
          </Box>
        )}
        <EnginesTable engines={visible} state={state} />
      </>
    );
  }

  return <SectionBox title={<SectionFilterHeader title={t('vLLM Engines')} />}>{body}</SectionBox>;
}

export function VllmEnginesPage() {
  return (
    <DiscoveryGate title={t('vLLM Engines')}>
      <EnginesContent />
    </DiscoveryGate>
  );
}
