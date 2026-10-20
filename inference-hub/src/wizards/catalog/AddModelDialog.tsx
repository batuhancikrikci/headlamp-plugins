import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { ModelAvatar } from '../../components/common/ModelAvatar';
import { MultiYamlEditor } from '../../components/common/MultiYamlEditor';
import { useResourceList } from '../../hooks/useLive';
import { LocalModelNodeGroupJson } from '../../resources/catalog';
import { estimateServingMemory } from '../../utils/gpuFit';
import { formatParams, parseModelUri } from '../../utils/modelInfo';
import {
  buildCatalogEntry,
  CatalogEntryForm,
  CatalogErrors,
  catalogNameFor,
  defaultCatalogForm,
  suggestModelSize,
  validateCatalogForm,
} from './catalogEntryModel';

/** Adds a model to the catalog by creating a LocalModelCache. */
export function AddModelDialog({
  open,
  apiVersion,
  existingNames,
  onClose,
}: {
  open: boolean;
  apiVersion: string;
  existingNames: string[];
  onClose: () => void;
}) {
  const groups = useResourceList<LocalModelNodeGroupJson>(
    'localmodelnodegroups',
    open ? {} : null,
    60000
  );
  const [form, setForm] = React.useState<CatalogEntryForm>(defaultCatalogForm);
  const [stage, setStage] = React.useState<'form' | 'yaml'>('form');
  const [showErrors, setShowErrors] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setForm(defaultCatalogForm());
      setStage('form');
      setShowErrors(false);
    }
  }, [open]);

  // Preselect the only node group.
  React.useEffect(() => {
    if (open && groups.items.length === 1 && form.nodeGroups.length === 0) {
      setForm(f => ({ ...f, nodeGroups: [groups.items[0].metadata.name] }));
    }
  }, [open, groups.items, form.nodeGroups.length]);

  const model = parseModelUri(form.uri);
  const estimate = model.paramsB
    ? estimateServingMemory(model.paramsB, model.quantization)
    : undefined;
  const errors: CatalogErrors = validateCatalogForm(form, existingNames);
  const shown = showErrors ? errors : {};
  const err = (k: keyof CatalogEntryForm, help?: string) => ({
    error: !!shown[k],
    helperText: shown[k] ? t(shown[k] as string) : help,
  });
  const draft = React.useMemo(() => buildCatalogEntry(form, apiVersion), [form, apiVersion]);
  const update = (patch: Partial<CatalogEntryForm>) => setForm(f => ({ ...f, ...patch }));
  const objects = React.useMemo(
    () => (stage === 'yaml' ? [buildCatalogEntry(form, apiVersion)] : []),
    [stage, form, apiVersion]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>{t('Add a model to the catalog')}</Box>
        <DocsDrawer iconOnly apiVersion={apiVersion} kind={draft.kind} value={draft} />
        <IconButton aria-label={t('Close')} onClick={onClose}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {stage === 'form' ? (
          <Grid container spacing={2} sx={{ pt: 1 }}>
            <Grid item xs={12}>
              <Typography variant="body2" color="text.secondary">
                {t(
                  'Catalog entries are LocalModelCache objects: KServe downloads the model to the nodes of the chosen node groups, and endpoints that use the exact same URI start from the local copy.'
                )}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label={t('Model URI')}
                placeholder="hf://Qwen/Qwen2.5-7B-Instruct"
                value={form.uri}
                onChange={e => {
                  const uri = e.target.value;
                  const previousName = catalogNameFor(form.uri);
                  const est = parseModelUri(uri);
                  const size = est.paramsB
                    ? estimateServingMemory(est.paramsB, est.quantization).weightsGiB
                    : undefined;
                  update({
                    uri,
                    name:
                      !form.name || form.name === previousName ? catalogNameFor(uri) : form.name,
                    modelSize:
                      !form.modelSize || form.modelSize === suggestModelSize(estimate?.weightsGiB)
                        ? suggestModelSize(size)
                        : form.modelSize,
                  });
                }}
                {...err('uri', t('The URI is immutable once the entry is created.'))}
              />
            </Grid>
            {form.uri && !errors.uri && (
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  <ModelAvatar model={model} size={36} />
                  <Typography variant="body2">
                    {[
                      model.provider?.label,
                      model.family,
                      formatParams(model.paramsB),
                      model.quantization,
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('Unknown model family')}
                  </Typography>
                </Box>
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Entry name')}
                value={form.name}
                onChange={e => update({ name: e.target.value.trim() })}
                {...err('name')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Display name (optional)')}
                value={form.displayName}
                onChange={e => update({ displayName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('Description (optional)')}
                value={form.description}
                onChange={e => update({ description: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('License (optional)')}
                placeholder="Apache-2.0"
                value={form.license}
                onChange={e => update({ license: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Tags (optional)')}
                placeholder="chat, code, multilingual"
                value={form.tags}
                onChange={e => update({ tags: e.target.value })}
                {...err('tags', t('Comma separated.'))}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label={t('Model size')}
                value={form.modelSize}
                onChange={e => update({ modelSize: e.target.value.trim() })}
                {...err(
                  'modelSize',
                  estimate
                    ? t('~{{w}} GiB of weights estimated.', { w: estimate.weightsGiB })
                    : t('Disk space reserved per node.')
                )}
              />
            </Grid>
            <Grid item xs={12} sm={8}>
              <Autocomplete
                multiple
                options={groups.items.map(g => g.metadata.name)}
                value={form.nodeGroups}
                onChange={(_, v) => update({ nodeGroups: v })}
                renderInput={p => (
                  <TextField {...p} label={t('Node groups')} {...err('nodeGroups')} />
                )}
              />
              {!groups.loading && groups.items.length === 0 && (
                <Alert severity="warning" sx={{ mt: 1 }}>
                  {groups.forbidden
                    ? t('You cannot list LocalModelNodeGroups.')
                    : t('No LocalModelNodeGroup exists. Create one under Model Storage first.')}
                </Alert>
              )}
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Service account (optional)')}
                value={form.serviceAccountName}
                onChange={e => update({ serviceAccountName: e.target.value.trim() })}
                helperText={t(
                  'Used by the download job in the KServe local model jobs namespace; attach HF_TOKEN or S3 secrets to it.'
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label={t('Storage key (optional)')}
                value={form.storageKey}
                onChange={e => update({ storageKey: e.target.value.trim() })}
                helperText={t('Key in the KServe storage-config secret for S3 or GCS credentials.')}
              />
            </Grid>
          </Grid>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('Review the LocalModelCache, validate it and add it to the catalog.')}
            </Typography>
            <MultiYamlEditor
              objects={objects}
              submitLabel={t('Add to catalog')}
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
            onClick={() => (Object.keys(errors).length ? setShowErrors(true) : setStage('yaml'))}
          >
            {t('Review YAML')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
