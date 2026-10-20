import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { isServed } from '../../api/discovery';
import { t } from '../../common/i18n';
import { ModelAvatar, ModelTraits } from '../../components/common/ModelAvatar';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { KubeJson } from '../../resources/types';
import { estimateServingMemory } from '../../utils/gpuFit';
import { formatParams, parseModelUri } from '../../utils/modelInfo';
import { CacheOption, suggestName, suggestServedName } from './deployModel';
import { fieldError, StepProps } from './stepTypes';

export interface LocalModelCacheJson extends KubeJson {
  spec?: { sourceModelUri?: string; modelSize?: string; nodeGroups?: string[] };
  status?: { copies?: { available?: number; total?: number; failed?: number } };
}

export function cacheOptions(items: LocalModelCacheJson[]): CacheOption[] {
  return items
    .filter(c => c.spec?.sourceModelUri)
    .map(c => ({
      name: c.metadata.name,
      uri: c.spec?.sourceModelUri || '',
      modelSize: c.spec?.modelSize,
      nodeGroups: c.spec?.nodeGroups || [],
    }));
}

const SCHEME_HINTS = [
  { prefix: 'hf://', label: 'Hugging Face', example: 'hf://Qwen/Qwen2.5-7B-Instruct' },
  { prefix: 's3://', label: 'S3', example: 's3://bucket/path/to/model' },
  { prefix: 'pvc://', label: 'PVC', example: 'pvc://pvc-name/path' },
  { prefix: 'oci://', label: 'OCI', example: 'oci://registry/org/modelcar:tag' },
];

function CatalogPicker({ form, update, errors }: Pick<StepProps, 'form' | 'update' | 'errors'>) {
  const caches = useResourceList<LocalModelCacheJson>('localmodelcaches', {}, 60000);
  const options = cacheOptions(caches.items);
  const [query, setQuery] = React.useState('');
  const visible = options.filter(o =>
    `${o.name} ${o.uri}`.toLowerCase().includes(query.toLowerCase())
  );

  if (!caches.loading && options.length === 0) {
    return (
      <Alert severity="info">
        {caches.forbidden
          ? t('You are not allowed to read the model catalog (LocalModelCache). Use a custom URI.')
          : t('The model catalog is empty. Use a custom URI, or add models under Model Catalog.')}
      </Alert>
    );
  }

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        placeholder={t('Search the catalog')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        sx={{ mb: 2 }}
      />
      {errors.cacheName && (
        <Typography variant="body2" color="error" sx={{ mb: 1 }}>
          {t(errors.cacheName)}
        </Typography>
      )}
      <Grid container spacing={1.5}>
        {visible.map(o => {
          const model = parseModelUri(o.uri);
          const selected = form.cacheName === o.name;
          const item = caches.items.find(c => c.metadata.name === o.name);
          const copies = item?.status?.copies;
          return (
            <Grid item xs={12} sm={6} lg={4} key={o.name}>
              <Card
                variant="outlined"
                sx={{
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderWidth: selected ? 2 : 1,
                }}
              >
                <CardActionArea
                  onClick={() => {
                    const served = suggestServedName(o.uri);
                    update({
                      cacheName: o.name,
                      uri: o.uri,
                      servedModelName: served,
                      name: form.name || suggestName(served || o.name),
                    });
                  }}
                  sx={{ p: 1.5 }}
                >
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <ModelAvatar model={model} size={36} />
                    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                      <Typography variant="subtitle2" noWrap>
                        {model.name || o.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {[model.provider?.label, o.modelSize].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                    {selected && <Icon icon="mdi:check-circle" width={22} />}
                  </Box>
                  <Box
                    sx={{
                      mt: 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <ModelTraits model={model} />
                    {copies && (
                      <Tooltip
                        title={t('Cached on {{a}} of {{t}} nodes', {
                          a: copies.available ?? 0,
                          t: copies.total ?? 0,
                        })}
                      >
                        <Chip
                          size="small"
                          icon={<Icon icon="mdi:database-check-outline" />}
                          label={`${copies.available ?? 0}/${copies.total ?? 0}`}
                          color={
                            copies.available && copies.available === copies.total
                              ? 'success'
                              : 'default'
                          }
                          variant="outlined"
                        />
                      </Tooltip>
                    )}
                  </Box>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

function CustomUri({ form, update, errors, discovery }: StepProps) {
  const groups = useResourceList<KubeJson>(
    'localmodelnodegroups',
    isServed(discovery, 'localmodelcaches') ? {} : null,
    60000
  );
  const model = parseModelUri(form.uri, form.servedModelName);
  const estimate = model.paramsB
    ? estimateServingMemory(model.paramsB, model.quantization)
    : undefined;
  const catalogAvailable = isServed(discovery, 'localmodelcaches');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label={t('Model URI')}
        placeholder="hf://Qwen/Qwen2.5-7B-Instruct"
        value={form.uri}
        onChange={e => {
          const uri = e.target.value;
          // Keep values the user typed; only replace values that are still our suggestion.
          const previousServed = suggestServedName(form.uri);
          const servedModelName =
            !form.servedModelName || form.servedModelName === previousServed
              ? suggestServedName(uri)
              : form.servedModelName;
          const name =
            !form.name || form.name === suggestName(previousServed || form.uri)
              ? suggestName(servedModelName || uri)
              : form.name;
          update({ uri, servedModelName, name });
        }}
        {...fieldError(errors, 'uri')}
        helperText={
          errors.uri
            ? t(errors.uri)
            : t('Where the weights are stored. KServe downloads them before vLLM starts.')
        }
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {SCHEME_HINTS.map(h => (
          <Tooltip key={h.prefix} title={h.example}>
            <Chip
              size="small"
              variant="outlined"
              label={`${h.prefix} ${t(h.label)}`}
              onClick={() => !form.uri && update({ uri: h.prefix })}
            />
          </Tooltip>
        ))}
      </Box>
      {form.uri && !errors.uri && (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <ModelAvatar model={model} size={36} />
          <Box>
            <Typography variant="body2">
              {[model.provider?.label, model.family, formatParams(model.paramsB)]
                .filter(Boolean)
                .join(' · ') || t('Unknown model family')}
            </Typography>
            {estimate && (
              <Typography variant="caption" color="text.secondary">
                {t('~{{w}} GiB of weights; ~{{r}} GiB GPU memory recommended per replica', {
                  w: estimate.weightsGiB,
                  r: estimate.requiredGiB,
                })}
              </Typography>
            )}
          </Box>
        </Box>
      )}
      {catalogAvailable && (
        <Box>
          <FormControlLabel
            control={
              <Checkbox
                checked={form.addToCatalog}
                onChange={e => update({ addToCatalog: e.target.checked })}
              />
            }
            label={t('Also add this model to the catalog (creates a LocalModelCache)')}
          />
          {form.addToCatalog && (
            <Grid container spacing={2} sx={{ mt: 0 }}>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label={t('Model size')}
                  placeholder={estimate ? `${Math.ceil(estimate.weightsGiB * 1.1)}Gi` : '20Gi'}
                  value={form.catalogModelSize}
                  onChange={e => update({ catalogModelSize: e.target.value.trim() })}
                  {...fieldError(errors, 'catalogModelSize')}
                />
              </Grid>
              <Grid item xs={12} sm={8}>
                <Autocomplete
                  multiple
                  size="small"
                  options={groups.items.map(g => g.metadata.name)}
                  value={form.catalogNodeGroups}
                  onChange={(_, v) => update({ catalogNodeGroups: v })}
                  renderInput={p => (
                    <TextField
                      {...p}
                      label={t('Node groups')}
                      {...fieldError(errors, 'catalogNodeGroups')}
                    />
                  )}
                />
              </Grid>
            </Grid>
          )}
        </Box>
      )}
    </Box>
  );
}

export function SourceStep(props: StepProps) {
  const { form, update, errors, discovery } = props;
  const namespaces = useCoreList('v1', 'namespaces', false, {}, 60000);
  const catalogAvailable = isServed(discovery, 'localmodelcaches');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <ToggleButtonGroup
        exclusive
        value={form.source}
        onChange={(_, v) =>
          v && update({ source: v, cacheName: '', uri: v === 'custom' ? form.uri : '' })
        }
        size="small"
      >
        <ToggleButton value="catalog" disabled={!catalogAvailable}>
          <Icon icon="mdi:bookshelf" style={{ marginRight: 8 }} />
          {t('From the catalog')}
        </ToggleButton>
        <ToggleButton value="custom">
          <Icon icon="mdi:link-variant" style={{ marginRight: 8 }} />
          {t('Custom URI')}
        </ToggleButton>
      </ToggleButtonGroup>

      {form.source === 'catalog' ? <CatalogPicker {...props} /> : <CustomUri {...props} />}

      {form.source === 'catalog' && form.cacheName && (
        <Alert severity="success" icon={<Icon icon="mdi:database-check-outline" />}>
          {t(
            'The endpoint uses the exact URI of the catalog entry, so KServe mounts the cached copy from the local model cache instead of downloading it.'
          )}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Autocomplete
            freeSolo
            options={namespaces.items.map(n => n.metadata.name)}
            value={form.namespace}
            onInputChange={(_, v) => update({ namespace: v })}
            renderInput={p => (
              <TextField {...p} label={t('Namespace')} {...fieldError(errors, 'namespace')} />
            )}
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            label={t('Endpoint name')}
            value={form.name}
            onChange={e => update({ name: e.target.value.trim() })}
            {...fieldError(errors, 'name')}
            helperText={
              errors.name
                ? t(errors.name)
                : t('Short names keep the generated service names readable.')
            }
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            label={t('Served model name')}
            value={form.servedModelName}
            onChange={e => update({ servedModelName: e.target.value })}
            {...fieldError(errors, 'servedModelName')}
            helperText={
              errors.servedModelName
                ? t(errors.servedModelName)
                : t('The "model" value in OpenAI requests.')
            }
          />
        </Grid>
      </Grid>
    </Box>
  );
}
