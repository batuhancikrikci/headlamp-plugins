/**
 * Create / edit dialog with a guided form (or wizard), a live-synchronized YAML editor and the
 * CRD documentation. Form and YAML stay in sync in both directions.
 */
import { Icon } from '@iconify/react';
import Editor from '@monaco-editor/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import React from 'react';
import { PLUGIN } from '../../plugin';
import { CRDDocsViewer } from '../docs/CRDDocsViewer';
import { useText } from '../i18n';
import { errorMessage } from '../States';
import { dumpYaml, fromYaml, sameJson } from '../yaml';
import { applyWithDependents, Dependent } from './apply';
import { KubeJson, ValidationError } from './types';
import { validateResource } from './validation';
import { ValidationList } from './ValidationList';

/** What a form writes next to the edited resource, e.g. a Secret built from its fields. */
export interface FormExtras {
  /** Objects owned by the resource, applied with it (see `applyWithDependents`). */
  dependents: Dependent[];
  /** Problems of fields that are not part of the resource; they block applying too. */
  errors: ValidationError[];
  /** Those fields were edited, so closing asks before discarding them. */
  dirty: boolean;
}

const NO_EXTRAS: FormExtras = { dependents: [], errors: [], dirty: false };

export interface ResourceFormProps {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  mode: 'create' | 'edit';
  errors: ValidationError[];
  /** Submits the current value (used by wizards on their last step). */
  onSubmit: () => void;
  submitting: boolean;
  /** Reports the objects and errors of fields the form keeps outside the resource. */
  onExtrasChange?: (extras: FormExtras) => void;
}

export type ResourceFormComponent = React.ComponentType<ResourceFormProps>;

type TabId = 'form' | 'yaml' | 'docs';

export interface ResourceEditorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initialItem: KubeJson;
  mode: 'create' | 'edit';
  /** Form (or wizard) rendered in the first tab. Without it the dialog is YAML only. */
  Form?: ResourceFormComponent;
  /** The form drives its own submit button (wizard); the dialog hides its own on the form tab. */
  wizard?: boolean;
  /** Tab shown first; defaults to the form when there is one. */
  initialTab?: TabId;
}

export function ResourceEditor({
  open,
  onClose,
  title,
  initialItem,
  mode,
  Form,
  wizard,
  initialTab,
}: ResourceEditorProps) {
  const { t } = useText();
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();

  const firstTab = initialTab || (Form ? 'form' : 'yaml');
  const [value, setValue] = React.useState<KubeJson>(initialItem);
  const [yamlText, setYamlText] = React.useState(() => dumpYaml(initialItem));
  const [yamlError, setYamlError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(firstTab);
  const [submitting, setSubmitting] = React.useState(false);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [extras, setExtras] = React.useState<FormExtras>(NO_EXTRAS);

  React.useEffect(() => {
    if (!open) {
      // Reset on close, not on open: the form reports its extras from its own mount effect,
      // which runs before this one.
      setExtras(NO_EXTRAS);
      return;
    }
    setValue(initialItem);
    setYamlText(dumpYaml(initialItem));
    setYamlError(null);
    setTab(firstTab);
    setApplyError(null);
    setSubmitting(false);
  }, [open, initialItem, firstTab]);

  const errors = React.useMemo(
    () => [...validateResource(value), ...extras.errors],
    [value, extras.errors]
  );
  const dirty = !sameJson(value, initialItem) || !!yamlError || extras.dirty;

  const handleFormChange = React.useCallback((next: KubeJson) => {
    setValue(next);
    setYamlText(dumpYaml(next));
    setYamlError(null);
  }, []);

  const handleYamlChange = (code?: string) => {
    const text = code ?? '';
    setYamlText(text);
    const result = fromYaml<KubeJson>(text, initialItem.kind);
    if (result.error !== undefined) {
      setYamlError(result.error);
      return;
    }
    setValue(result.value);
    setYamlError(null);
  };

  const handleSubmit = async () => {
    if (errors.length > 0 || yamlError) return;
    setSubmitting(true);
    setApplyError(null);
    try {
      const warnings = await applyWithDependents(value, mode, extras.dependents);
      warnings.forEach(warning => enqueueSnackbar(warning, { variant: 'warning' }));
      enqueueSnackbar(
        mode === 'create'
          ? t('{{kind}} "{{name}}" created', { kind: value.kind, name: value.metadata?.name })
          : t('{{kind}} "{{name}}" updated', { kind: value.kind, name: value.metadata?.name }),
        { variant: 'success' }
      );
      onClose();
    } catch (err) {
      setApplyError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const requestClose = () => {
    if (dirty && !submitting) setConfirmClose(true);
    else onClose();
  };

  const showDialogSubmit = !(wizard && tab === 'form');
  const blocked = errors.length > 0 || !!yamlError;
  const titleId = `${PLUGIN.name}-editor-title`;

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { height: '88vh' } }}
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
          <Box sx={{ flexGrow: 1 }}>{title}</Box>
          <IconButton aria-label={t('Close')} onClick={requestClose}>
            <Icon icon="mdi:close" />
          </IconButton>
        </DialogTitle>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label={t('Editor mode')}>
            {Form && (
              <Tab
                value="form"
                label={wizard ? t('Wizard') : t('Form')}
                icon={<Icon icon={wizard ? 'mdi:wizard-hat' : 'mdi:form-select'} />}
                iconPosition="start"
              />
            )}
            <Tab
              value="yaml"
              label="YAML"
              icon={<Icon icon="mdi:code-braces" />}
              iconPosition="start"
            />
            <Tab
              value="docs"
              label={t('Documentation')}
              icon={<Icon icon="mdi:book-open-variant" />}
              iconPosition="start"
            />
          </Tabs>
        </Box>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {yamlError && tab !== 'docs' && (
            <Alert severity="warning" sx={{ borderRadius: 0 }}>
              {tab === 'form'
                ? t('The YAML is invalid; the form shows the last valid version. {{error}}', {
                    error: yamlError,
                  })
                : yamlError}
            </Alert>
          )}
          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: tab === 'yaml' ? 'hidden' : 'auto' }}>
            {/* The form stays mounted so wizard progress survives switching to YAML and back. */}
            {Form && (
              <Box sx={{ p: 3, display: tab === 'form' ? 'block' : 'none' }}>
                <Form
                  value={value}
                  onChange={handleFormChange}
                  mode={mode}
                  errors={errors}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  onExtrasChange={setExtras}
                />
              </Box>
            )}
            {tab === 'yaml' && (
              <Editor
                language="yaml"
                value={yamlText}
                onChange={handleYamlChange}
                theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                height="100%"
                options={{ automaticLayout: true, minimap: { enabled: false }, tabSize: 2 }}
              />
            )}
            {tab === 'docs' && (
              <CRDDocsViewer apiVersion={value.apiVersion} kind={value.kind} value={value} />
            )}
          </Box>
          {(applyError || (errors.length > 0 && showDialogSubmit)) && (
            <Box sx={{ px: 3, pt: 1 }}>
              {applyError && (
                <Alert severity="error" sx={{ mb: 1 }} onClose={() => setApplyError(null)}>
                  {applyError}
                </Alert>
              )}
              {showDialogSubmit && (
                <ValidationList
                  errors={errors}
                  title={t('Complete these fields before applying:')}
                />
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={requestClose} color="secondary">
            {t('Cancel')}
          </Button>
          {showDialogSubmit && (
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={blocked || submitting}
              startIcon={submitting ? <CircularProgress size={16} /> : <Icon icon="mdi:check" />}
            >
              {mode === 'create' ? t('Create') : t('Apply')}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)}>
        <DialogTitle>{t('Discard changes?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('You have unsaved changes. Closing the editor will discard them.')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(false)}>{t('Keep editing')}</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmClose(false);
              onClose();
            }}
          >
            {t('Discard')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
