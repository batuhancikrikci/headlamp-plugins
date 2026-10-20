import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import {
  EngineCharts,
  EnginesTable,
  EngineTiles,
  MetricsSourceNote,
} from '../../components/engines/EngineMetricsView';
import { useEngineMetrics } from '../../hooks/useVllmEngines';
import { ModelEndpoint } from '../../resources/endpoint';
import { detectEngines } from '../../resources/engine';
import { PodJson } from '../../resources/pod';
import { podMatcher } from '../../utils/vllmMetrics';

/** Live serving metrics of the vLLM engines behind one endpoint. */
export function EndpointMetrics({ endpoint, pods }: { endpoint: ModelEndpoint; pods: PodJson[] }) {
  const engines = React.useMemo(() => detectEngines(pods), [pods]);
  const state = useEngineMetrics(engines);

  if (engines.length === 0) {
    return (
      <SectionBox title={t('Serving metrics')}>
        <EmptyState
          dense
          icon="mdi:chart-line-variant"
          title={t('No vLLM engine pods')}
          description={
            endpoint.status.health === 'stopped'
              ? t('The endpoint is stopped.')
              : t('Metrics appear when the model server pods run a vLLM based image.')
          }
        />
      </SectionBox>
    );
  }

  return (
    <SectionBox title={t('Serving metrics')}>
      <Box sx={{ mb: 2 }}>
        <MetricsSourceNote state={state} />
      </Box>
      {state.source === 'none' && state.reason && (
        <Alert severity="info" sx={{ mb: 2 }} icon={<Icon icon="mdi:chart-line" />}>
          {t(state.reason)}
        </Alert>
      )}
      <EngineTiles engines={engines} state={state} />
      {state.source === 'prometheus' && (
        <Box sx={{ mb: 2 }}>
          <EngineCharts
            matcher={podMatcher(
              endpoint.namespace,
              engines.map(e => e.pod)
            )}
          />
        </Box>
      )}
      <EnginesTable engines={engines} state={state} showEndpoint={false} />
    </SectionBox>
  );
}
