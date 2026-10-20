import { Icon } from '@iconify/react';
import { Link, NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip } from '@mui/material';
import React from 'react';
import { t } from '../common/i18n';
import { MetricsSourceNote } from '../components/engines/EngineMetricsView';
import { useEngineMetrics } from '../hooks/useVllmEngines';
import { podRole } from '../resources/endpoint';
import { detectEngine, VllmEngine } from '../resources/engine';
import { PodJson } from '../resources/pod';
import { DETAIL_PAGES } from '../routes';
import { featuresOf, useSettings } from '../settings/settings';
import { formatPercent, formatRate, formatSeconds } from '../utils/vllmMetrics';

function EngineLive({ engine }: { engine: VllmEngine }) {
  const engines = React.useMemo(() => [engine], [engine]);
  const state = useEngineMetrics(engines);
  const m = state.metrics.get(engine.key);
  const error = state.errors.get(engine.key);
  return (
    <>
      <NameValueTable
        rows={[
          {
            name: t('Requests running / waiting'),
            value: m
              ? `${m.running ?? '—'} / ${m.waiting ?? '—'}`
              : error
              ? t('Unreachable: {{e}}', { e: error })
              : '—',
          },
          { name: t('KV cache usage'), value: formatPercent(m?.kvCachePercent) },
          { name: t('Time to first token'), value: formatSeconds(m?.ttftSeconds) },
          { name: t('Inter-token latency'), value: formatSeconds(m?.itlSeconds) },
          { name: t('Generated tokens / s'), value: formatRate(m?.generationTps) },
          { name: t('Prefix cache hit rate'), value: formatPercent(m?.prefixHitPercent) },
        ]}
      />
      <Box sx={{ mt: 1 }}>
        <MetricsSourceNote state={state} />
      </Box>
    </>
  );
}

function PodAiBody({ pod }: { pod: PodJson }) {
  const engine = React.useMemo(() => detectEngine(pod), [pod]);
  const labels = pod.metadata.labels || {};
  const endpoint =
    engine?.endpoint ||
    (labels['app.kubernetes.io/part-of'] === 'llminferenceservice' &&
    labels['app.kubernetes.io/name']
      ? { slug: 'llm' as const, name: labels['app.kubernetes.io/name'] }
      : labels['serving.kserve.io/inferenceservice']
      ? { slug: 'isvc' as const, name: labels['serving.kserve.io/inferenceservice'] }
      : undefined);
  if (!engine && !endpoint) return null;

  return (
    <SectionBox title={t('AI workload (Inference Hub)')}>
      <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          color="primary"
          icon={<Icon icon="mdi:brain" />}
          label={podRole(labels)}
        />
        {engine && (
          <Chip
            size="small"
            variant="outlined"
            icon={<Icon icon="simple-icons:vllm" />}
            label={`${engine.flavor === 'kserve-hf' ? t('KServe HF runtime') : 'vLLM'} ${
              engine.version || ''
            }`}
          />
        )}
      </Box>
      <NameValueTable
        rows={[
          {
            name: t('Model endpoint'),
            value: endpoint ? (
              <Link
                routeName={DETAIL_PAGES.endpoint.name}
                params={{
                  slug: endpoint.slug,
                  namespace: pod.metadata.namespace || '',
                  name: endpoint.name,
                }}
              >
                {endpoint.name}
              </Link>
            ) : (
              '—'
            ),
          },
          { name: t('Served model'), value: engine?.servedModelName || '—', hide: !engine },
          {
            name: t('Engine port'),
            value: engine ? `${engine.container}:${engine.port} (${engine.scheme})` : '—',
            hide: !engine,
          },
        ]}
      />
      {engine && pod.status?.phase === 'Running' && <EngineLive engine={engine} />}
    </SectionBox>
  );
}

/** Registered with registerDetailsViewSection; renders nothing for pods that are not AI workloads. */
export function PodAiSection({
  resource,
}: {
  resource: { kind?: string; jsonData?: unknown } | null;
}) {
  const settings = useSettings();
  if (!resource || resource.kind !== 'Pod' || !featuresOf(settings).podAiSection) return null;
  return <PodAiBody pod={resource.jsonData as PodJson} />;
}
