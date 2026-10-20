import { Router } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObjectInterface } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { applyAll } from '../../utils/apply';
import { ResourceEditorDialog } from './ResourceEditorDialog';

export interface WizardStep {
  label: string;
  /** Short helper text shown under the step title. */
  description?: string;
  content: React.ReactNode;
  /** Blocking validation errors; the user cannot advance while non-empty. */
  errors?: string[];
}

export interface ResourceWizardProps {
  title: string;
  steps: WizardStep[];
  /** Builds the objects to apply, in apply order. Called when the review step is shown. */
  buildResources: () => KubeObjectInterface[];
  /** Optional human-readable summary rendered on the review step. */
  summary?: React.ReactNode;
  /** Optional warning/info rendered below the summary on the review step. */
  reviewNotice?: React.ReactNode;
  /** Route (by name) of the list page to return to on cancel. */
  listRouteName: string;
  /** Route (by name) of the detail page to open after creation, for the primary resource. */
  detailRouteName: string;
  /** Kind of the resource whose detail page is opened after creation. */
  primaryKind: string;
  /** Extra changes to existing objects, listed on the review step (e.g. "Annotate Gateway x"). */
  extraActions?: string[];
  /** Runs after all objects were applied (e.g. patching existing objects); throw on failure. */
  afterApply?: () => Promise<void>;
  /** "edit" relabels the flow (Review & Save / Save / Updated) for editing an existing object. */
  mode?: 'create' | 'edit';
  /**
   * Replaces the default apply (e.g. an update that fails on a resourceVersion conflict); may
   * return warnings, which are shown after a success.
   */
  applyItems?: (items: KubeObjectInterface[]) => Promise<void | string[]>;
  /** URL for Cancel and the back link; defaults to the list page. */
  cancelUrl?: string;
  /**
   * "wizard" shows one step at a time; "form" shows every step as a section on one page.
   * Defaults to the `?layout=form` query parameter, then to "form" when editing.
   */
  layout?: WizardLayout;
}

export type WizardLayout = 'wizard' | 'form';

/** Layout requested through the URL (`?layout=form`), used by the Create menu. */
export function useRequestedLayout(): WizardLayout | undefined {
  const { search } = useLocation();
  const value = new URLSearchParams(search).get('layout');
  return value === 'form' || value === 'wizard' ? value : undefined;
}

/**
 * Generic multi-step creation wizard, also usable as a single-page form (same steps,
 * same validation), for creating or editing. Adds a final "Review & Create" step that lists the generated objects, lets the user
 * inspect or edit them as YAML (with CRD documentation) and applies them in order.
 */
export function ResourceWizard({
  title,
  steps,
  buildResources,
  summary,
  reviewNotice,
  listRouteName,
  detailRouteName,
  primaryKind,
  extraActions = [],
  afterApply,
  mode = 'create',
  applyItems = applyAll,
  cancelUrl,
  layout: layoutProp,
}: ResourceWizardProps) {
  const editing = mode === 'edit';
  const requestedLayout = useRequestedLayout();
  const [layout, setLayout] = useState<WizardLayout>(
    layoutProp || requestedLayout || (editing ? 'form' : 'wizard')
  );
  const isForm = layout === 'form';
  const actionLabel = editing ? 'Save' : 'Create';
  const exitUrl = cancelUrl || Router.createRouteURL(listRouteName);
  const history = useHistory();
  const { enqueueSnackbar } = useSnackbar();
  const [active, setActive] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  // Snapshot of the generated objects while the YAML editor is open (stable identity).
  const [editorItems, setEditorItems] = useState<KubeObjectInterface[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const reviewIndex = steps.length;
  const isReview = !isForm && active === reviewIndex;
  const current = steps[active];
  const currentErrors = current?.errors || [];
  const allErrors = steps.flatMap(s => (s.errors || []).map(e => ({ step: s.label, error: e })));
  const resources = isReview || isForm ? buildResources() : [];

  /** The object being created/edited, for the documentation panel. */
  const primaryDraft = (() => {
    try {
      const items = resources.length ? resources : buildResources();
      return items.find(i => i.kind === primaryKind);
    } catch {
      return undefined;
    }
  })();

  /** Form layout: validate everything, then apply. */
  function submitForm() {
    if (allErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    create(buildResources());
  }

  function switchLayout() {
    setShowErrors(false);
    setApplyError(null);
    setActive(0);
    setLayout(isForm ? 'wizard' : 'form');
  }

  function next() {
    if (currentErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setActive(a => a + 1);
  }

  function back() {
    setShowErrors(false);
    setApplyError(null);
    setActive(a => Math.max(0, a - 1));
  }

  /** Applies the objects and opens the primary one; throws on failure. */
  async function applyAndOpen(items: KubeObjectInterface[]) {
    const warnings = await applyItems(items);
    if (afterApply) {
      try {
        await afterApply();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Resources were ${editing ? 'saved' : 'created'}, but a follow-up step failed: ${message}`
        );
      }
    }
    const primary = items.find(i => i.kind === primaryKind) || items[0];
    enqueueSnackbar(
      `${editing ? 'Updated' : 'Created'} ${items
        .map(i => `${i.kind}/${i.metadata?.name}`)
        .join(', ')}`,
      {
        variant: 'success',
      }
    );
    (warnings || []).forEach(warning => enqueueSnackbar(warning, { variant: 'warning' }));
    history.push(
      Router.createRouteURL(detailRouteName, {
        namespace: primary.metadata?.namespace || '',
        name: primary.metadata?.name || '',
      })
    );
  }

  async function create(items: KubeObjectInterface[]) {
    setApplying(true);
    setApplyError(null);
    try {
      await applyAndOpen(items);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <SectionBox
      title={title}
      backLink={exitUrl}
      headerProps={{
        titleSideActions: [
          <DocsDrawer
            key="docs"
            apiVersion={primaryDraft?.apiVersion}
            kind={primaryKind}
            getValue={() => primaryDraft}
          />,
          <Button key="layout" size="small" onClick={switchLayout}>
            {isForm ? 'Show as wizard' : 'Show as form'}
          </Button>,
        ],
      }}
    >
      {!isForm && (
        <Stepper activeStep={active} alternativeLabel sx={{ mb: 3 }}>
          {steps.map(s => (
            <Step key={s.label}>
              <StepLabel>{s.label}</StepLabel>
            </Step>
          ))}
          <Step key="__review">
            <StepLabel>{editing ? 'Review & Save' : 'Review & Create'}</StepLabel>
          </Step>
        </Stepper>
      )}

      <Box sx={{ maxWidth: 960, mx: 'auto' }}>
        {isForm &&
          steps.map(step => (
            <Paper key={step.label} variant="outlined" sx={{ p: 2.5, mb: 2 }}>
              <Typography variant="h6" component="h2" sx={{ mb: 0.5 }}>
                {step.label}
              </Typography>
              {step.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {step.description}
                </Typography>
              )}
              {step.content}
            </Paper>
          ))}

        {!isForm && !isReview && current && (
          <>
            {current.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {current.description}
              </Typography>
            )}
            {current.content}
            {showErrors && currentErrors.length > 0 && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {currentErrors.map(e => (
                  <div key={e}>{e}</div>
                ))}
              </Alert>
            )}
          </>
        )}

        {(isReview || isForm) && (
          <>
            {!isForm && summary}
            {reviewNotice && <Box sx={{ mt: 2 }}>{reviewNotice}</Box>}
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Resources to be applied (in order)
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {resources.map((r, i) => (
                <Chip
                  key={`${r.kind}-${r.metadata?.name}-${i}`}
                  label={`${i + 1}. ${r.kind} ${r.metadata?.namespace}/${r.metadata?.name}`}
                  variant="outlined"
                  color={r.kind === primaryKind ? 'primary' : 'default'}
                />
              ))}
            </Box>
            {extraActions.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Changes to existing resources (after {editing ? 'saving' : 'creation'})
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {extraActions.map(a => (
                    <Chip key={a} label={a} variant="outlined" />
                  ))}
                </Box>
              </>
            )}
            {resources.some(r => r.kind === 'Secret') && (
              <Alert severity="info" sx={{ mb: 2 }}>
                A Secret will be created with the credential you entered. It is sent directly to the
                Kubernetes API and is not stored by this plugin.
              </Alert>
            )}
            {isForm && showErrors && allErrors.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {allErrors.map(({ step, error }) => (
                  <div key={`${step}|${error}`}>
                    <strong>{step}:</strong> {error}
                  </div>
                ))}
              </Alert>
            )}
            {applyError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {applyError}
              </Alert>
            )}
          </>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, gap: 1 }}>
          <Button onClick={() => history.push(exitUrl)}>Cancel</Button>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {!isForm && (
              <Button disabled={active === 0 || applying} onClick={back}>
                Back
              </Button>
            )}
            {!isForm && !isReview && (
              <Button variant="contained" onClick={next}>
                Next
              </Button>
            )}
            {(isReview || isForm) && (
              <>
                <Button
                  variant="outlined"
                  disabled={applying}
                  onClick={() => setEditorItems(buildResources())}
                >
                  Edit YAML
                </Button>
                <Button
                  variant="contained"
                  disabled={applying}
                  onClick={() => (isForm ? submitForm() : create(resources))}
                  startIcon={applying ? <CircularProgress size={16} /> : undefined}
                >
                  {actionLabel}
                </Button>
              </>
            )}
          </Box>
        </Box>
      </Box>

      {editorItems && (
        <ResourceEditorDialog
          open
          title={`${title}: review YAML`}
          items={editorItems}
          primaryKind={primaryKind}
          saveLabel={actionLabel}
          onClose={() => setEditorItems(null)}
          onSave={applyAndOpen}
        />
      )}
    </SectionBox>
  );
}
