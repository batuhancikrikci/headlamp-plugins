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
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import * as yaml from 'js-yaml';
import { useSnackbar } from 'notistack';
import React from 'react';
import { CRDDocsViewer } from '../../common/docs/CRDDocsViewer';
import { createResource, updateResource } from '../../common/form/apply';
import type { KubeJson } from '../../common/form/types';
import { useText } from '../../common/i18n';

/** A resource being edited as free-form YAML: forms may read and set any field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Obj = Record<string, any>;

/** A validation problem, tagged with the form section/wizard step it belongs to. */
export interface FormIssue {
  section: string;
  message: string;
}

export const issue = (section: string, message: string): FormIssue => ({ section, message });

export interface ResourceFormProps {
  value: Obj;
  onChange: (next: Obj) => void;
  mode: 'create' | 'edit';
  /** Convenience flag: mode === 'edit'. */
  editMode: boolean;
  /** Current validation issues. */
  errors: FormIssue[];
  /** Whether fields should highlight missing required values. */
  showErrors: boolean;
  /** Asks the dialog to start highlighting errors (e.g. blocked wizard step). */
  revealErrors: () => void;
  /** Submits the current value (wizards call this from their last step). */
  onSubmit: () => void;
  submitting: boolean;
}

export type ResourceFormComponent = React.ComponentType<ResourceFormProps>;

export interface ResourceEditorDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  initialItem: Obj;
  mode: 'create' | 'edit';
  /** Form or wizard rendered in the first tab. Without it the dialog is YAML only. */
  Form?: ResourceFormComponent;
  /** The form drives its own submit button (wizard); the dialog hides its own on that tab. */
  wizard?: boolean;
  validate?: (value: Obj) => FormIssue[];
  /** Shown above the form (e.g. Helm warning). */
  banner?: React.ReactNode;
}

type TabId = 'form' | 'yaml' | 'docs';

function dump(value: Obj): string {
  // skipInvalid drops keys whose value is undefined (left behind by form updates).
  return yaml.dump(value, { noRefs: true, lineWidth: -1, skipInvalid: true });
}

function errorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as { message?: string };
  return e.message || JSON.stringify(err);
}

/**
 * Create / edit dialog with a guided form or wizard, a live YAML editor and the
 * CRD documentation. Form and YAML stay in sync in both directions.
 */
export function ResourceEditorDialog({
  open,
  onClose,
  title,
  initialItem,
  mode,
  Form,
  wizard,
  validate,
  banner,
}: ResourceEditorDialogProps) {
  const { t } = useText();
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();

  const [value, setValue] = React.useState<Obj>(initialItem);
  const [yamlText, setYamlText] = React.useState(() => dump(initialItem));
  const [yamlError, setYamlError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(Form ? 'form' : 'yaml');
  const [submitting, setSubmitting] = React.useState(false);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(mode === 'edit');

  const errors = React.useMemo(() => (validate ? validate(value) : []), [validate, value]);

  const handleFormChange = React.useCallback((next: Obj) => {
    setValue(next);
    setYamlText(dump(next));
    setYamlError(null);
    setDirty(true);
  }, []);

  const handleYamlChange = (code?: string) => {
    const text = code ?? '';
    setYamlText(text);
    setDirty(true);
    try {
      const parsed = yaml.load(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setYamlError(t('The document must be a single Kubernetes object'));
        return;
      }
      setValue(parsed as Obj);
      setYamlError(null);
    } catch (err) {
      setYamlError(errorMessage(err));
    }
  };

  const handleSubmit = async () => {
    if (errors.length > 0 || yamlError) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    setApplyError(null);
    try {
      if (mode === 'create') await createResource(value as KubeJson);
      else await updateResource(value as KubeJson);
      enqueueSnackbar(
        mode === 'create'
          ? t('Created {{kind}} {{name}}', { kind: value.kind, name: value.metadata?.name })
          : t('Updated {{kind}} {{name}}', { kind: value.kind, name: value.metadata?.name }),
        { variant: 'success' }
      );
      setDirty(false);
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

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { height: '88vh' } }}
        aria-labelledby="monitoring-editor-title"
      >
        <DialogTitle
          id="monitoring-editor-title"
          sx={{ display: 'flex', alignItems: 'center', pr: 1 }}
        >
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
                {banner}
                <Form
                  value={value}
                  onChange={handleFormChange}
                  mode={mode}
                  editMode={mode === 'edit'}
                  errors={errors}
                  showErrors={showErrors}
                  revealErrors={() => setShowErrors(true)}
                  onSubmit={handleSubmit}
                  submitting={submitting}
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
              {errors.length > 0 && showDialogSubmit && (
                <Alert severity="info" icon={<Icon icon="mdi:clipboard-check-outline" />}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('Complete these fields before applying:')}
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {errors.slice(0, 6).map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                  </Box>
                  {errors.length > 6 && (
                    <Typography variant="caption">
                      {t('…and {{count}} more', { count: errors.length - 6 })}
                    </Typography>
                  )}
                </Alert>
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

/** Removes server-managed fields before editing an existing object. */
export function editableCopy<T extends Obj>(json: T): T {
  const copy = JSON.parse(JSON.stringify(json)) as T;
  if (copy.metadata) {
    delete copy.metadata.managedFields;
    delete copy.metadata.creationTimestamp;
    delete copy.metadata.generation;
    delete copy.metadata.uid;
  }
  delete (copy as Obj).status;
  return copy;
}
