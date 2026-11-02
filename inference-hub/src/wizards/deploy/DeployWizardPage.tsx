import { Icon } from '@iconify/react';
import { NameValueTable, SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Button, Grid, Step, StepButton, Stepper, Typography } from '@mui/material';
import React from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { Discovery, isServed, locationsOf } from '../../api/discovery';
import { isNotFound } from '../../api/liveStore';
import { customItemPath } from '../../api/paths';
import { DocsDrawer } from '../../common/docs/DocsDrawer';
import { t } from '../../common/i18n';
import { EmptyState, ErrorState, LoadingState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { MultiYamlEditor } from '../../components/common/MultiYamlEditor';
import { useCan } from '../../hooks/useCan';
import { useDefaultNamespace } from '../../hooks/useEndpoints';
import { useLivePath, useResourceList } from '../../hooks/useLive';
import { RESOURCES } from '../../resources/definitions';
import { EndpointSlug } from '../../resources/endpoint';
import { KubeJson } from '../../resources/types';
import { endpointUrl } from '../../routes';
import {
  buildObjects,
  defaultForm,
  DeployForm,
  Errors,
  StepId,
  STEPS,
  suggestName,
  suggestServedName,
  totalGpus,
  validateStep,
} from './deployModel';
import { formFromEndpoint } from './editModel';
import { EditReview } from './EditReview';
import { ResourcesStep } from './ResourcesStep';
import { ScalingStep } from './ScalingStep';
import { ServingStep } from './ServingStep';
import { LocalModelCacheJson, SourceStep } from './SourceStep';
import { EditingEndpoint } from './stepTypes';

const STEP_LABELS: Record<StepId, { label: string; help: string }> = {
  source: {
    label: 'Model',
    help: 'Pick a model from the catalog or point to its weights, and name the endpoint.',
  },
  serving: { label: 'Serving', help: 'Choose how the model is served and routed.' },
  resources: {
    label: 'Resources',
    help: 'Size the model server and check that it fits on your GPUs.',
  },
  scaling: { label: 'Scaling', help: 'Fixed replicas or autoscaling.' },
  review: {
    label: 'Review & deploy',
    help: 'Check the generated YAML, validate it against the API server and deploy.',
  },
};

function initialForm(search: string, namespace: string, discovery: Discovery): DeployForm {
  const params = new URLSearchParams(search);
  const form = defaultForm(params.get('namespace') || namespace);
  if (!isServed(discovery, 'llminferenceservices') && isServed(discovery, 'inferenceservices'))
    form.mode = 'isvc';
  if (!isServed(discovery, 'localmodelcaches')) form.source = 'custom';
  const uri = params.get('uri');
  if (uri) {
    const served = suggestServedName(uri);
    Object.assign(form, {
      source: params.get('cache') ? 'catalog' : 'custom',
      cacheName: params.get('cache') || '',
      uri,
      servedModelName: served,
      name: suggestName(served || uri),
    });
  }
  return form;
}

function Summary({ form }: { form: DeployForm }) {
  return (
    <NameValueTable
      rows={[
        { name: t('Endpoint'), value: `${form.namespace}/${form.name}` },
        {
          name: t('Type'),
          value: form.mode === 'llm' ? 'LLMInferenceService' : 'InferenceService',
        },
        { name: t('Model'), value: `${form.servedModelName} (${form.uri})` },
        {
          name: t('Routing'),
          value:
            form.routing === 'scheduler'
              ? t('Gateway + llm-d scheduler')
              : form.routing === 'route'
              ? t('Gateway only')
              : t('In-cluster only'),
          hide: form.mode !== 'llm',
        },
        {
          name: t('Serving profiles'),
          value: form.profiles.join(', '),
          hide: !form.profiles.length,
        },
        {
          name: t('GPUs'),
          value: t('{{g}} × {{r}} per replica, {{t}} in total', {
            g: form.gpus,
            r: form.gpuResource,
            t: totalGpus(form),
          }),
        },
        {
          name: t('Replicas'),
          value: form.autoscale ? `${form.minReplicas} – ${form.maxReplicas}` : form.replicas,
        },
        {
          name: t('Added to catalog'),
          value: t('Yes'),
          hide: !(form.source === 'custom' && form.addToCatalog),
        },
      ]}
    />
  );
}

/** Why the user cannot save the endpoint (and its catalog entry), if they cannot. */
function useBlockedReason(
  discovery: Discovery,
  form: DeployForm,
  editing: boolean
): string | undefined {
  const target =
    form.mode === 'llm'
      ? locationsOf(discovery, 'llminferenceservices')[0]
      : locationsOf(discovery, 'inferenceservices')[0];
  const canCreate = useCan(
    target && form.namespace
      ? {
          verb: editing ? 'update' : 'create',
          group: target.group,
          resource: form.mode === 'llm' ? 'llminferenceservices' : 'inferenceservices',
          namespace: form.namespace,
          ...(editing ? { name: form.name } : {}),
        }
      : null
  );
  const cacheLoc = locationsOf(discovery, 'localmodelcaches')[0];
  const canCreateCache = useCan(
    form.source === 'custom' && form.addToCatalog && cacheLoc
      ? { verb: 'create', group: cacheLoc.group, resource: 'localmodelcaches' }
      : null
  );
  return canCreate.allowed === false
    ? canCreate.reason
    : form.source === 'custom' && form.addToCatalog && canCreateCache.allowed === false
    ? canCreateCache.reason
    : undefined;
}

function editingOf(form: DeployForm): EditingEndpoint {
  return {
    kind: form.mode === 'llm' ? 'LLMInferenceService' : 'InferenceService',
    name: form.name,
    namespace: form.namespace,
  };
}

/** An existing endpoint opened in the wizard or the form. */
interface EditState {
  slug: EndpointSlug;
  /** The live object when the wizard was opened. */
  live: KubeJson;
  /** Form of the live object; fields still equal to it are left untouched. */
  original: DeployForm;
  notes: string[];
}

function Wizard({
  discovery,
  initial,
  edit,
  onSwitch,
}: {
  discovery: Discovery;
  initial: DeployForm;
  edit?: EditState;
  /** Opens the form instead, with what was entered so far. */
  onSwitch?: (form: DeployForm) => void;
}) {
  const history = useHistory();
  const [form, setForm] = React.useState<DeployForm>(initial);
  const [active, setActive] = React.useState(0);
  const [showErrors, setShowErrors] = React.useState<Record<string, boolean>>({});
  const caches = useResourceList<LocalModelCacheJson>(
    'localmodelcaches',
    form.source === 'catalog' ? {} : null,
    60000
  );

  // Complete a catalog preselection (?cache=name) once the catalog is loaded.
  React.useEffect(() => {
    if (form.source !== 'catalog' || !form.cacheName || form.uri) return;
    const cache = caches.items.find(c => c.metadata.name === form.cacheName);
    const uri = cache?.spec?.sourceModelUri;
    if (uri) {
      const served = suggestServedName(uri);
      setForm(f => ({ ...f, uri, servedModelName: served, name: f.name || suggestName(served) }));
    }
  }, [caches.items, form.source, form.cacheName, form.uri]);

  const update = React.useCallback(
    (patch: Partial<DeployForm>) => setForm(f => ({ ...f, ...patch })),
    []
  );
  const step = STEPS[active];
  const errorsByStep = React.useMemo(
    () =>
      Object.fromEntries(STEPS.map(s => [s, validateStep(s, form, edit?.original)])) as Record<
        StepId,
        Errors
      >,
    [form, edit]
  );
  const stepErrors = errorsByStep[step];
  const shownErrors = showErrors[step] ? stepErrors : {};

  const versions = {
    llm: locationsOf(discovery, 'llminferenceservices')[0]?.apiVersion,
    isvc: locationsOf(discovery, 'inferenceservices')[0]?.apiVersion,
    cache: locationsOf(discovery, 'localmodelcaches')[0]?.apiVersion,
  };
  const objects = React.useMemo(
    () => (step === 'review' && !edit ? buildObjects(form, versions) : []),
    [step, form, edit, versions.llm, versions.isvc, versions.cache]
  );

  // The endpoint being built (the last object; a catalog entry may come first).
  const draft = edit ? edit.live : buildObjects(form, versions).slice(-1)[0];

  const blocked = useBlockedReason(discovery, form, !!edit);

  const goTo = (index: number) => {
    // Moving forward requires the current step to be valid.
    if (index > active && Object.keys(stepErrors).length > 0) {
      setShowErrors(s => ({ ...s, [step]: true }));
      return;
    }
    if (index > active + 1) {
      const firstInvalid = STEPS.slice(active, index).findIndex(
        s => Object.keys(errorsByStep[s]).length > 0
      );
      if (firstInvalid >= 0) {
        setActive(active + firstInvalid);
        setShowErrors(s => ({ ...s, [STEPS[active + firstInvalid]]: true }));
        return;
      }
    }
    setActive(index);
  };

  const props = {
    form,
    update,
    errors: shownErrors,
    discovery,
    editing: edit ? editingOf(form) : undefined,
  };

  return (
    <SectionBox
      title={edit ? t('Edit {{name}}', { name: form.name }) : t('Deploy a model')}
      headerProps={{
        titleSideActions: [
          ...(onSwitch
            ? [
                <Button
                  key="switch"
                  size="small"
                  startIcon={<Icon icon="mdi:form-select" />}
                  onClick={() => onSwitch(form)}
                >
                  {t('Switch to the form')}
                </Button>,
              ]
            : []),
          <DocsDrawer key="docs" apiVersion={draft?.apiVersion} kind={draft?.kind} value={draft} />,
        ],
      }}
    >
      <Stepper nonLinear activeStep={active} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((s, i) => (
          <Step key={s} completed={i < active && Object.keys(errorsByStep[s]).length === 0}>
            <StepButton onClick={() => goTo(i)}>{t(STEP_LABELS[s].label)}</StepButton>
          </Step>
        ))}
      </Stepper>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(STEP_LABELS[step].help)}
      </Typography>

      <Box sx={{ minHeight: 360 }}>
        {step === 'source' && <SourceStep {...props} />}
        {step === 'serving' && <ServingStep {...props} />}
        {step === 'resources' && <ResourcesStep {...props} />}
        {step === 'scaling' && <ScalingStep {...props} />}
        {step === 'review' && (
          <Grid container spacing={2}>
            <Grid item xs={12} lg={4}>
              <Summary form={form} />
            </Grid>
            <Grid item xs={12} lg={8}>
              {Object.keys(stepErrors).length > 0 ? (
                <Typography color="error">
                  {t('Fix the highlighted fields in the earlier steps first.')}
                </Typography>
              ) : edit ? (
                <EditReview
                  live={edit.live}
                  original={edit.original}
                  form={form}
                  notes={edit.notes}
                  disabledReason={blocked}
                  onSaved={() => history.push(endpointUrl(edit.slug, form.namespace, form.name))}
                />
              ) : (
                <MultiYamlEditor
                  objects={objects}
                  submitLabel={t('Deploy')}
                  disabledReason={blocked}
                  onCreated={() =>
                    history.push(
                      endpointUrl(form.mode === 'llm' ? 'llm' : 'isvc', form.namespace, form.name)
                    )
                  }
                />
              )}
            </Grid>
          </Grid>
        )}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button
          disabled={active === 0}
          onClick={() => setActive(a => a - 1)}
          startIcon={<Icon icon="mdi:arrow-left" />}
        >
          {t('Back')}
        </Button>
        {step !== 'review' && (
          <Button
            variant="contained"
            onClick={() => goTo(active + 1)}
            endIcon={<Icon icon="mdi:arrow-right" />}
          >
            {t('Next')}
          </Button>
        )}
      </Box>
    </SectionBox>
  );
}

function CreateWizard({ discovery }: { discovery: Discovery }) {
  const location = useLocation();
  const defaultNamespace = useDefaultNamespace();
  const [initial] = React.useState(() => initialForm(location.search, defaultNamespace, discovery));
  return <Wizard discovery={discovery} initial={initial} />;
}

export function DeployWizardPage() {
  return (
    <DiscoveryGate
      title={t('Deploy a model')}
      anyOf={['llminferenceservices', 'inferenceservices']}
    >
      {discovery => <CreateWizard discovery={discovery} />}
    </DiscoveryGate>
  );
}

const FORM_SECTIONS = ['source', 'serving', 'resources', 'scaling'] as const;

/**
 * An existing endpoint edited on one page: the steps of the wizard one below the other, then the
 * review of the changes. Errors are shown while typing; fields still equal to the live object
 * are not validated.
 */
function EditForm({
  discovery,
  initial,
  edit,
  onSwitch,
}: {
  discovery: Discovery;
  initial: DeployForm;
  edit: EditState;
  /** Opens the wizard instead, with what was entered so far. */
  onSwitch: (form: DeployForm) => void;
}) {
  const history = useHistory();
  const [form, setForm] = React.useState<DeployForm>(initial);
  const update = React.useCallback(
    (patch: Partial<DeployForm>) => setForm(f => ({ ...f, ...patch })),
    []
  );
  const errors = React.useMemo(
    () => validateStep('review', form, edit.original),
    [form, edit.original]
  );
  const blocked = useBlockedReason(discovery, form, true);
  const props = { form, update, errors, discovery, editing: editingOf(form) };

  return (
    <SectionBox
      title={t('Edit {{name}}', { name: form.name })}
      headerProps={{
        titleSideActions: [
          <Button
            key="switch"
            size="small"
            startIcon={<Icon icon="mdi:auto-fix" />}
            onClick={() => onSwitch(form)}
          >
            {t('Switch to the wizard')}
          </Button>,
          <DocsDrawer
            key="docs"
            apiVersion={edit.live.apiVersion}
            kind={edit.live.kind}
            value={edit.live}
          />,
        ],
      }}
    >
      {FORM_SECTIONS.map(section => (
        <Box key={section} component="section" sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            {t(STEP_LABELS[section].label)}
          </Typography>
          {section === 'source' && <SourceStep {...props} />}
          {section === 'serving' && <ServingStep {...props} />}
          {section === 'resources' && <ResourcesStep {...props} />}
          {section === 'scaling' && <ScalingStep {...props} />}
        </Box>
      ))}
      <Box component="section">
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          {t('Review & save')}
        </Typography>
        {Object.keys(errors).length > 0 ? (
          <Typography color="error">{t('Fix the highlighted fields above first.')}</Typography>
        ) : (
          <EditReview
            live={edit.live}
            original={edit.original}
            form={form}
            notes={edit.notes}
            disabledReason={blocked}
            onSaved={() => history.push(endpointUrl(edit.slug, form.namespace, form.name))}
          />
        )}
      </Box>
    </SectionBox>
  );
}

const RESOURCE_BY_SLUG = { llm: 'llminferenceservices', isvc: 'inferenceservices' } as const;

function EditWizard({
  discovery,
  slug,
  namespace,
  name,
}: {
  discovery: Discovery;
  slug: EndpointSlug;
  namespace: string;
  name: string;
}) {
  const history = useHistory();
  const routerLocation = useLocation();
  // The form is the default; ?view=wizard opens the wizard. Switching keeps what was entered.
  const [view, setView] = React.useState<'form' | 'wizard'>(() =>
    new URLSearchParams(routerLocation.search).get('view') === 'wizard' ? 'wizard' : 'form'
  );
  const [draft, setDraft] = React.useState<DeployForm | null>(null);
  const switchTo = (next: 'form' | 'wizard') => (form: DeployForm) => {
    setDraft(form);
    setView(next);
    history.replace({ search: next === 'wizard' ? '?view=wizard' : '' });
  };
  const id = RESOURCE_BY_SLUG[slug];
  const location = locationsOf(discovery, id)[0];
  const item = useLivePath<KubeJson>(customItemPath(RESOURCES[id], location, name, namespace));
  const catalogServed = isServed(discovery, 'localmodelcaches');
  const caches = useResourceList<LocalModelCacheJson>(
    'localmodelcaches',
    catalogServed ? {} : null,
    60000
  );
  const catalogReady = !catalogServed || !caches.loading;

  // The live object is taken once: later updates must not reset the form being edited.
  const [state, setState] = React.useState<(EditState & { blocked?: string }) | null>(null);
  React.useEffect(() => {
    if (state || !item.data || !catalogReady) return;
    const kind = slug === 'llm' ? 'LLMInferenceService' : 'InferenceService';
    const source = formFromEndpoint(
      item.data,
      kind,
      caches.items
        .filter(c => c.spec?.sourceModelUri)
        .map(c => ({ name: c.metadata.name, uri: c.spec!.sourceModelUri! }))
    );
    setState({
      slug,
      live: item.data,
      original: source.form,
      notes: source.notes,
      blocked: source.blocked,
    });
  }, [state, item.data, catalogReady, caches.items, slug]);

  const back = () => history.push(endpointUrl(slug, namespace, name));
  if (!state) {
    if (isNotFound(item.error)) {
      return (
        <SectionBox title={t('Edit {{name}}', { name })}>
          <EmptyState
            icon="mdi:file-question-outline"
            title={t('Endpoint {{ns}}/{{name}} was not found', { ns: namespace, name })}
            description={t('It may have been deleted.')}
          />
        </SectionBox>
      );
    }
    if (item.error && !item.data) {
      return (
        <SectionBox title={t('Edit {{name}}', { name })}>
          <ErrorState error={item.error} onRetry={item.refetch} />
        </SectionBox>
      );
    }
    return <LoadingState title={t('Loading endpoint…')} />;
  }
  if (state.blocked) {
    return (
      <SectionBox title={t('Edit {{name}}', { name })}>
        <EmptyState
          icon="mdi:file-document-edit-outline"
          title={t('This endpoint cannot be edited with the form')}
          description={t(state.blocked)}
          action={
            <Button variant="outlined" startIcon={<Icon icon="mdi:arrow-left" />} onClick={back}>
              {t('Back to the endpoint')}
            </Button>
          }
        />
      </SectionBox>
    );
  }
  const initial = draft || state.original;
  return view === 'wizard' ? (
    <Wizard
      key="wizard"
      discovery={discovery}
      initial={initial}
      edit={state}
      onSwitch={switchTo('form')}
    />
  ) : (
    <EditForm
      key="form"
      discovery={discovery}
      initial={initial}
      edit={state}
      onSwitch={switchTo('wizard')}
    />
  );
}

/** The edit form of an existing endpoint, or the Deploy Model wizard with ?view=wizard. */
export function EditEndpointPage() {
  const { slug, namespace, name } = useParams<{
    slug: EndpointSlug;
    namespace: string;
    name: string;
  }>();
  const id = RESOURCE_BY_SLUG[slug] || RESOURCE_BY_SLUG.llm;
  return (
    <DiscoveryGate title={t('Edit {{name}}', { name })} anyOf={[id]}>
      {discovery => (
        <EditWizard discovery={discovery} slug={slug} namespace={namespace} name={name} />
      )}
    </DiscoveryGate>
  );
}
