import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { MultiYamlEditor } from '../../components/common/MultiYamlEditor';
import { useDefaultNamespace } from '../../hooks/useEndpoints';
import { useCoreList } from '../../hooks/useLive';
import { NodeJson } from '../../resources/gpu';
import {
  buildProfile,
  defaultProfileForm,
  ProfileErrors,
  ProfileForm,
  validateProfile,
} from './profileModel';

const PRODUCT_LABEL = 'nvidia.com/gpu.product';

/** Form for a new LLMInferenceServiceConfig; ends in the YAML review with dry run. */
export function ProfileFormDialog({
  open,
  apiVersion,
  onClose,
}: {
  open: boolean;
  apiVersion: string;
  onClose: () => void;
}) {
  const defaultNamespace = useDefaultNamespace();
  const [form, setForm] = React.useState<ProfileForm>(() => defaultProfileForm(defaultNamespace));
  const [stage, setStage] = React.useState<'form' | 'yaml'>('form');
  const [showErrors, setShowErrors] = React.useState(false);
  const namespaces = useCoreList('v1', 'namespaces', false, open ? {} : null, 60000);
  const nodes = useCoreList<NodeJson>('v1', 'nodes', false, open ? {} : null, 60000);
  const products = Array.from(
    new Set(nodes.items.map(n => n.metadata.labels?.[PRODUCT_LABEL]).filter(Boolean))
  ) as string[];

  React.useEffect(() => {
    if (open) {
      setForm(defaultProfileForm(defaultNamespace));
      setStage('form');
      setShowErrors(false);
    }
  }, [open, defaultNamespace]);

  const errors: ProfileErrors = validateProfile(form);
  const shown = showErrors ? errors : {};
  const err = (k: keyof ProfileForm) => ({
    error: !!shown[k],
    helperText: shown[k] ? t(shown[k] as string) : undefined,
  });
  const draft = React.useMemo(() => buildProfile(form, apiVersion), [form, apiVersion]);
  const update = (patch: Partial<ProfileForm>) => setForm(f => ({ ...f, ...patch }));
  const objects = React.useMemo(
    () => (stage === 'yaml' ? [buildProfile(form, apiVersion)] : []),
    [stage, form, apiVersion]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>{t('New serving profile')}</Box>
        <DocsDrawer iconOnly apiVersion={apiVersion} kind={draft.kind} value={draft} />
        <IconButton aria-label={t('Close')} onClick={onClose}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {stage === 'form' ? (
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Name')}
                value={form.name}
                onChange={e => update({ name: e.target.value.trim() })}
                {...err('name')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Autocomplete
                freeSolo
                options={namespaces.items.map(n => n.metadata.name)}
                value={form.namespace}
                onInputChange={(_, v) => update({ namespace: v })}
                renderInput={p => (
                  <TextField
                    {...p}
                    label={t('Namespace')}
                    {...err('namespace')}
                    helperText={
                      shown.namespace
                        ? t(shown.namespace)
                        : t('Services reference profiles in their own namespace.')
                    }
                  />
                )}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('Description (optional)')}
                value={form.description}
                onChange={e => update({ description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Model server image (optional)')}
                placeholder="vllm/vllm-openai:v0.30.0"
                value={form.image}
                onChange={e => update({ image: e.target.value.trim() })}
                {...err('image')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label={t('Routing')}
                value={form.routing}
                onChange={e => update({ routing: e.target.value as ProfileForm['routing'] })}
              >
                <MenuItem value="keep">{t('Not set by this profile')}</MenuItem>
                <MenuItem value="scheduler">{t('Gateway + llm-d scheduler')}</MenuItem>
                <MenuItem value="route">{t('Gateway only')}</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('Extra vLLM arguments')}
                placeholder="--max-model-len=32768 --enable-prefix-caching --kv-cache-dtype=fp8"
                value={form.extraArgs}
                onChange={e => update({ extraArgs: e.target.value })}
                {...err('extraArgs')}
                helperText={
                  shown.extraArgs
                    ? t(shown.extraArgs)
                    : t('Set as VLLM_ADDITIONAL_ARGS on the main container.')
                }
              />
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.setResources}
                    onChange={e => update({ setResources: e.target.checked })}
                  />
                }
                label={t('Set resources')}
              />
            </Grid>
            {form.setResources && (
              <>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    type="number"
                    label={t('GPUs per replica')}
                    value={form.gpus}
                    onChange={e => update({ gpus: Number(e.target.value) })}
                    {...err('gpus')}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    label={t('GPU resource')}
                    value={form.gpuResource}
                    onChange={e => update({ gpuResource: e.target.value.trim() })}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    label={t('CPU request')}
                    value={form.cpu}
                    onChange={e => update({ cpu: e.target.value.trim() })}
                    {...err('cpu')}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    label={t('Memory')}
                    value={form.memory}
                    onChange={e => update({ memory: e.target.value.trim() })}
                    {...err('memory')}
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                select
                fullWidth
                label={t('GPU model')}
                value={form.gpuProduct}
                onChange={e => update({ gpuProduct: e.target.value })}
              >
                <MenuItem value="">{t('Any')}</MenuItem>
                {products.map(p => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label={t('Prefill replicas')}
                value={form.prefillReplicas}
                onChange={e => update({ prefillReplicas: Number(e.target.value) })}
                {...err('prefillReplicas')}
                helperText={
                  shown.prefillReplicas
                    ? t(shown.prefillReplicas)
                    : t('0 keeps a single pool; more adds a prefill pool (P/D split).')
                }
              />
            </Grid>
          </Grid>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('Review the generated LLMInferenceServiceConfig, validate it and create it.')}
            </Typography>
            <MultiYamlEditor
              objects={objects}
              submitLabel={t('Create profile')}
              onCreated={onClose}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        {stage === 'yaml' ? (
          <Button onClick={() => setStage('form')} startIcon={<Icon icon="mdi:arrow-left" />}>
            {t('Back to form')}
          </Button>
        ) : (
          <Button
            variant="contained"
            endIcon={<Icon icon="mdi:arrow-right" />}
            onClick={() => {
              if (Object.keys(errors).length) {
                setShowErrors(true);
                return;
              }
              setStage('yaml');
            }}
          >
            {t('Review YAML')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
