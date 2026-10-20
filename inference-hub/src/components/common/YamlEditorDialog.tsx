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
import { createObject, updateObject } from '../../api/mutations';
import { CRDDocsViewer } from '../../common/docs/CRDDocsViewer';
import { t } from '../../common/i18n';
import { useCurrentCluster } from '../../hooks/useCluster';
import { KubeJson } from '../../resources/types';

export type EditorMode = 'create' | 'edit' | 'view';

/** Removes fields that are noise when editing (managedFields, status). */
export function editableCopy(obj: KubeJson): KubeJson {
  const copy = JSON.parse(JSON.stringify(obj)) as KubeJson & { status?: unknown };
  delete copy.status;
  if (copy.metadata) {
    const meta = copy.metadata as KubeJson['metadata'] & { managedFields?: unknown };
    delete meta.managedFields;
  }
  return copy;
}

export function toYaml(obj: unknown): string {
  return yaml.dump(obj, { noRefs: true, lineWidth: -1, skipInvalid: true });
}

/** Parses a single YAML document into a Kubernetes object, or returns an error message. */
export function parseObjectYaml(text: string): { obj?: KubeJson; error?: string } {
  try {
    const parsed = yaml.load(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: t('The document must be a single Kubernetes object.') };
    }
    const obj = parsed as KubeJson;
    if (!obj.apiVersion || !obj.kind) return { error: t('apiVersion and kind are required.') };
    if (!obj.metadata?.name) return { error: t('metadata.name is required.') };
    return { obj };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

interface YamlEditorDialogProps {
  open: boolean;
  title: string;
  initial: KubeJson;
  mode: EditorMode;
  /** Optional explanation above the editor. */
  description?: React.ReactNode;
  onClose: () => void;
  onApplied?: (obj: KubeJson) => void;
}

/**
 * YAML editor with server-side validation (dry run) and apply. Used for every create and
 * edit flow, so the final YAML is always visible before anything is written.
 */
export function YamlEditorDialog({
  open,
  title,
  initial,
  mode,
  description,
  onClose,
  onApplied,
}: YamlEditorDialogProps) {
  const theme = useTheme();
  const cluster = useCurrentCluster();
  const { enqueueSnackbar } = useSnackbar();
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState<'validate' | 'apply' | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [tab, setTab] = React.useState<'yaml' | 'docs'>('yaml');

  // Load the object only when the dialog opens. Callers pass live objects that are refreshed in
  // the background; reloading on every refresh would throw away the user's edits. A server-side
  // change made meanwhile surfaces as a conflict when saving.
  const initialRef = React.useRef(initial);
  initialRef.current = initial;
  React.useEffect(() => {
    if (!open) return;
    const obj = initialRef.current;
    setText(toYaml(mode === 'view' ? obj : editableCopy(obj)));
    setResult(null);
    setBusy(null);
    setTab('yaml');
  }, [open, mode]);

  const parsed = React.useMemo(() => parseObjectYaml(text), [text]);
  // While the YAML is invalid, the documentation keeps showing the last valid object.
  const lastValid = React.useRef<KubeJson>(initial);
  if (parsed.obj) lastValid.current = parsed.obj;
  const documented = parsed.obj || lastValid.current;

  const run = async (dryRun: boolean) => {
    if (!parsed.obj) return;
    setBusy(dryRun ? 'validate' : 'apply');
    setResult(null);
    try {
      const write = mode === 'create' ? createObject : updateObject;
      const saved = await write(parsed.obj, { cluster, dryRun });
      if (dryRun) {
        setResult({ ok: true, message: t('The API server accepted this object (dry run).') });
      } else {
        enqueueSnackbar(
          mode === 'create'
            ? t('{{kind}} {{name}} created', {
                kind: parsed.obj.kind,
                name: parsed.obj.metadata.name,
              })
            : t('{{kind}} {{name}} updated', {
                kind: parsed.obj.kind,
                name: parsed.obj.metadata.name,
              }),
          { variant: 'success' }
        );
        onApplied?.(saved);
        onClose();
      }
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const hint =
        e.status === 409 && mode === 'edit'
          ? ` ${t('The object changed since you opened it. Close and reopen the editor.')}`
          : '';
      setResult({ ok: false, message: `${e.message || String(err)}${hint}` });
    } finally {
      setBusy(null);
    }
  };

  const readOnly = mode === 'view';
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { height: '88vh' } }}
      aria-labelledby="ih-yaml-title"
    >
      <DialogTitle id="ih-yaml-title" sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Box sx={{ flexGrow: 1 }}>{title}</Box>
        <IconButton aria-label={t('Close')} onClick={onClose} disabled={!!busy}>
          <Icon icon="mdi:close" />
        </IconButton>
      </DialogTitle>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label={t('Editor mode')}>
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
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 2 }}>
        {description && tab === 'yaml' && (
          <Typography variant="body2" color="text.secondary" component="div">
            {description}
          </Typography>
        )}
        {tab === 'docs' && (
          <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', mx: -3 }}>
            <CRDDocsViewer
              apiVersion={documented.apiVersion}
              kind={documented.kind}
              value={documented}
            />
          </Box>
        )}
        <Box
          sx={{
            flexGrow: 1,
            minHeight: 300,
            border: 1,
            borderColor: 'divider',
            display: tab === 'yaml' ? 'block' : 'none',
          }}
        >
          <Editor
            language="yaml"
            value={text}
            onChange={value => setText(value ?? '')}
            theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              tabSize: 2,
              automaticLayout: true,
            }}
          />
        </Box>
        {!readOnly && parsed.error && tab === 'yaml' && (
          <Alert severity="warning">{parsed.error}</Alert>
        )}
        {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={!!busy}>
          {readOnly ? t('Close') : t('Cancel')}
        </Button>
        {!readOnly && (
          <>
            <Button
              onClick={() => run(true)}
              disabled={!!busy || !parsed.obj}
              startIcon={
                busy === 'validate' ? (
                  <CircularProgress size={16} />
                ) : (
                  <Icon icon="mdi:check-decagram-outline" />
                )
              }
            >
              {t('Validate')}
            </Button>
            <Button
              variant="contained"
              onClick={() => run(false)}
              disabled={!!busy || !parsed.obj}
              startIcon={
                busy === 'apply' ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Icon icon={mode === 'create' ? 'mdi:plus' : 'mdi:content-save-outline'} />
                )
              }
            >
              {mode === 'create' ? t('Create') : t('Save')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
