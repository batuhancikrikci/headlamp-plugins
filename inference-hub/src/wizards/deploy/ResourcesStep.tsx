import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Alert, Box, Button, Grid, MenuItem, Paper, TextField, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { LoadingState } from '../../common/States';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { GpuNode } from '../../resources/gpu';
import {
  checkFit,
  estimateServingMemory,
  FIT_REASON_TEXT,
  gpusForMemory,
  NodeFit,
} from '../../utils/gpuFit';
import { parseModelUri } from '../../utils/modelInfo';
import { formatBytes } from '../../utils/quantity';
import { DeployForm } from './deployModel';
import { fieldError, StepProps } from './stepTypes';

const PRODUCT_LABEL = 'nvidia.com/gpu.product';

export function replicasToPlace(form: DeployForm): number {
  const primary = form.autoscale ? Math.max(1, form.minReplicas) : form.replicas;
  return primary + (form.mode === 'llm' && form.prefillDecode ? form.prefillReplicas : 0);
}

/** Live fit check of the requested GPUs against the inventory (warning only, never blocking). */
export function FitCheck({
  form,
  nodes,
  podsForbidden,
}: {
  form: DeployForm;
  nodes: GpuNode[];
  podsForbidden: boolean;
}) {
  const model = parseModelUri(form.uri, form.servedModelName);
  const estimate = model.paramsB
    ? estimateServingMemory(model.paramsB, model.quantization)
    : undefined;
  const replicas = replicasToPlace(form);
  const minGpuMemoryMiB =
    estimate && form.gpus > 0 ? Math.ceil((estimate.requiredGiB * 1024) / form.gpus) : undefined;
  const fit = checkFit(nodes, {
    resource: form.gpuResource,
    gpusPerReplica: form.gpus,
    replicas,
    minGpuMemoryMiB,
    nodeSelector: form.nodeSelector,
  });

  let severity: 'success' | 'warning' | 'error' = 'success';
  let message: string;
  if (fit.fits) {
    message = t('{{n}} replica(s) fit on the free GPUs right now.', { n: replicas });
  } else if (fit.capacityReplicas >= replicas) {
    severity = 'warning';
    message = t(
      'Only {{p}} of {{n}} replica(s) fit on free GPUs now; the cluster has capacity for {{c}} when other workloads release GPUs.',
      { p: fit.placeable, n: replicas, c: fit.capacityReplicas }
    );
  } else {
    severity = 'error';
    message = t(
      'No capacity for {{n}} replica(s): at most {{c}} fit on matching nodes even when idle.',
      {
        n: replicas,
        c: fit.capacityReplicas,
      }
    );
  }

  return (
    <Box>
      <Alert severity={severity} sx={{ mb: 1 }}>
        {message}
        {podsForbidden &&
          ` ${t('(Current GPU usage is unknown: you cannot list pods in all namespaces.)')}`}
      </Alert>
      <SimpleTable
        data={fit.nodes.filter(n => n.reason !== 'no-resource')}
        columns={[
          { label: t('Node'), getter: (n: NodeFit) => n.node },
          { label: t('GPU'), getter: (n: NodeFit) => n.product || '—' },
          { label: t('Free devices'), getter: (n: NodeFit) => n.free },
          { label: t('Replicas that fit'), getter: (n: NodeFit) => n.replicas },
          {
            label: t('Result'),
            getter: (n: NodeFit) => (
              <Typography
                variant="body2"
                color={n.reason === 'ok' ? 'success.main' : 'text.secondary'}
              >
                {t(FIT_REASON_TEXT[n.reason])}
              </Typography>
            ),
          },
        ]}
      />
    </Box>
  );
}

export function ResourcesStep({ form, update, errors }: StepProps) {
  const fleet = useGpuFleet({ withMetrics: false });
  const model = parseModelUri(form.uri, form.servedModelName);
  const estimate = model.paramsB
    ? estimateServingMemory(model.paramsB, model.quantization)
    : undefined;
  const resources = Array.from(
    new Set(['nvidia.com/gpu', ...fleet.nodes.flatMap(n => n.resources.map(r => r.name))])
  );
  const products = Array.from(
    new Set(fleet.nodes.map(n => n.labels[PRODUCT_LABEL]).filter(Boolean))
  );
  const selectedProduct = form.nodeSelector[PRODUCT_LABEL] || '';
  const productMemoryMiB = fleet.nodes.find(n =>
    selectedProduct ? n.labels[PRODUCT_LABEL] === selectedProduct : true
  )?.memoryMiB;
  const suggestedGpus =
    estimate && productMemoryMiB
      ? gpusForMemory(estimate.requiredGiB, productMemoryMiB / 1024)
      : undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {estimate && (
        <Paper
          variant="outlined"
          sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Icon icon="mdi:calculator-variant-outline" width={28} />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="subtitle2">
              {t('Estimated GPU memory: ~{{r}} GiB per replica', { r: estimate.requiredGiB })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(
                '{{w}} GiB weights ({{q}}) + {{k}} GiB KV cache and runtime, at 90% GPU memory utilization. Long contexts need more.',
                {
                  w: estimate.weightsGiB,
                  q: model.quantization || 'BF16',
                  k: estimate.reserveGiB,
                }
              )}
            </Typography>
          </Box>
          {suggestedGpus !== undefined && suggestedGpus !== form.gpus && (
            <Button variant="outlined" size="small" onClick={() => update({ gpus: suggestedGpus })}>
              {t('Use {{n}} GPU(s) per replica', { n: suggestedGpus })}
            </Button>
          )}
        </Paper>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <TextField
            select
            fullWidth
            label={t('GPU resource')}
            value={form.gpuResource}
            onChange={e => update({ gpuResource: e.target.value })}
          >
            {resources.map(r => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <TextField
            fullWidth
            type="number"
            label={t('GPUs per replica')}
            value={form.gpus}
            onChange={e => update({ gpus: Number(e.target.value) })}
            inputProps={{ min: 0, max: 64 }}
            {...fieldError(errors, 'gpus')}
            helperText={
              errors.gpus
                ? t(errors.gpus)
                : form.gpus > 1
                ? t('Sets tensor parallelism to {{n}}.', { n: form.gpus })
                : ' '
            }
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <TextField
            fullWidth
            label={t('CPU request')}
            value={form.cpu}
            onChange={e => update({ cpu: e.target.value.trim() })}
            {...fieldError(errors, 'cpu')}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <TextField
            fullWidth
            label={t('Memory')}
            value={form.memory}
            onChange={e => update({ memory: e.target.value.trim() })}
            {...fieldError(errors, 'memory')}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            select
            fullWidth
            label={t('GPU model')}
            value={selectedProduct}
            onChange={e => {
              const nodeSelector = { ...form.nodeSelector };
              if (e.target.value) nodeSelector[PRODUCT_LABEL] = e.target.value;
              else delete nodeSelector[PRODUCT_LABEL];
              update({ nodeSelector });
            }}
            helperText={t(
              'Pins the model servers to nodes with this GPU (node selector on {{l}}).',
              { l: PRODUCT_LABEL }
            )}
          >
            <MenuItem value="">{t('Any')}</MenuItem>
            {products.map(p => {
              const memory = fleet.nodes.find(n => n.labels[PRODUCT_LABEL] === p)?.memoryMiB;
              return (
                <MenuItem key={p} value={p}>
                  {p}
                  {memory ? ` · ${formatBytes(memory * 2 ** 20, 0)}` : ''}
                </MenuItem>
              );
            })}
          </TextField>
        </Grid>
      </Grid>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('Placement check')}
        </Typography>
        {fleet.nodesForbidden ? (
          <Alert severity="info">
            {t('You cannot list nodes, so placement cannot be checked.')}
          </Alert>
        ) : fleet.loading && fleet.nodes.length === 0 ? (
          <LoadingState title={t('Reading GPU inventory…')} />
        ) : form.gpus === 0 ? (
          <Alert severity="info">{t('No GPUs requested: the model runs on CPU.')}</Alert>
        ) : fleet.nodes.length === 0 ? (
          <Alert severity="warning">{t('No GPU nodes were found in this cluster.')}</Alert>
        ) : (
          <FitCheck form={form} nodes={fleet.nodes} podsForbidden={fleet.podsForbidden} />
        )}
      </Box>
    </Box>
  );
}
