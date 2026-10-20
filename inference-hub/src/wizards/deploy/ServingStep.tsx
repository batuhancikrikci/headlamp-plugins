import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardActionArea,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  Grid,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { isServed } from '../../api/discovery';
import { t } from '../../common/i18n';
import { useCoreList, useResourceList } from '../../hooks/useLive';
import { ProfileJson, summarizeProfile } from '../../resources/profile';
import { KubeJson } from '../../resources/types';
import { DeployMode, RoutingMode } from './deployModel';
import { fieldError, StepProps } from './stepTypes';

const MODES: Array<{
  id: DeployMode;
  title: string;
  icon: string;
  text: string;
  resource: 'llminferenceservices' | 'inferenceservices';
}> = [
  {
    id: 'llm',
    title: 'LLM service',
    icon: 'mdi:chat-processing-outline',
    text: 'LLMInferenceService: vLLM with llm-d routing, prefill/decode split, KV-cache aware scheduling and multi-node serving. Recommended for LLMs.',
    resource: 'llminferenceservices',
  },
  {
    id: 'isvc',
    title: 'Inference service',
    icon: 'mdi:cube-outline',
    text: 'InferenceService with the Hugging Face runtime (vLLM backend on GPUs). Simple single-pool serving with the classic KServe features.',
    resource: 'inferenceservices',
  },
];

const ROUTING: Array<{ id: RoutingMode; title: string; text: string }> = [
  {
    id: 'scheduler',
    title: 'Gateway + llm-d scheduler',
    text: 'Creates an HTTPRoute, an InferencePool and the endpoint picker: load, prefix-cache and KV-cache aware routing.',
  },
  {
    id: 'route',
    title: 'Gateway only',
    text: 'Creates an HTTPRoute to the model servers without the scheduler.',
  },
  {
    id: 'none',
    title: 'In-cluster only',
    text: 'No gateway exposure; reachable through the Kubernetes service inside the cluster.',
  },
];

interface GatewayJson extends KubeJson {
  spec?: { gatewayClassName?: string };
}

function LlmOptions({ form, update, errors, discovery }: StepProps) {
  const profiles = useResourceList<ProfileJson>('llminferenceserviceconfigs', {}, 60000);
  const gateways = useResourceList<GatewayJson>(
    'gateways',
    isServed(discovery, 'gateways') ? {} : null,
    60000
  );
  // A baseRef resolves in the service namespace first, then in the KServe system namespace.
  const usable = profiles.items
    .map(summarizeProfile)
    .filter(p => p.namespace === form.namespace || p.builtIn)
    .sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <FormControl>
        <FormLabel>{t('Routing')}</FormLabel>
        <RadioGroup
          value={form.routing}
          onChange={e => update({ routing: e.target.value as RoutingMode })}
        >
          {ROUTING.map(r => (
            <FormControlLabel
              key={r.id}
              value={r.id}
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2">{t(r.title)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(r.text)}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: 'flex-start', mb: 1, '& .MuiRadio-root': { pt: 0.5 } }}
            />
          ))}
        </RadioGroup>
      </FormControl>
      {form.routing !== 'none' && (
        <Autocomplete
          options={gateways.items}
          value={
            gateways.items.find(
              g =>
                g.metadata.name === form.gatewayName &&
                (g.metadata.namespace || '') === form.gatewayNamespace
            ) || null
          }
          onChange={(_, g) =>
            update({
              gatewayName: g?.metadata.name || '',
              gatewayNamespace: g?.metadata.namespace || '',
            })
          }
          getOptionLabel={g => `${g.metadata.namespace}/${g.metadata.name}`}
          isOptionEqualToValue={(a, b) => a.metadata.uid === b.metadata.uid}
          renderOption={(props, g) => (
            <li {...props} key={g.metadata.uid || g.metadata.name}>
              {g.metadata.namespace}/{g.metadata.name}
              {g.spec?.gatewayClassName && (
                <Chip size="small" sx={{ ml: 1 }} label={g.spec.gatewayClassName} />
              )}
            </li>
          )}
          renderInput={p => (
            <TextField
              {...p}
              label={t('Gateway (optional)')}
              {...fieldError(errors, 'gatewayName')}
              helperText={t('Leave empty to use the default gateway configured in KServe.')}
            />
          )}
        />
      )}
      <Autocomplete
        multiple
        options={usable.map(p => p.name)}
        value={form.profiles}
        onChange={(_, v) => update({ profiles: v })}
        renderOption={(props, name) => {
          const p = usable.find(x => x.name === name);
          return (
            <li {...props} key={name}>
              <Box>
                <Typography variant="body2">
                  {name} {p?.builtIn && <Chip size="small" label={t('Built-in')} sx={{ ml: 1 }} />}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {p?.aspects.map(a => a.label).join(', ')}
                </Typography>
              </Box>
            </li>
          );
        }}
        renderInput={p => (
          <TextField
            {...p}
            label={t('Serving profiles (optional)')}
            helperText={t(
              'LLMInferenceServiceConfigs this service builds on (spec.baseRefs). Fields set here override them.'
            )}
          />
        )}
      />
      <Box>
        <FormControlLabel
          control={
            <Switch
              checked={form.prefillDecode}
              onChange={e => update({ prefillDecode: e.target.checked })}
            />
          }
          label={t('Split prefill and decode (disaggregated serving)')}
        />
        <Typography variant="caption" color="text.secondary" component="div">
          {t(
            'Runs a separate prefill pool that transfers KV cache to the decode pool; needs a fast interconnect and the llm-d scheduler.'
          )}
        </Typography>
        {form.prefillDecode && (
          <TextField
            sx={{ mt: 1, width: 200 }}
            size="small"
            type="number"
            label={t('Prefill replicas')}
            value={form.prefillReplicas}
            onChange={e => update({ prefillReplicas: Number(e.target.value) })}
            {...fieldError(errors, 'prefillReplicas')}
          />
        )}
        {form.prefillDecode && form.routing !== 'scheduler' && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('Prefill/decode split needs the llm-d scheduler to route requests.')}
          </Alert>
        )}
      </Box>
    </Box>
  );
}

function IsvcOptions({ form, update }: StepProps) {
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} sm={6}>
        <TextField
          select
          fullWidth
          label={t('Deployment mode')}
          value={form.isvcDeploymentMode}
          onChange={e =>
            update({ isvcDeploymentMode: e.target.value as typeof form.isvcDeploymentMode })
          }
          helperText={t('Standard uses Deployments and HPA; Knative adds scale-to-zero.')}
        >
          <MenuItem value="">{t('Cluster default')}</MenuItem>
          <MenuItem value="Standard">Standard</MenuItem>
          <MenuItem value="Knative">Knative</MenuItem>
        </TextField>
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField
          fullWidth
          label={t('Runtime (optional)')}
          value={form.runtime}
          onChange={e => update({ runtime: e.target.value.trim() })}
          helperText={t(
            'Name of a ServingRuntime; empty lets KServe pick the Hugging Face runtime.'
          )}
        />
      </Grid>
    </Grid>
  );
}

export function ServingStep(props: StepProps) {
  const { form, update, errors, discovery } = props;
  const accounts = useCoreList(
    'v1',
    'serviceaccounts',
    true,
    form.namespace ? { namespace: form.namespace } : null,
    60000
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Grid container spacing={2}>
        {MODES.map(m => {
          const served = isServed(discovery, m.resource);
          const selected = form.mode === m.id;
          return (
            <Grid item xs={12} md={6} key={m.id}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  borderColor: selected ? 'primary.main' : 'divider',
                  borderWidth: selected ? 2 : 1,
                  opacity: served ? 1 : 0.5,
                }}
              >
                <CardActionArea
                  disabled={!served}
                  onClick={() => update({ mode: m.id })}
                  sx={{ p: 2, height: '100%' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Icon icon={m.icon} width={24} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                      {t(m.title)}
                    </Typography>
                    {m.id === 'llm' && (
                      <Chip size="small" color="primary" label={t('Recommended')} />
                    )}
                    {selected && <Icon icon="mdi:check-circle" width={22} />}
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {served ? t(m.text) : t('Not installed in this cluster.')}
                  </Typography>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {form.mode === 'llm' ? <LlmOptions {...props} /> : <IsvcOptions {...props} />}

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            label={t('Container image (optional)')}
            placeholder={
              form.mode === 'llm'
                ? 'vllm/vllm-openai:v0.30.0'
                : 'kserve/huggingfaceserver:<version>-gpu'
            }
            value={form.image}
            onChange={e => update({ image: e.target.value.trim() })}
            {...fieldError(errors, 'image')}
            helperText={
              errors.image ? t(errors.image) : t('Empty uses the image of the preset or runtime.')
            }
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Autocomplete
            freeSolo
            options={accounts.items.map(a => a.metadata.name)}
            value={form.serviceAccountName}
            onInputChange={(_, v) => update({ serviceAccountName: v.trim() })}
            renderInput={p => (
              <TextField
                {...p}
                label={t('Service account (optional)')}
                helperText={t(
                  'Attach a secret with HF_TOKEN or S3 credentials to it; KServe passes them to the model download.'
                )}
              />
            )}
          />
        </Grid>
        <Grid item xs={12}>
          <TextField
            fullWidth
            label={form.mode === 'llm' ? t('Extra vLLM arguments') : t('Extra runtime arguments')}
            placeholder={
              form.mode === 'llm'
                ? '--max-model-len=32768 --enable-prefix-caching'
                : '--max_model_len=8192'
            }
            value={form.extraArgs}
            onChange={e => update({ extraArgs: e.target.value })}
            helperText={
              form.mode === 'llm'
                ? t(
                    'Passed through VLLM_ADDITIONAL_ARGS, which the KServe presets append to "vllm serve".'
                  )
                : t('Appended to the predictor arguments.')
            }
          />
        </Grid>
      </Grid>
    </Box>
  );
}
