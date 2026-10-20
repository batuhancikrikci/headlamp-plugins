/**
 * Create / edit dialog of a single resource.
 *
 * Tabs: the guided form (or wizard), the YAML editor, the review step and the documentation.
 * Form and YAML edit the same object, so switching between them never loses data: a form change
 * regenerates the YAML and a YAML change is parsed back into the object the form renders.
 *
 * Nothing is written without passing the review tab, which validates the resource on the client,
 * runs a server-side dry-run and shows what will change.
 */
import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { Dialog, Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog as MuiDialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Tab,
  Tabs,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { CRDDocsViewer } from '../../common/docs/CRDDocsViewer';
import { writeResource } from '../../data/api';
import { GatewayApiData } from '../../data/GatewayApiData';
import { useDiscovery } from '../../discovery/discovery';
import { classOf } from '../../resources/classes';
import { kindInfo, KindName } from '../../resources/registry';
import { KubeJson } from '../../resources/types';
import { ApiFailure } from '../../utils/apiPaths';
import { errorsOnly, validateResource } from '../../utils/validation';
import { cleanForDisplay, parseYaml, toYaml } from '../../utils/yaml';
import { FormProvider } from './form/FormContext';
import { FORMS } from './forms';
import { DryRunState, ReviewPanel } from './ReviewPanel';
import { WIZARDS } from './wizards';

export type EditorVariant = 'form' | 'wizard' | 'yaml';
type TabId = 'form' | 'yaml' | 'review' | 'docs';

export interface ResourceEditorProps {
  open: boolean;
  onClose: () => void;
  kind: KindName;
  mode: 'create' | 'edit';
  /** The new resource template, or the live object prepared with `cleanForEdit`. */
  initial: KubeJson;
  variant: EditorVariant;
}

/** Props of a wizard: it edits the resource through the form context like any form. */
export interface WizardProps {
  /** Opens the review tab. */
  onReview: () => void;
  /** Makes every field show its validation error. */
  onRevealErrors: () => void;
}

export function ResourceEditor({
  open,
  onClose,
  kind,
  mode,
  initial,
  variant,
}: ResourceEditorProps) {
  const info = kindInfo(kind);
  const theme = useTheme();
  const history = useHistory();
  const { enqueueSnackbar } = useSnackbar();
  const discovery = useDiscovery();

  const Wizard = variant === 'wizard' ? WIZARDS[kind] : undefined;
  const Form = variant === 'yaml' ? undefined : FORMS[kind];
  const firstTab: TabId = Form ? 'form' : 'yaml';

  const [value, setValue] = React.useState<KubeJson>(initial);
  const [yamlText, setYamlText] = React.useState(() => toYaml(initial));
  const [yamlError, setYamlError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>(firstTab);
  const [showAllErrors, setShowAllErrors] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const [dryRun, setDryRun] = React.useState<DryRunState>({ status: 'idle' });
  const [applying, setApplying] = React.useState(false);
  const [applyFailure, setApplyFailure] = React.useState<ApiFailure | null>(null);
  /** Identifies the newest dry-run, so the result of an outdated one is ignored. */
  const dryRunToken = React.useRef(0);

  // Start from a clean slate every time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setValue(initial);
    setYamlText(toYaml(initial));
    setYamlError(null);
    setTab(firstTab);
    setShowAllErrors(false);
    setDirty(false);
    setDryRun({ status: 'idle' });
    setApplying(false);
    setApplyFailure(null);
    dryRunToken.current += 1;
  }, [open, initial, firstTab]);

  const issues = React.useMemo(() => validateResource(value), [value]);
  const errors = React.useMemo(() => errorsOnly(issues), [issues]);
  const warnings = React.useMemo(() => issues.filter(i => i.severity === 'warning'), [issues]);

  const originalYaml = React.useMemo(
    () => (mode === 'edit' ? toYaml(cleanForDisplay(initial)) : ''),
    [mode, initial]
  );
  const currentYaml = React.useMemo(() => toYaml(cleanForDisplay(value)), [value]);
  const unchanged = mode === 'edit' && originalYaml === currentYaml;

  const invalidateResults = () => {
    dryRunToken.current += 1;
    setDryRun({ status: 'idle' });
    setApplyFailure(null);
  };

  const handleFormChange = React.useCallback((next: KubeJson) => {
    setValue(next);
    setYamlText(toYaml(next));
    setYamlError(null);
    setDirty(true);
    dryRunToken.current += 1;
    setDryRun({ status: 'idle' });
    setApplyFailure(null);
  }, []);

  const handleYamlChange = (text?: string) => {
    const code = text ?? '';
    setYamlText(code);
    setDirty(true);
    invalidateResults();
    const parsed = parseYaml(code);
    if (parsed.value) {
      setValue(parsed.value);
      setYamlError(null);
    } else {
      // Keep the last valid object for the form; the text is kept as typed.
      setYamlError(
        `${parsed.error || 'Invalid YAML'}${parsed.line ? ` (line ${parsed.line})` : ''}`
      );
    }
  };

  const canDryRun = !yamlError && errors.length === 0 && !unchanged;

  const runDryRun = React.useCallback(async () => {
    const token = ++dryRunToken.current;
    setDryRun({ status: 'running' });
    setApplyFailure(null);
    const result = await writeResource(value, mode === 'create' ? 'create' : 'update', {
      dryRun: true,
    });
    if (token !== dryRunToken.current) return;
    setDryRun(
      result.failure ? { status: 'failed', failure: result.failure } : { status: 'passed' }
    );
  }, [value, mode]);

  const openReview = () => {
    setShowAllErrors(true);
    setTab('review');
    if (canDryRun && dryRun.status === 'idle') runDryRun();
  };

  const changeTab = (next: TabId) => {
    if (next === 'review') openReview();
    else setTab(next);
  };

  const apply = async () => {
    setApplying(true);
    setApplyFailure(null);
    const result = await writeResource(value, mode === 'create' ? 'create' : 'update');
    setApplying(false);
    if (result.failure) {
      setApplyFailure(result.failure);
      return;
    }
    const name = value.metadata?.name;
    enqueueSnackbar(`${info.kind} "${name}" ${mode === 'create' ? 'created' : 'saved'}`, {
      variant: 'success',
    });
    setDirty(false);
    onClose();
    if (mode === 'create') {
      history.push(
        Router.createRouteURL(classOf(kind).detailsRoute, {
          name: name || '',
          ...(info.namespaced ? { namespace: value.metadata?.namespace || '' } : {}),
        })
      );
    }
  };

  const requestClose = () => {
    if (applying) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  const title =
    mode === 'create'
      ? `Create ${info.label}`
      : `Edit ${info.label}: ${initial.metadata?.name || ''}`;
  const applyLabel = mode === 'create' ? 'Create' : 'Save changes';

  const formContent =
    Form && discovery.status === 'ready' ? (
      <GatewayApiData
        availability={discovery.availability}
        kinds={['GatewayClass', 'Gateway', 'ListenerSet']}
        core={['Namespace']}
      >
        <FormProvider
          value={value}
          onChange={handleFormChange}
          issues={issues}
          showAllErrors={showAllErrors}
          mode={mode}
          availability={discovery.availability}
        >
          {Wizard ? (
            <Wizard onReview={openReview} onRevealErrors={() => setShowAllErrors(true)} />
          ) : (
            <Form />
          )}
        </FormProvider>
      </GatewayApiData>
    ) : Form ? (
      <Loader title="Loading…" />
    ) : null;

  return (
    <>
      <Dialog
        open={open}
        onClose={requestClose}
        title={title}
        withFullScreen
        fullWidth
        maxWidth="lg"
        PaperProps={{ sx: { height: '90vh' } }}
      >
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tabs
            value={tab}
            onChange={(_event, next: TabId) => changeTab(next)}
            aria-label="Editor sections"
            variant="scrollable"
            scrollButtons="auto"
          >
            {Form && (
              <Tab
                value="form"
                label={Wizard ? 'Wizard' : 'Form'}
                icon={<Icon icon={Wizard ? 'mdi:wizard-hat' : 'mdi:form-select'} />}
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
              value="review"
              label="Review"
              icon={<Icon icon="mdi:clipboard-check-outline" />}
              iconPosition="start"
            />
            <Tab
              value="docs"
              label="Documentation"
              icon={<Icon icon="mdi:book-open-variant" />}
              iconPosition="start"
            />
          </Tabs>
        </Box>

        <DialogContent
          sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0, flexGrow: 1 }}
        >
          {yamlError && tab === 'form' && (
            <Alert severity="warning" sx={{ borderRadius: 0 }}>
              The YAML has a syntax error, so the form shows the last valid version. Changing a
              field here replaces the invalid YAML. {yamlError}
            </Alert>
          )}
          {yamlError && tab === 'yaml' && (
            <Alert severity="error" sx={{ borderRadius: 0 }}>
              {yamlError}
            </Alert>
          )}
          <Box
            sx={{
              flexGrow: 1,
              minHeight: 0,
              overflow: tab === 'yaml' ? 'hidden' : 'auto',
            }}
          >
            {/* The form stays mounted so wizard progress survives a visit to another tab. */}
            {Form && (
              <Box sx={{ p: 3, display: tab === 'form' ? 'block' : 'none' }}>{formContent}</Box>
            )}
            {tab === 'yaml' && (
              <Editor
                language="yaml"
                value={yamlText}
                onChange={handleYamlChange}
                theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
                height="100%"
                options={{
                  automaticLayout: true,
                  minimap: { enabled: false },
                  tabSize: 2,
                  scrollBeyondLastLine: false,
                }}
              />
            )}
            {tab === 'review' && (
              <ReviewPanel
                mode={mode}
                originalYaml={originalYaml}
                currentYaml={currentYaml}
                yamlError={yamlError}
                errors={errors}
                warnings={warnings}
                dryRun={dryRun}
                onRetryDryRun={runDryRun}
                applyFailure={applyFailure}
              />
            )}
            {tab === 'docs' && (
              <CRDDocsViewer apiVersion={value.apiVersion} kind={value.kind} value={value} />
            )}
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button onClick={requestClose} color="secondary" disabled={applying}>
            Cancel
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          {tab === 'review' ? (
            <>
              <Button onClick={() => setTab(firstTab)} disabled={applying}>
                Back to editing
              </Button>
              <Button
                variant="contained"
                onClick={apply}
                disabled={applying || dryRun.status !== 'passed'}
                startIcon={applying ? <CircularProgress size={16} /> : <Icon icon="mdi:check" />}
              >
                {applyLabel}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              onClick={openReview}
              endIcon={<Icon icon="mdi:chevron-right" />}
            >
              Review and {mode === 'create' ? 'create' : 'save'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <MuiDialog open={confirmClose} onClose={() => setConfirmClose(false)}>
        <DialogTitle>Discard changes?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have unsaved changes. Closing the editor discards them.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmClose(false);
              onClose();
            }}
          >
            Discard
          </Button>
        </DialogActions>
      </MuiDialog>
    </>
  );
}
