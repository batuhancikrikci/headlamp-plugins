import { Icon } from '@iconify/react';
import {
  DateLabel,
  Link,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Grid, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { CopyableCode } from '../../components/common/CopyableCode';
import { ModelAvatar, ModelTraits, StorageUri } from '../../components/common/ModelAvatar';
import { ConditionsTable } from '../../components/detail/ConditionsTable';
import { useResourceList } from '../../hooks/useLive';
import {
  ContainerSpec,
  deploymentModeOf,
  InferenceServiceJson,
  LLMInferenceServiceJson,
  ModelEndpoint,
} from '../../resources/endpoint';
import { Condition, KubeJson } from '../../resources/types';
import { DETAIL_PAGES } from '../../routes';
import { formatParams } from '../../utils/modelInfo';

interface LocalModelCacheJson extends KubeJson {
  spec?: { sourceModelUri?: string; nodeGroups?: string[]; modelSize?: string };
  status?: { copies?: { available?: number; total?: number; failed?: number } };
}

/** Shows whether the model is served from a LocalModelCache (exact URI match, as KServe does). */
function CacheStatus({ uri }: { uri: string }) {
  const caches = useResourceList<LocalModelCacheJson>('localmodelcaches', {}, 60000);
  if (caches.notInstalled || caches.forbidden || !uri) return null;
  const cache = caches.items.find(c => c.spec?.sourceModelUri === uri);
  if (!cache) {
    return (
      <Tooltip
        title={t('No LocalModelCache has this exact URI; pods download the model on start.')}
      >
        <Chip
          size="small"
          variant="outlined"
          icon={<Icon icon="mdi:cloud-download-outline" />}
          label={t('Not cached')}
        />
      </Tooltip>
    );
  }
  const copies = cache.status?.copies || {};
  return (
    <Tooltip title={t('LocalModelCache {{name}}', { name: cache.metadata.name })}>
      <Chip
        size="small"
        color={copies.available && copies.available === copies.total ? 'success' : 'info'}
        variant="outlined"
        icon={<Icon icon="mdi:database-check-outline" />}
        label={t('Cached on {{a}}/{{t}} nodes', { a: copies.available ?? 0, t: copies.total ?? 0 })}
      />
    </Tooltip>
  );
}

function ResourcesText({ container }: { container?: ContainerSpec }) {
  const r = container?.resources;
  if (!r?.limits && !r?.requests) return <>{t('Not set on this object')}</>;
  const keys = Array.from(
    new Set([...Object.keys(r.requests || {}), ...Object.keys(r.limits || {})])
  );
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {keys.map(k => (
        <Chip
          key={k}
          size="small"
          variant="outlined"
          label={`${k}: ${r.requests?.[k] ?? '—'} / ${r.limits?.[k] ?? '—'}`}
        />
      ))}
    </Box>
  );
}

function ContainerSection({ title, container }: { title: string; container?: ContainerSpec }) {
  if (!container) return null;
  const args = [...(container.command || []), ...(container.args || [])];
  const extraArgs = container.env?.find(e => e.name === 'VLLM_ADDITIONAL_ARGS')?.value;
  return (
    <SectionBox title={title}>
      <NameValueTable
        rows={[
          { name: t('Image'), value: container.image || t('From serving profile / runtime') },
          {
            name: t('Resources (request / limit)'),
            value: <ResourcesText container={container} />,
          },
          {
            name: t('Arguments'),
            value: args.length ? <CopyableCode code={args.join(' ')} maxHeight={160} /> : '—',
            hide: args.length === 0,
          },
          {
            name: t('Extra vLLM arguments'),
            value: <CopyableCode code={extraArgs || ''} />,
            hide: !extraArgs,
          },
        ]}
      />
    </SectionBox>
  );
}

function llmContainers(obj: LLMInferenceServiceJson) {
  const main =
    obj.spec?.template?.containers?.find(c => c.name === 'main') ||
    obj.spec?.template?.containers?.[0];
  const prefill =
    obj.spec?.prefill?.template?.containers?.find(c => c.name === 'main') ||
    obj.spec?.prefill?.template?.containers?.[0];
  return { main, prefill };
}

export function EndpointOverview({ endpoint }: { endpoint: ModelEndpoint }) {
  const { model } = endpoint;
  const raw = endpoint.raw;
  const isLLM = endpoint.kind === 'LLMInferenceService';
  const llm = raw as LLMInferenceServiceJson;
  const isvc = raw as InferenceServiceJson;
  const conditions = (raw.status as { conditions?: Condition[] } | undefined)?.conditions;
  const addresses = isLLM ? llm.status?.addresses || [] : [];
  const pool = llm.status?.router?.scheduler?.inferencePool;
  const gateways = llm.status?.router?.gateways || [];
  const applied = llm.status?.appliedConfigs || [];
  const containers = isLLM
    ? llmContainers(llm)
    : { main: isvc.spec?.predictor?.model, prefill: undefined };
  const scaling =
    endpoint.minReplicas !== undefined || endpoint.maxReplicas !== undefined
      ? `${endpoint.minReplicas ?? '—'} – ${endpoint.maxReplicas ?? '—'}`
      : undefined;

  return (
    <>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={6}>
          <SectionBox title={t('Model')}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
              <ModelAvatar model={model} size={48} />
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {model.name || endpoint.servedModelName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {[
                    model.provider?.label,
                    model.family,
                    model.publisher && t('published by {{p}}', { p: model.publisher }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                <ModelTraits model={model} />
              </Box>
            </Box>
            <NameValueTable
              rows={[
                {
                  name: t('Served model name'),
                  value: <CopyableCode code={endpoint.servedModelName} />,
                },
                {
                  name: t('Source'),
                  value: (
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        alignItems: 'flex-start',
                      }}
                    >
                      <StorageUri uri={endpoint.modelUri} />
                      <CacheStatus uri={endpoint.modelUri} />
                    </Box>
                  ),
                },
                {
                  name: t('Parameters'),
                  value: model.activeParamsB
                    ? t('{{total}} total, {{active}} active', {
                        total: formatParams(model.paramsB),
                        active: formatParams(model.activeParamsB),
                      })
                    : formatParams(model.paramsB),
                  hide: model.paramsB === undefined,
                },
              ]}
            />
          </SectionBox>
        </Grid>
        <Grid item xs={12} lg={6}>
          <SectionBox title={t('Serving')}>
            <NameValueTable
              rows={[
                { name: t('Engine'), value: endpoint.engine },
                {
                  name: t('Deployment mode'),
                  value: deploymentModeOf(isvc) || '—',
                  hide: isLLM,
                },
                {
                  name: t('Replicas'),
                  value:
                    endpoint.readyReplicas !== undefined && endpoint.replicas !== undefined
                      ? t('{{ready}} of {{desired}} ready', {
                          ready: endpoint.readyReplicas,
                          desired: endpoint.replicas,
                        })
                      : endpoint.replicas ?? '—',
                },
                {
                  name: t('Prefill replicas'),
                  value: llm.spec?.prefill?.replicas ?? 1,
                  hide: !isLLM || !llm.spec?.prefill,
                },
                { name: t('Autoscaling range'), value: scaling, hide: !scaling },
                {
                  name: t('GPUs'),
                  value: endpoint.gpusPerReplica
                    ? t('{{per}} per replica · {{total}} in total', {
                        per: endpoint.gpusPerReplica,
                        total: endpoint.totalGpus,
                      })
                    : t('None requested on this object'),
                },
                {
                  name: t('Capabilities'),
                  value: (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {endpoint.features.map(f => (
                        <Chip
                          key={f.id}
                          size="small"
                          icon={<Icon icon={f.icon} />}
                          label={t(f.label)}
                        />
                      ))}
                    </Box>
                  ),
                  hide: endpoint.features.length === 0,
                },
                {
                  name: t('Serving profiles'),
                  value: (
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {endpoint.profiles.map(p => (
                        <Chip
                          key={p}
                          size="small"
                          variant="outlined"
                          icon={<Icon icon="mdi:tune-variant" />}
                          label={
                            <Link
                              routeName={DETAIL_PAGES.profile.name}
                              params={{ namespace: endpoint.namespace, name: p }}
                            >
                              {p}
                            </Link>
                          }
                        />
                      ))}
                    </Box>
                  ),
                  hide: endpoint.profiles.length === 0,
                },
                {
                  name: t('Applied configs'),
                  value: applied
                    .map(a => `${a.name}${a.source ? ` (${a.source})` : ''}`)
                    .join(', '),
                  hide: applied.length === 0,
                },
                {
                  name: t('Created'),
                  value: endpoint.createdAt ? <DateLabel date={endpoint.createdAt} /> : '—',
                },
              ]}
            />
          </SectionBox>
        </Grid>
      </Grid>

      <SectionBox title={t('Access')}>
        <NameValueTable
          rows={[
            {
              name: t('URL'),
              value: endpoint.url ? <CopyableCode code={endpoint.url} /> : t('Not assigned yet'),
            },
            {
              name: t('Addresses'),
              value: (
                <Box>
                  {addresses.map(a => (
                    <Typography key={a.url} variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {a.name ? `${a.name}: ` : ''}
                      {a.url}
                    </Typography>
                  ))}
                </Box>
              ),
              hide: addresses.length < 2,
            },
            {
              name: t('In-cluster service'),
              value: (
                <CopyableCode
                  code={`${endpoint.name}-kserve-workload-svc.${endpoint.namespace}.svc:8000`}
                />
              ),
              hide: !isLLM,
            },
            {
              name: t('InferencePool'),
              value: pool ? `${pool.namespace || endpoint.namespace}/${pool.name}` : '—',
              hide: !isLLM || !llm.spec?.router?.scheduler,
            },
            {
              name: t('Gateways'),
              value: (
                <Box>
                  {gateways.map(g => (
                    <Typography key={`${g.namespace}/${g.name}`} variant="body2">
                      {`${g.namespace || endpoint.namespace}/${g.name}`}
                      {g.httpRoutes?.length ? ` → ${g.httpRoutes.map(r => r.name).join(', ')}` : ''}
                    </Typography>
                  ))}
                </Box>
              ),
              hide: gateways.length === 0,
            },
          ]}
        />
        {!endpoint.url && endpoint.status.health === 'ready' && (
          <Typography variant="caption" color="text.secondary">
            {t(
              'Ready endpoints without a URL can still be reached through the Playground using the service proxy.'
            )}
          </Typography>
        )}
      </SectionBox>

      <ContainerSection
        title={isLLM ? t('Model server container') : t('Predictor')}
        container={containers.main}
      />
      <ContainerSection title={t('Prefill container')} container={containers.prefill} />

      <SectionBox title={t('Conditions')}>
        <ConditionsTable conditions={conditions} />
      </SectionBox>
      {model.uri && model.scheme === 'hf' && model.publisher && (
        <Typography variant="caption" color="text.secondary">
          <MuiLink
            href={`https://huggingface.co/${model.publisher}/${model.name}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Model card on Hugging Face')}
          </MuiLink>
        </Typography>
      )}
    </>
  );
}
