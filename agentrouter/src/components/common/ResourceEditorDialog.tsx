/**
 * Edits one or more Kubernetes objects as a YAML stream. The Documentation tab browses the
 * CRD schema of any kind in the stream, so wizards can review everything they create.
 */
import { Icon } from '@iconify/react';
import { Resource } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import Editor from '@monaco-editor/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import React, { useMemo, useState } from 'react';
import { CRDDocsViewer } from '../../common/docs/CRDDocsViewer';
import {
  distinctKinds,
  kindKey,
  KindRef,
  parseYamlStream,
  pickKind,
  toYamlStream,
} from './yamlDocuments';

export interface ResourceEditorDialogProps {
  open: boolean;
  title: string;
  /** Objects to edit; more than one renders as multi-document YAML. */
  items: KubeObjectInterface[];
  /** Kind shown first in the Documentation tab. */
  primaryKind?: string;
  saveLabel?: string;
  onClose: () => void;
  /** Receives the parsed documents; throw to keep the dialog open and show the error. */
  onSave: (items: KubeObjectInterface[]) => Promise<void>;
}

type View = 'yaml' | 'docs';

const MONACO_OPTIONS = {
  automaticLayout: true,
  fontSize: 14,
  tabSize: 2,
  lineNumbers: 'on' as const,
  wordWrap: 'on' as const,
  scrollBeyondLastLine: false,
  padding: { top: 8, bottom: 8 },
  minimap: { enabled: true, scale: 2, showSlider: 'always' as const },
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function DialogHeader({
  title,
  view,
  onViewChange,
  onClose,
}: {
  title: string;
  view: View;
  onViewChange: (view: View) => void;
  onClose: () => void;
}) {
  return (
    <Stack direction="row" alignItems="center" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexGrow: 1, px: 3, py: 2 }}>
        <Icon icon="mdi:pencil" width={20} />
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
      </Stack>
      <Tabs value={view} onChange={(_, next: View) => onViewChange(next)} sx={{ mr: 1 }}>
        <Tab
          value="yaml"
          label="Editor"
          icon={<Icon icon="mdi:code-braces" />}
          iconPosition="start"
        />
        <Tab
          value="docs"
          label="Documentation"
          icon={<Icon icon="mdi:book-open-page-variant" />}
          iconPosition="start"
        />
      </Tabs>
      <IconButton size="small" aria-label="Close" onClick={onClose} sx={{ mr: 1 }}>
        <Icon icon="mdi:close" />
      </IconButton>
    </Stack>
  );
}

/** YAML text with a Monaco editor, or Headlamp's plain editor when "minimal" is on. */
function YamlPane({
  text,
  error,
  onChange,
}: {
  text: string;
  error: string | null;
  onChange: (text: string) => void;
}) {
  const theme = useTheme();
  const [minimal, setMinimal] = useState(false);
  const update = (next?: string) => onChange(next ?? '');
  return (
    // The last grid row takes the remaining height, which Monaco needs to size itself.
    <Box sx={{ height: '100%', display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)' }}>
      <Stack
        direction="row"
        justifyContent="flex-end"
        sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <FormControlLabel
          label="Use minimal editor"
          control={<Switch size="small" checked={minimal} onChange={(_, on) => setMinimal(on)} />}
        />
      </Stack>
      <Box>
        {error && (
          <Typography
            variant="body2"
            sx={{ p: 2, bgcolor: 'error.main', color: 'error.contrastText' }}
          >
            Invalid YAML: {error}
          </Typography>
        )}
      </Box>
      <Box sx={{ p: 2, minHeight: 0 }}>
        {minimal ? (
          <Box sx={{ height: '100%', overflow: 'auto' }}>
            <Resource.SimpleEditor language="yaml" value={text} onChange={update} />
          </Box>
        ) : (
          <Editor
            height="100%"
            language="yaml"
            value={text}
            onChange={update}
            theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
            options={MONACO_OPTIONS}
          />
        )}
      </Box>
    </Box>
  );
}

/** CRD documentation for one of the kinds in the stream; a selector appears for several. */
function DocsPane({
  kinds,
  selected,
  onSelect,
  docs,
}: {
  kinds: KindRef[];
  selected?: KindRef;
  onSelect: (key: string) => void;
  docs: Array<{ apiVersion?: string; kind?: string }> | null;
}) {
  const current = selected && docs?.find(d => kindKey(d) === kindKey(selected));
  return (
    <Stack sx={{ height: '100%', minHeight: 0 }}>
      {kinds.length > 1 && (
        <Box sx={{ px: 3, pt: 2 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            aria-label="Resource kind"
            value={selected ? kindKey(selected) : null}
            onChange={(_, key: string | null) => key && onSelect(key)}
            sx={{ flexWrap: 'wrap' }}
          >
            {kinds.map(k => (
              <ToggleButton key={kindKey(k)} value={kindKey(k)}>
                {k.kind}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
        {selected ? (
          <CRDDocsViewer
            key={kindKey(selected)}
            apiVersion={selected.apiVersion}
            kind={selected.kind}
            value={current}
          />
        ) : (
          <Alert severity="info" sx={{ m: 3 }}>
            Add apiVersion and kind to see documentation.
          </Alert>
        )}
      </Box>
    </Stack>
  );
}

function DiscardDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog open={open} onClose={onKeep}>
      <DialogTitle>Discard changes?</DialogTitle>
      <DialogContentText sx={{ px: 3 }}>
        Your YAML edits have not been applied and will be lost.
      </DialogContentText>
      <DialogActions>
        <Button onClick={onKeep}>Keep editing</Button>
        <Button color="error" onClick={onDiscard}>
          Discard
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ResourceEditorDialog({
  open,
  title,
  items,
  primaryKind,
  saveLabel = 'Save & Apply',
  onClose,
  onSave,
}: ResourceEditorDialogProps) {
  // The original text is fixed at mount so "dirty" survives re-renders with new items.
  const [original] = useState(() => toYamlStream(items));
  const [text, setText] = useState(original);
  const [view, setView] = useState<View>('yaml');
  const [chosenKind, setChosenKind] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const parsed = useMemo(() => parseYamlStream<KubeObjectInterface>(text), [text]);
  // Documented kinds follow the current YAML while it is valid, else the original objects.
  const kinds = useMemo(
    () => distinctKinds(parsed.docs?.length ? parsed.docs : items),
    [parsed.docs, items]
  );
  const selectedKind = pickKind(kinds, chosenKind, primaryKind);
  const canSave = !saving && !!parsed.docs?.length;

  const close = () => {
    if (saving) return;
    if (text === original) onClose();
    else setAskDiscard(true);
  };

  const save = async () => {
    if (!parsed.docs?.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(parsed.docs);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={close} maxWidth="lg" fullWidth>
        <DialogHeader title={title} view={view} onViewChange={setView} onClose={close} />
        <Box sx={{ height: '70vh', overflow: 'hidden' }}>
          {view === 'yaml' ? (
            <YamlPane text={text} error={parsed.error} onChange={setText} />
          ) : (
            <DocsPane
              kinds={kinds}
              selected={selectedKind}
              onSelect={setChosenKind}
              docs={parsed.docs}
            />
          )}
        </Box>
        {saveError && (
          <Alert severity="error" sx={{ mx: 3, mt: 1 }}>
            {saveError}
          </Alert>
        )}
        <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={!canSave}
            startIcon={
              saving ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <Icon icon="mdi:content-save" />
              )
            }
          >
            {saving ? 'Applying…' : saveLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <DiscardDialog
        open={askDiscard}
        onKeep={() => setAskDiscard(false)}
        onDiscard={() => {
          setAskDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
