import { Icon } from '@iconify/react';
import { SectionBox, SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Grid,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { t } from '../../common/i18n';
import { useCatalog } from '../../hooks/useCatalog';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useEndpoints } from '../../hooks/useEndpoints';
import { useGpuFleet } from '../../hooks/useGpuFleet';
import { usePromInstant } from '../../hooks/usePromQuery';
import { scrape, useVllmEngines } from '../../hooks/useVllmEngines';
import { VllmEngine } from '../../resources/engine';
import { GpuNode } from '../../resources/gpu';
import { deployUrl } from '../../routes';
import {
  DEFAULT_GPU_MEMORY_UTILIZATION,
  estimateArchitecture,
  formatTokens,
  KvCacheDtype,
  maxConcurrency,
  maxContext,
  MeasuredCache,
  measuredCache,
  ModelArchitecture,
  plan,
  RESERVE_PER_GPU_GIB,
  smallestTensorParallel,
  TP_SIZES,
  vllmArgsFor,
} from '../../utils/capacity';
import { checkFit } from '../../utils/gpuFit';
import { formatParams, parseModelUri } from '../../utils/modelInfo';
import { parsePromText } from '../../utils/promText';

const CONTEXTS = [4096, 8192, 16384, 32768, 65536, 131072];
const QUANTIZATIONS = ['', 'FP8', 'INT8', 'AWQ', 'GPTQ', 'INT4', 'NVFP4', 'MXFP4'];
const PRODUCT_LABEL = 'nvidia.com/gpu.product';
const GPU_RESOURCE = 'nvidia.com/gpu';
/** Engines scraped directly when Prometheus has no cache_config_info. */
const MAX_SCRAPES = 3;

interface GpuType {
  product: string;
  memoryGiB: number;
  nodes: GpuNode[];
  devices: number;
}

/** GPU models of the inventory with their memory and device count. */
function gpuTypes(nodes: GpuNode[]): GpuType[] {
  const byProduct = new Map<string, GpuType>();
  for (const node of nodes) {
    if (!node.product || !node.memoryMiB) continue;
    const devices = node.resources.find(r => r.name === GPU_RESOURCE)?.allocatable || 0;
    if (devices === 0) continue;
    const type = byProduct.get(node.product) || {
      product: node.product,
      memoryGiB: Math.floor(node.memoryMiB / 1024),
      nodes: [],
      devices: 0,
    };
    type.nodes.push(node);
    type.devices += devices;
    byProduct.set(node.product, type);
  }
  return [...byProduct.values()].sort((a, b) => b.memoryGiB - a.memoryGiB);
}

interface Measurement extends MeasuredCache {
  engine: VllmEngine;
  product?: string;
}

/** KV cache capacity of running vLLM engines: Prometheus first, else /metrics of a few pods. */
function useMeasurements(engines: VllmEngine[], nodes: GpuNode[]): Measurement[] {
  const cluster = useCurrentCluster();
  const prom = usePromInstant(engines.length ? { cache: 'vllm:cache_config_info' } : null, 60000);
  const [scraped, setScraped] = React.useState<Map<string, MeasuredCache>>(new Map());
  const promSamples = prom.data?.cache || [];
  const usePromData = promSamples.length > 0;
  const key = engines.map(e => e.key).join(',');

  React.useEffect(() => {
    if (usePromData || prom.prometheus.status === 'loading' || !key) return;
    let cancelled = false;
    Promise.all(
      engines.slice(0, MAX_SCRAPES).map(async engine => {
        try {
          const sample = parsePromText(await scrape(cluster, engine)).find(
            s => s.name === 'vllm:cache_config_info'
          );
          const measured = sample && measuredCache(sample.labels);
          return measured ? ([engine.key, measured] as const) : null;
        } catch {
          return null;
        }
      })
    ).then(results => {
      if (!cancelled) {
        setScraped(new Map(results.filter((r): r is NonNullable<typeof r> => !!r)));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, key, usePromData, prom.prometheus.status]);

  return engines.flatMap(engine => {
    let measured: MeasuredCache | undefined;
    if (usePromData) {
      const sample = promSamples.find(s => {
        const pod = s.metric.pod || s.metric.exported_pod || s.metric.kubernetes_pod_name;
        const ns = s.metric.namespace || s.metric.exported_namespace;
        return pod === engine.pod && (!ns || ns === engine.namespace);
      });
      measured = sample && measuredCache(sample.metric);
    } else {
      measured = scraped.get(engine.key);
    }
    if (!measured) return [];
    const product = nodes.find(n => n.name === engine.node)?.product;
    return [{ ...measured, engine, product }];
  });
}

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  help,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  help?: string;
}) {
  return (
    <TextField
      type="number"
      size="small"
      fullWidth
      label={label}
      value={Number.isFinite(value) ? value : ''}
      inputProps={{ min }}
      onChange={e => onChange(Math.max(min, Number(e.target.value) || min))}
      helperText={help}
    />
  );
}

export function CapacityPlannerPage() {
  const history = useHistory();
  const catalog = useCatalog();
  const fleet = useGpuFleet({ withMetrics: false });
  const { endpoints } = useEndpoints();
  const { engines } = useVllmEngines();

  const location = useLocation();
  const [cacheName, setCacheName] = React.useState<string | null>(
    () => new URLSearchParams(location.search).get('cache') || null
  );
  const entry = catalog.entries.find(e => e.name === cacheName);
  const [paramsB, setParamsB] = React.useState(8);
  const [quantization, setQuantization] = React.useState('');
  const [arch, setArch] = React.useState<ModelArchitecture>(estimateArchitecture(8));
  const [archEdited, setArchEdited] = React.useState(false);
  const [context, setContext] = React.useState(32768);
  const [concurrency, setConcurrency] = React.useState(16);
  const [kvDtype, setKvDtype] = React.useState<KvCacheDtype>('auto');
  const [tp, setTp] = React.useState<number | 'auto'>('auto');
  const [utilization, setUtilization] = React.useState(DEFAULT_GPU_MEMORY_UTILIZATION);
  const [manualGpuGiB, setManualGpuGiB] = React.useState(80);

  // Picking a catalog model fills in its size and quantization.
  React.useEffect(() => {
    if (!entry) return;
    const model = entry.model;
    if (model.paramsB) setParamsB(model.paramsB);
    setQuantization(model.quantization || '');
    if (!archEdited && model.paramsB) setArch(estimateArchitecture(model.paramsB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.name]);
  React.useEffect(() => {
    if (!archEdited) setArch(estimateArchitecture(paramsB));
  }, [paramsB, archEdited]);

  const types = React.useMemo(() => gpuTypes(fleet.nodes), [fleet.nodes]);
  const rowsSource: GpuType[] =
    types.length > 0
      ? types
      : [
          {
            product: t('GPU with {{n}} GiB', { n: manualGpuGiB }),
            memoryGiB: manualGpuGiB,
            nodes: [],
            devices: 0,
          },
        ];

  const base = { paramsB, quantization, arch, kvDtype, gpuMemoryUtilization: utilization };
  const rows = rowsSource.map(type => {
    const input = { ...base, gpuMemoryGiB: type.memoryGiB };
    const gpus = tp === 'auto' ? smallestTensorParallel(input, context, concurrency) : tp;
    const p = plan({ ...input, gpus: gpus || 8 });
    const fit =
      type.nodes.length > 0 && gpus
        ? checkFit(type.nodes, {
            resource: GPU_RESOURCE,
            gpusPerReplica: gpus,
            replicas: 1,
            nodeSelector: { [PRODUCT_LABEL]: type.product },
          })
        : undefined;
    return { type, gpus, plan: p, fit };
  });

  // Engines serving the selected catalog model (through an endpoint that uses its URI).
  const modelEngines = React.useMemo(() => {
    if (!entry) return [];
    const users = endpoints.filter(e => e.modelUri === entry.uri);
    return engines.filter(e =>
      users.some(
        u =>
          e.endpoint?.slug === u.slug && e.endpoint?.name === u.name && e.namespace === u.namespace
      )
    );
  }, [entry, endpoints, engines]);
  const measurements = useMeasurements(modelEngines, fleet.nodes);

  const best = rows.find(r => r.gpus && r.plan.fits);
  const deploy = () =>
    history.push(
      deployUrl({
        cache: entry?.name,
        uri: entry?.uri,
        gpus: best?.gpus ? String(best.gpus) : undefined,
        args: vllmArgsFor(context, concurrency, kvDtype),
      })
    );

  const model = entry ? entry.model : parseModelUri('', '');
  return (
    <SectionBox
      title={t('Capacity Planner')}
      headerProps={{
        titleSideActions: [
          <Button
            key="deploy"
            variant="contained"
            startIcon={<Icon icon="mdi:rocket-launch-outline" />}
            disabled={!entry}
            onClick={deploy}
          >
            {t('Deploy with these settings')}
          </Button>,
        ],
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'How much GPU memory a model needs for its weights and KV cache, and how many concurrent requests of a given context length fit on the GPUs of this cluster.'
        )}
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2">{t('Model')}</Typography>
            <Autocomplete
              size="small"
              options={catalog.entries.map(e => e.name)}
              value={cacheName}
              onChange={(_, v) => setCacheName(v)}
              getOptionLabel={name =>
                catalog.entries.find(e => e.name === name)?.displayName || name
              }
              renderInput={p => (
                <TextField
                  {...p}
                  label={t('From the catalog (optional)')}
                  helperText={
                    entry
                      ? [
                          entry.model.provider?.label,
                          formatParams(entry.model.paramsB),
                          entry.model.quantization,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : t('Or enter the size below.')
                  }
                />
              )}
            />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <NumberField
                  label={t('Parameters (billions)')}
                  value={paramsB}
                  min={0.1}
                  onChange={setParamsB}
                  help={
                    model.activeParamsB
                      ? t('Total parameters of the mixture of experts.')
                      : undefined
                  }
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('Weight precision')}
                  value={quantization}
                  onChange={e => setQuantization(e.target.value)}
                >
                  {QUANTIZATIONS.map(q => (
                    <MenuItem key={q} value={q}>
                      {q || 'BF16 / FP16'}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle2">{t('Architecture')}</Typography>
              <Tooltip
                title={t(
                  'These numbers are in the model config.json, which Inference Hub does not download. They are estimated from the parameter count of typical dense models; enter the real values for an exact result.'
                )}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  color={archEdited ? 'default' : 'warning'}
                  label={archEdited ? t('Entered') : t('Estimated')}
                />
              </Tooltip>
              {archEdited && (
                <Button size="small" onClick={() => setArchEdited(false)}>
                  {t('Estimate again')}
                </Button>
              )}
            </Box>
            <Grid container spacing={2}>
              {(
                [
                  ['layers', 'Layers'],
                  ['kvHeads', 'KV heads'],
                  ['headDim', 'Head size'],
                ] as const
              ).map(([key, label]) => (
                <Grid item xs={4} key={key}>
                  <NumberField
                    label={t(label)}
                    value={arch[key]}
                    onChange={v => {
                      setArch(a => ({ ...a, [key]: v }));
                      setArchEdited(true);
                    }}
                  />
                </Grid>
              ))}
            </Grid>

            <Typography variant="subtitle2">{t('Load')}</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('Context length (tokens)')}
                  value={context}
                  onChange={e => setContext(Number(e.target.value))}
                >
                  {CONTEXTS.map(c => (
                    <MenuItem key={c} value={c}>
                      {formatTokens(c)}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6}>
                <NumberField
                  label={t('Concurrent requests')}
                  value={concurrency}
                  onChange={setConcurrency}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('KV cache precision')}
                  value={kvDtype}
                  onChange={e => setKvDtype(e.target.value as KvCacheDtype)}
                >
                  <MenuItem value="auto">{t('Same as the model (BF16)')}</MenuItem>
                  <MenuItem value="fp8">FP8</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('GPUs per replica')}
                  value={tp}
                  onChange={e => setTp(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                >
                  <MenuItem value="auto">{t('Smallest that fits')}</MenuItem>
                  {TP_SIZES.map(n => (
                    <MenuItem key={n} value={n}>
                      {n}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  type="number"
                  size="small"
                  fullWidth
                  label={t('GPU memory utilization')}
                  value={utilization}
                  inputProps={{ min: 0.5, max: 0.98, step: 0.01 }}
                  onChange={e =>
                    setUtilization(Math.min(0.98, Math.max(0.5, Number(e.target.value) || 0.9)))
                  }
                  helperText="--gpu-memory-utilization"
                />
              </Grid>
              {types.length === 0 && (
                <Grid item xs={6}>
                  <NumberField
                    label={t('GPU memory (GiB)')}
                    value={manualGpuGiB}
                    onChange={setManualGpuGiB}
                    help={t('No GPU inventory is visible; enter the GPU size.')}
                  />
                </Grid>
              )}
            </Grid>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('Fit per GPU model')}
          </Typography>
          <SimpleTable
            data={rows}
            columns={[
              {
                label: t('GPU'),
                getter: (r: (typeof rows)[number]) => (
                  <Box>
                    <Typography variant="body2">{r.type.product}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.type.memoryGiB} GiB
                      {r.type.devices
                        ? ` · ${t('{{n}} in the cluster', { n: r.type.devices })}`
                        : ''}
                    </Typography>
                  </Box>
                ),
              },
              {
                label: t('GPUs / replica'),
                getter: (r: (typeof rows)[number]) => r.gpus ?? t('more than 8'),
              },
              {
                label: t('Per GPU: weights · KV cache'),
                getter: (r: (typeof rows)[number]) =>
                  `${r.plan.weightsPerGpuGiB} · ${r.plan.kvPerGpuGiB} GiB`,
              },
              {
                label: t('KV cache'),
                getter: (r: (typeof rows)[number]) =>
                  `${formatTokens(r.plan.kvTokens)} ${t('tokens')}`,
              },
              {
                label: t('Requests at {{c}}', { c: formatTokens(context) }),
                getter: (r: (typeof rows)[number]) => maxConcurrency(r.plan.kvTokens, context),
              },
              {
                label: t('Context at {{n}} requests', { n: concurrency }),
                getter: (r: (typeof rows)[number]) =>
                  formatTokens(maxContext(r.plan.kvTokens, concurrency)),
              },
              {
                label: t('Result'),
                getter: (r: (typeof rows)[number]) => {
                  const enough = r.gpus && r.plan.fits && r.plan.kvTokens >= context * concurrency;
                  return (
                    <Box>
                      <Typography
                        variant="body2"
                        color={
                          enough ? 'success.main' : r.plan.fits ? 'warning.main' : 'error.main'
                        }
                      >
                        {enough
                          ? t('Fits')
                          : r.plan.fits
                          ? t('Fits with less load')
                          : t('Does not fit')}
                      </Typography>
                      {r.fit && (
                        <Typography variant="caption" color="text.secondary">
                          {t('{{n}} replica(s) placeable now', { n: r.fit.placeable })}
                        </Typography>
                      )}
                    </Box>
                  );
                },
              },
            ]}
          />
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t(
              'Per GPU, vLLM uses {{u}} of the memory; {{r}} GiB of it are reserved for activations and CUDA graphs, the weights are split across the GPUs of a replica and the rest holds the KV cache. Estimates, not guarantees.',
              { u: `${Math.round(utilization * 100)}%`, r: RESERVE_PER_GPU_GIB }
            )}
          </Typography>

          {entry && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('Measured on running engines')}
              </Typography>
              {measurements.length === 0 ? (
                <Alert severity="info">
                  {modelEngines.length === 0
                    ? t('No vLLM engine serves this model right now.')
                    : t(
                        'The engines of this model report no cache_config_info metric (vLLM exposes it from v0.6 on).'
                      )}
                </Alert>
              ) : (
                <SimpleTable
                  data={measurements}
                  columns={[
                    {
                      label: t('Engine'),
                      getter: (m: Measurement) => `${m.engine.namespace}/${m.engine.pod}`,
                    },
                    {
                      label: t('GPUs'),
                      getter: (m: Measurement) =>
                        `${m.engine.gpus}${m.product ? ` × ${m.product}` : ''}`,
                    },
                    {
                      label: t('KV cache'),
                      getter: (m: Measurement) => `${formatTokens(m.kvTokens)} ${t('tokens')}`,
                    },
                    {
                      label: t('Requests at {{c}}', { c: formatTokens(context) }),
                      getter: (m: Measurement) => maxConcurrency(m.kvTokens, context),
                    },
                    {
                      label: t('Settings'),
                      getter: (m: Measurement) =>
                        [
                          m.cacheDtype && `kv ${m.cacheDtype}`,
                          m.gpuMemoryUtilization && `util ${m.gpuMemoryUtilization}`,
                          `block ${m.blockSize}`,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                    },
                  ]}
                />
              )}
            </Box>
          )}
          {!entry && (
            <Alert severity="info" sx={{ mt: 3 }}>
              {t(
                'Pick a catalog model to compare the estimate with engines that already serve it, and to deploy it with these settings.'
              )}
            </Alert>
          )}
          {entry && best && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {t('Deploying passes {{args}} and {{g}} GPU(s) per replica to the wizard.', {
                args: vllmArgsFor(context, concurrency, kvDtype),
                g: best.gpus,
              })}
            </Typography>
          )}
        </Grid>
      </Grid>
    </SectionBox>
  );
}
