import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { PrometheusEndpoint } from '../../api/prometheus';
import { t } from '../../common/i18n';
import { CopyableCode } from '../../components/common/CopyableCode';
import { toYaml } from '../../components/common/YamlEditorDialog';
import { endpointIdOf, PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { EndpointSlug } from '../../resources/endpoint';
import { endpointEditUrl } from '../../routes';
import {
  inClusterPrometheus,
  meetsGoal,
  recommendedLevel,
  scalingAdvice,
  scalingSpec,
  SweepGoal,
  SweepLevel,
} from '../../utils/sweep';

const ms = (v?: number) =>
  v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
const num = (v?: number, digits = 1) => (v === undefined ? '—' : v.toFixed(digits));

/**
 * Results of a concurrency sweep: one row per level, the highest level within the goal, and the
 * autoscaling settings that keep each replica at about that load.
 */
export function SweepResults({
  target,
  levels,
  goal,
  replicas,
  expectedPeak,
  prometheus,
  stopped,
}: {
  target: PlaygroundTarget;
  levels: SweepLevel[];
  goal: SweepGoal;
  /** Model server pods that served the sweep. */
  replicas: number;
  expectedPeak?: number;
  prometheus?: PrometheusEndpoint;
  stopped: boolean;
}) {
  const history = useHistory();
  const best = recommendedLevel(levels, goal);
  const advice = best ? scalingAdvice(best.concurrency, replicas, expectedPeak) : undefined;
  const [slug, namespace, name] = endpointIdOf(target).split('/');
  const kind =
    slug === 'llm' ? 'LLMInferenceService' : slug === 'isvc' ? 'InferenceService' : undefined;
  const maxReplicas = advice?.replicasForPeak ?? Math.max(2, replicas);

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t('Concurrency sweep')}
        {stopped && (
          <Typography component="span" variant="body2" color="warning.main" sx={{ ml: 1 }}>
            {t('(stopped early)')}
          </Typography>
        )}
      </Typography>
      <SimpleTable
        data={levels}
        columns={[
          {
            label: t('Concurrency'),
            getter: (l: SweepLevel) => (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {l.concurrency}
                {best?.concurrency === l.concurrency && (
                  <Chip size="small" color="primary" label={t('Recommended')} />
                )}
              </Box>
            ),
          },
          { label: t('TTFT p95'), getter: (l: SweepLevel) => ms(l.summary.ttftMs.p95) },
          { label: t('Latency p95'), getter: (l: SweepLevel) => ms(l.summary.e2eMs.p95) },
          { label: t('Tokens/s in total'), getter: (l: SweepLevel) => num(l.summary.totalTps) },
          {
            label: t('Requests/s'),
            getter: (l: SweepLevel) => num(l.summary.requestsPerSecond, 2),
          },
          {
            label: t('Failed'),
            getter: (l: SweepLevel) =>
              `${l.summary.failed} (${num(l.summary.errorRate * 100, 0)}%)`,
          },
          {
            label: t('Within the goal'),
            getter: (l: SweepLevel) => {
              const ok = meetsGoal(l, goal);
              return (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    color: ok ? 'success.main' : 'error.main',
                  }}
                >
                  <Icon icon={ok ? 'mdi:check-circle' : 'mdi:close-circle'} width={16} />
                  <Typography variant="body2" color="text.primary">
                    {ok ? t('Yes') : t('No')}
                  </Typography>
                </Box>
              );
            },
          },
        ]}
      />
      {!best ? (
        <Alert severity="warning">
          {t(
            'Even the lowest level missed the goal (TTFT p95 {{ttft}}, at most {{errors}}% failed). Lower the prompt or answer size, or give the model more GPUs.',
            { ttft: ms(goal.ttftP95Ms), errors: num(goal.maxErrorRate * 100, 0) }
          )}
        </Alert>
      ) : (
        advice && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2">
              {t(
                'Up to {{c}} concurrent requests met the goal on {{r}} model server pod(s): about {{n}} per replica.',
                { c: best.concurrency, r: Math.max(1, replicas), n: advice.perReplica }
              )}{' '}
              {advice.replicasForPeak !== undefined &&
                t('An expected peak of {{peak}} concurrent requests needs {{replicas}} replicas.', {
                  peak: expectedPeak,
                  replicas: advice.replicasForPeak,
                })}
            </Typography>
            {kind && (
              <>
                <Typography variant="body2" color="text.secondary">
                  {kind === 'LLMInferenceService'
                    ? t(
                        'Autoscaling that keeps each replica near this load: a KEDA trigger on the running and waiting requests of the decode pods (spec.scaling.keda needs KServe 0.21 or later and KEDA). Review the query and the Prometheus address, then add it with Edit YAML.'
                      )
                    : t(
                        'Autoscaling that keeps each replica near this load: the concurrency target of the predictor, used by the Knative autoscaler (Serverless deployment mode). Add it with Edit YAML.'
                      )}
                </Typography>
                <CopyableCode
                  code={toYaml({
                    spec: scalingSpec(
                      kind,
                      { namespace, name },
                      advice,
                      1,
                      maxReplicas,
                      inClusterPrometheus(prometheus)
                    ),
                  })}
                  maxHeight={320}
                />
                <Box>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Icon icon="mdi:file-document-edit-outline" />}
                    onClick={() =>
                      history.push(
                        `${endpointEditUrl(
                          slug as EndpointSlug,
                          namespace,
                          name
                        )}?scaleMin=1&scaleMax=${maxReplicas}`
                      )
                    }
                  >
                    {t('Open the edit form with 1–{{max}} replicas', { max: maxReplicas })}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        )
      )}
    </Paper>
  );
}
