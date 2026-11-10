import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { KubeJson } from '../../resources/types';
import { formatBytes, parseQuantity } from '../../utils/quantity';
import {
  checkQuotas,
  ClusterQueueJson,
  hasDefaultCpuLimit,
  kueueQueues,
  LocalQueueJson,
  QuotaJson,
  QuotaRow,
  usageOfPods,
} from '../../utils/quotaCheck';
import { DeployForm } from './deployModel';
import { EditingEndpoint } from './stepTypes';

const QUEUE_LABEL = 'kueue.x-k8s.io/queue-name';

/** Model server pods the deployment creates at least, and at most with autoscaling. */
export function podCounts(form: DeployForm): { min: number; max: number } {
  const prefill = form.mode === 'llm' && form.prefillDecode ? form.prefillReplicas : 0;
  const min = (form.autoscale ? Math.max(1, form.minReplicas) : form.replicas) + prefill;
  const max =
    (form.autoscale ? Math.max(form.maxReplicas, form.minReplicas) : form.replicas) + prefill;
  return { min, max: Math.max(min, max) };
}

function endpointSelector(editing: EditingEndpoint): string {
  return editing.kind === 'LLMInferenceService'
    ? `app.kubernetes.io/part-of=llminferenceservice,app.kubernetes.io/name=${editing.name}`
    : `serving.kserve.io/inferenceservice=${editing.name}`;
}

function formatAmount(resource: string, value: number): string {
  if (resource.endsWith('memory')) return formatBytes(value, 0);
  return String(Math.round(value * 100) / 100);
}

const VERDICT_TEXT: Record<QuotaRow['verdict'], string> = {
  ok: 'Fits',
  'max-exceeds': 'Fits, but not at the autoscaling maximum',
  exceeds: 'Does not fit',
  'needs-limit': 'Pods need a CPU limit',
};

/**
 * ResourceQuota and Kueue check of the namespace the model is deployed to. Warning only: the
 * deployment is never blocked.
 */
export function QuotaCheck({ form, editing }: { form: DeployForm; editing?: EditingEndpoint }) {
  const namespace = form.namespace;
  const opts = namespace ? { namespace } : null;
  const quotas = useCoreList<QuotaJson>('v1', 'resourcequotas', true, opts, 30000);
  const limitRanges = useCoreList<KubeJson>('v1', 'limitranges', true, opts, 60000);
  const ownPods = useCoreList<KubeJson>(
    'v1',
    'pods',
    true,
    editing && namespace ? { namespace, labelSelector: endpointSelector(editing) } : null,
    30000
  );
  const localQueues = useResourceList<LocalQueueJson>('localqueues', opts, 30000);
  const clusterQueues = useResourceList<ClusterQueueJson>(
    'clusterqueues',
    localQueues.items.length > 0 ? {} : null,
    30000
  );

  if (!namespace) return null;

  const counts = podCounts(form);
  const pod = {
    cpu: parseQuantity(form.cpu) || 0,
    memory: parseQuantity(form.memory) || 0,
    gpuResource: form.gpuResource,
    gpus: form.gpus,
  };
  const own = editing ? usageOfPods(ownPods.items as never) : {};
  const check = checkQuotas(
    quotas.items,
    pod,
    counts,
    own,
    hasDefaultCpuLimit(limitRanges.items as never)
  );
  const queues = kueueQueues(
    localQueues.items,
    clusterQueues.forbidden ? null : clusterQueues.items,
    form.gpuResource
  );

  const worst = check.rows.some(r => r.verdict === 'exceeds' || r.verdict === 'needs-limit')
    ? 'error'
    : check.rows.some(r => r.verdict === 'max-exceeds')
    ? 'warning'
    : 'success';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2">{t('Namespace quota')}</Typography>
      {quotas.forbidden ? (
        <Alert severity="info">
          {t('You cannot list ResourceQuotas in {{ns}}, so the quota cannot be checked.', {
            ns: namespace,
          })}
        </Alert>
      ) : quotas.loading && quotas.items.length === 0 ? null : check.rows.length === 0 ? (
        <Alert severity="info">
          {check.scoped.length
            ? t('Only scoped ResourceQuotas exist in {{ns}} ({{q}}); they are not checked.', {
                ns: namespace,
                q: check.scoped.join(', '),
              })
            : t('No ResourceQuota limits {{ns}}.', { ns: namespace })}
        </Alert>
      ) : (
        <>
          <Alert severity={worst}>
            {worst === 'success'
              ? t('{{n}} pod(s) fit in the ResourceQuota of {{ns}}.', {
                  n: counts.max,
                  ns: namespace,
                })
              : worst === 'warning'
              ? t(
                  '{{min}} pod(s) fit in the ResourceQuota of {{ns}}, but not all {{max}} the autoscaler may create.',
                  { min: counts.min, max: counts.max, ns: namespace }
                )
              : t('The ResourceQuota of {{ns}} would reject the model server pods.', {
                  ns: namespace,
                })}
            {editing &&
              ` ${t(
                'The current pods of the endpoint are counted as released; during a rolling update old and new pods count together.'
              )}`}
            {check.rows.some(r => r.verdict === 'needs-limit') &&
              ` ${t(
                'A quota on limits.cpu rejects pods without a CPU limit; the model server sets none and no LimitRange of the namespace gives a default.'
              )}`}
          </Alert>
          <SimpleTable
            data={check.rows}
            columns={[
              { label: t('Quota'), getter: (r: QuotaRow) => r.quota },
              { label: t('Resource'), getter: (r: QuotaRow) => r.resource },
              {
                label: t('Hard limit'),
                getter: (r: QuotaRow) => formatAmount(r.resource, r.hard),
              },
              {
                label: t('Used by others'),
                getter: (r: QuotaRow) => formatAmount(r.resource, r.used),
              },
              {
                label: t('Needed'),
                getter: (r: QuotaRow) =>
                  r.verdict === 'needs-limit'
                    ? '—'
                    : r.need === r.needMax
                    ? formatAmount(r.resource, r.need)
                    : `${formatAmount(r.resource, r.need)}–${formatAmount(r.resource, r.needMax)}`,
              },
              {
                label: t('Result'),
                getter: (r: QuotaRow) => (
                  <Typography
                    variant="body2"
                    color={
                      r.verdict === 'ok'
                        ? 'success.main'
                        : r.verdict === 'max-exceeds'
                        ? 'warning.main'
                        : 'error.main'
                    }
                  >
                    {t(VERDICT_TEXT[r.verdict])}
                  </Typography>
                ),
              },
            ]}
          />
        </>
      )}
      {queues.length > 0 && (
        <Alert severity="info">
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t(
              'Kueue queues of {{ns}}. Kueue only admits pods labelled {{label}} (or every pod of the namespace when it is configured to manage them); this wizard does not add the label.',
              { ns: namespace, label: QUEUE_LABEL }
            )}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {queues.map(q => (
              <li key={q.localQueue}>
                <Typography variant="body2">
                  {q.localQueue} → {q.clusterQueue}:{' '}
                  {q.noGpuQuota
                    ? t('the ClusterQueue has no quota for {{r}}.', { r: form.gpuResource })
                    : q.nominal !== undefined
                    ? t('{{used}} of {{nominal}} {{r}} in use ({{own}} by this namespace).', {
                        used: q.clusterUsed ?? 0,
                        nominal: q.nominal,
                        own: q.namespaceUsed,
                        r: form.gpuResource,
                      })
                    : t('{{own}} {{r}} in use by this namespace (ClusterQueue not readable).', {
                        own: q.namespaceUsed,
                        r: form.gpuResource,
                      })}
                  {q.pending > 0 && ` ${t('{{n}} workload(s) pending.', { n: q.pending })}`}
                </Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}
    </Box>
  );
}
