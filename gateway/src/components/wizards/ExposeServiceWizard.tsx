/**
 * "Expose a Service" wizard: an end-to-end flow that creates an HTTPRoute for a Service, on an
 * existing or a new Gateway, including the ReferenceGrants needed when namespaces differ.
 *
 * The answers live in a small draft object edited with the regular form fields; the resources
 * are derived from it (see utils/exposeService.ts) and go through a dry-run before being created.
 */
import { Icon } from '@iconify/react';
import { Router } from '@kinvolk/headlamp-plugin/lib';
import { Dialog, Loader } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { writeResource, WriteResult } from '../../data/api';
import { GatewayApiData, useGatewayApiData } from '../../data/GatewayApiData';
import { useNamespaceFilter } from '../../data/useNamespaceFilter';
import { apiVersionFor, Availability } from '../../discovery/availability';
import { useDiscovery } from '../../discovery/discovery';
import { classOf } from '../../resources/classes';
import { kindInfo } from '../../resources/registry';
import { KubeJson, Listener } from '../../resources/types';
import { computeHealth } from '../../utils/conditions';
import { describeListener } from '../../utils/describe';
import {
  buildExposePlan,
  ExposeDraft,
  exposedUrls,
  ExposePlan,
  followService,
  newExposeDraft,
  validateExposeDraft,
} from '../../utils/exposeService';
import { asArray, asRecord, asString, getIn, isPlainObject, setIn } from '../../utils/objects';
import { parseParentText } from '../../utils/refs';
import { controllerLabel } from '../../utils/templates';
import { toYaml } from '../../utils/yaml';
import { CodeBlock } from '../common/CodeBlock';
import { HealthChip } from '../common/Status';
import {
  Combo,
  ComboInput,
  FieldGrid,
  FormSection,
  NumberInput,
  Option,
  SelectInput,
  StringListInput,
  TextInput,
} from '../editor/form/Fields';
import { FormProvider, useFieldIssue, useForm } from '../editor/form/FormContext';
import { NamespaceInput, SecretNameInput, WithNamespacedList } from '../editor/form/Pickers';
import { ApiFailureAlert } from '../editor/ReviewPanel';
import { SummaryList, WizardShell, WizardStep } from '../editor/WizardShell';

/** The draft is stored in the form context, which is typed for resources. */
function asDraft(value: KubeJson): ExposeDraft {
  return value as unknown as ExposeDraft;
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

interface ServicePort {
  port?: number;
  name?: string;
  protocol?: string;
}

function ServiceStep() {
  const { value, update, set } = useForm();
  const draft = asDraft(value);
  const nameIssue = useFieldIssue('service.name');
  const portIssue = useFieldIssue('service.port');

  return (
    <FormSection
      title="Service"
      description="The Service that should become reachable from outside the cluster."
    >
      <NamespaceInput
        path="service.namespace"
        label="Namespace"
        required
        help="Namespace of the Service"
      />
      <WithNamespacedList kind="Service" namespace={draft.service.namespace}>
        {services => {
          const service = (services || []).find(s => s.metadata?.name === draft.service.name);
          const ports = asArray<ServicePort>(asRecord(service?.spec).ports).filter(isPlainObject);
          const options: Option[] = (services || [])
            .map(s => ({
              value: s.metadata?.name || '',
              description: asArray<ServicePort>(asRecord(s.spec).ports)
                .map(p => p?.port)
                .join(', '),
            }))
            .filter(option => option.value);
          return (
            <FieldGrid>
              <Combo
                label="Service"
                required
                value={draft.service.name}
                options={options}
                error={!!nameIssue.error}
                helper={
                  nameIssue.error ||
                  (services && options.length === 0
                    ? `No Services found in "${draft.service.namespace}"`
                    : undefined)
                }
                onBlur={nameIssue.onBlur}
                onChange={(next, option) =>
                  update(current => {
                    let result = setIn(current, 'service.name', next);
                    if (option) {
                      // A Service with a single port needs no further choice.
                      const picked = (services || []).find(s => s.metadata?.name === option.value);
                      const pickedPorts = asArray<ServicePort>(asRecord(picked?.spec).ports);
                      if (pickedPorts.length === 1 && pickedPorts[0]?.port !== undefined) {
                        result = setIn(result, 'service.port', pickedPorts[0].port);
                      }
                    }
                    return result;
                  })
                }
              />
              {ports.length > 0 ? (
                <Combo
                  label="Port"
                  required
                  value={draft.service.port === undefined ? '' : String(draft.service.port)}
                  options={ports.map(p => ({
                    value: String(p.port),
                    description: [p.name, p.protocol].filter(Boolean).join(' / '),
                  }))}
                  error={!!portIssue.error}
                  helper={portIssue.error}
                  onBlur={portIssue.onBlur}
                  onChange={text =>
                    set(
                      'service.port',
                      text === '' ? undefined : /^\d+$/.test(text) ? Number(text) : text
                    )
                  }
                />
              ) : (
                <NumberInput path="service.port" label="Port" required min={1} max={65535} />
              )}
            </FieldGrid>
          );
        }}
      </WithNamespacedList>
    </FormSection>
  );
}

function gatewayKey(gateway: KubeJson): string {
  return `${gateway.metadata?.namespace}/${gateway.metadata?.name}`;
}

function ExistingGatewayFields() {
  const { value, update } = useForm();
  const draft = asDraft(value);
  const data = useGatewayApiData();
  const nameIssue = useFieldIssue('existing.name');
  const gateways = data.json('Gateway') || [];
  const selected = gateways.find(
    g =>
      g.metadata?.name === draft.existing.name && g.metadata?.namespace === draft.existing.namespace
  );
  const listeners = (
    asArray<Listener>(asRecord(selected?.spec).listeners).filter(
      isPlainObject
    ) as unknown as Listener[]
  ).filter(listener => listener.protocol === 'HTTP' || listener.protocol === 'HTTPS');

  const options: Option[] = gateways.map(gateway => ({
    value: gatewayKey(gateway),
    description: asArray<Listener>(asRecord(gateway.spec).listeners)
      .filter(isPlainObject)
      .map(listener => describeListener(listener as unknown as Listener))
      .join(' · '),
  }));
  const current = draft.existing.name ? `${draft.existing.namespace}/${draft.existing.name}` : '';

  return (
    <Stack spacing={2}>
      {data.list('Gateway') !== null && gateways.length === 0 && (
        <Alert severity="info">
          No Gateway exists yet (or you cannot see any). Choose "Create a new Gateway" instead.
        </Alert>
      )}
      <FieldGrid minWidth={260}>
        <Combo
          label="Gateway"
          required
          value={options.some(o => o.value === current) ? current : draft.existing.name}
          options={options}
          loading={data.list('Gateway') === null}
          error={!!nameIssue.error}
          helper={nameIssue.error || 'Shown as namespace/name'}
          onBlur={nameIssue.onBlur}
          onChange={(text, option) =>
            update(state => {
              // Picked options and typed text are both `namespace/name` (or just a name).
              const parsed = parseParentText(option ? option.value : text);
              const namespace = parsed.namespace ?? asString(getIn(state, 'existing.namespace'));
              return setIn(state, 'existing', {
                name: parsed.name,
                namespace,
                ...(option ? {} : { sectionName: getIn(state, 'existing.sectionName') }),
              });
            })
          }
        />
        <NamespaceInput path="existing.namespace" label="Gateway namespace" required />
        {listeners.length > 0 && (
          <SelectInput
            path="existing.sectionName"
            label="Listener"
            emptyLabel="All HTTP(S) listeners"
            options={listeners.map(listener => ({
              value: listener.name,
              description: describeListener(listener),
            }))}
          />
        )}
      </FieldGrid>
      {selected && (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="body2" color="text.secondary">
            Class {asString(asRecord(selected.spec).gatewayClassName)} ·{' '}
            {asArray<{ value?: string }>(asRecord(selected.status).addresses)
              .map(address => address?.value)
              .filter(Boolean)
              .join(', ') || 'no address yet'}
          </Typography>
          <HealthChip health={computeHealth(selected)} />
        </Stack>
      )}
    </Stack>
  );
}

function NewGatewayFields() {
  const { value, update } = useForm();
  const draft = asDraft(value);
  const data = useGatewayApiData();
  const classes = data.json('GatewayClass') || [];
  const classOptions: Option[] = classes.map(cls => {
    const controller = asString(asRecord(cls.spec).controllerName);
    return {
      value: cls.metadata?.name || '',
      description: controllerLabel(controller) || controller,
    };
  });

  return (
    <Stack spacing={2}>
      <FieldGrid>
        <TextInput path="create.name" label="Gateway name" required />
        <NamespaceInput path="create.namespace" label="Gateway namespace" required />
        <ComboInput
          path="create.gatewayClassName"
          label="Gateway class"
          required
          options={classOptions}
          help={
            data.list('GatewayClass') !== null && classes.length === 0
              ? 'No GatewayClass exists: install a Gateway API controller first'
              : undefined
          }
        />
      </FieldGrid>
      <FieldGrid>
        <SelectInput
          path="create.protocol"
          label="Protocol"
          required
          options={[
            { value: 'HTTP', description: 'Plain HTTP' },
            { value: 'HTTPS', description: 'TLS terminated at the Gateway' },
          ]}
          onSelect={(next, previous) =>
            update(state => {
              // Follow the default port unless the user chose a custom one.
              const port = getIn(state, 'create.port');
              const previousDefault = previous === 'HTTPS' ? 443 : 80;
              return port === undefined || port === previousDefault
                ? setIn(state, 'create.port', next === 'HTTPS' ? 443 : 80)
                : state;
            })
          }
        />
        <NumberInput path="create.port" label="Port" required min={1} max={65535} />
        <TextInput
          path="create.hostname"
          label="Listener hostname"
          mono
          placeholder="Any"
          help="Optional; wildcards allowed"
        />
      </FieldGrid>
      {draft.create.protocol === 'HTTPS' && (
        <FieldGrid>
          <SecretNameInput
            path="create.certificateName"
            namespace={draft.create.certificateNamespace || draft.create.namespace}
            label="TLS secret"
          />
          <NamespaceInput
            path="create.certificateNamespace"
            label="Secret namespace"
            placeholder={draft.create.namespace || 'Same as the Gateway'}
          />
        </FieldGrid>
      )}
    </Stack>
  );
}

function GatewayStep() {
  const { value, set } = useForm();
  const draft = asDraft(value);
  return (
    <FormSection title="Gateway" description="The Gateway through which the Service is exposed.">
      <RadioGroup
        aria-label="Gateway"
        value={draft.gatewayMode}
        onChange={event => set('gatewayMode', event.target.value)}
      >
        <FormControlLabel value="existing" control={<Radio />} label="Use an existing Gateway" />
        <FormControlLabel value="new" control={<Radio />} label="Create a new Gateway" />
      </RadioGroup>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {draft.gatewayMode === 'existing' ? <ExistingGatewayFields /> : <NewGatewayFields />}
      </Paper>
    </FormSection>
  );
}

function RouteStep() {
  return (
    <FormSection
      title="Route"
      description="How requests reach the Service: under which hostnames and which path."
    >
      <FieldGrid>
        <TextInput path="route.name" label="Route name" required />
        <NamespaceInput
          path="route.namespace"
          label="Route namespace"
          required
          help="Usually the namespace of the Service"
        />
      </FieldGrid>
      <StringListInput
        path="route.hostnames"
        label="Hostnames"
        placeholder="app.example.com"
        help="Optional. Press Enter after each hostname; leave empty to use the listener hostname."
      />
      <FieldGrid>
        <SelectInput
          path="route.pathType"
          label="Path match"
          required
          options={[
            { value: 'PathPrefix', description: 'The path starts with the value' },
            { value: 'Exact', description: 'The path equals the value' },
          ]}
        />
        <TextInput path="route.path" label="Path" required mono />
      </FieldGrid>
    </FormSection>
  );
}

function resourceLabel(resource: KubeJson): string {
  return `${resource.kind} ${
    resource.metadata?.namespace ? `${resource.metadata.namespace}/` : ''
  }${resource.metadata?.name}`;
}

function PlanSummary({ plan, urls }: { plan: ExposePlan; urls: string[] }) {
  return (
    <Stack spacing={2}>
      <SummaryList
        rows={[
          {
            label: 'Resources to create',
            value: (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {plan.resources.map(resource => (
                  <Chip
                    key={resourceLabel(resource)}
                    size="small"
                    label={resourceLabel(resource)}
                  />
                ))}
              </Stack>
            ),
          },
          {
            label: 'Reachable at',
            value: (
              <Stack>
                {urls.map(url => (
                  <Box key={url} component="code" sx={{ fontSize: '0.85rem' }}>
                    {url}
                  </Box>
                ))}
              </Stack>
            ),
          },
        ]}
      />
      {plan.notes.length > 0 && (
        <Alert severity="info">
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {plan.notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </Box>
        </Alert>
      )}
      {plan.warnings.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>The Service may stay unreachable</AlertTitle>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {plan.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </Box>
        </Alert>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// Review and apply
// ---------------------------------------------------------------------------------------------

type ItemState = 'pending' | 'running' | 'passed' | 'failed' | 'created';

interface ItemResult {
  state: ItemState;
  result?: WriteResult;
}

const STATE_ICONS: Record<ItemState, { icon: string; color: string; label: string }> = {
  pending: { icon: 'mdi:circle-outline', color: 'text.disabled', label: 'Waiting' },
  running: { icon: 'mdi:loading', color: 'text.secondary', label: 'Checking' },
  passed: { icon: 'mdi:check-circle-outline', color: 'success.main', label: 'Dry-run passed' },
  failed: { icon: 'mdi:alert-circle-outline', color: 'error.main', label: 'Failed' },
  created: { icon: 'mdi:check-circle', color: 'success.main', label: 'Created' },
};

function ReviewStage({
  plan,
  results,
  phase,
}: {
  plan: ExposePlan;
  results: ItemResult[];
  phase: 'dry-run' | 'apply';
}) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {phase === 'dry-run'
          ? 'Every resource is validated by the API server (dry-run) before anything is created.'
          : 'Creating the resources in order.'}
      </Typography>
      {plan.resources.map((resource, index) => {
        const item = results[index] || { state: 'pending' as ItemState };
        const visual = STATE_ICONS[item.state];
        return (
          <Paper key={resourceLabel(resource)} variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Box sx={{ color: visual.color, display: 'inline-flex' }}>
                {item.state === 'running' ? (
                  <CircularProgress size={18} />
                ) : (
                  <Icon icon={visual.icon} width={20} />
                )}
              </Box>
              <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                {resourceLabel(resource)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {visual.label}
              </Typography>
            </Stack>
            {item.result?.failure && (
              <Box sx={{ mb: 1 }}>
                <ApiFailureAlert
                  failure={item.result.failure}
                  title={
                    phase === 'dry-run' ? 'Server-side dry-run failed' : 'Could not be created'
                  }
                />
              </Box>
            )}
            <CodeBlock code={toYaml(resource)} maxHeight={220} />
          </Paper>
        );
      })}
      {plan.warnings.length > 0 && (
        <Alert severity="warning">
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {plan.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </Box>
        </Alert>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------------------------

function ExposeServiceContent({
  availability,
  draft,
  onChange,
  onClose,
}: {
  availability: Availability;
  draft: ExposeDraft;
  onChange: (next: ExposeDraft) => void;
  onClose: () => void;
}) {
  const data = useGatewayApiData();
  const history = useHistory();
  const { enqueueSnackbar } = useSnackbar();
  const [showAllErrors, setShowAllErrors] = React.useState(false);
  const [stage, setStage] = React.useState<'wizard' | 'review'>('wizard');
  const [results, setResults] = React.useState<ItemResult[]>([]);
  const [phase, setPhase] = React.useState<'dry-run' | 'apply'>('dry-run');
  const [busy, setBusy] = React.useState(false);

  const issues = React.useMemo(() => validateExposeDraft(draft), [draft]);
  const errors = issues.filter(issue => issue.severity === 'error');

  const existingGateway = (data.json('Gateway') || []).find(
    gateway =>
      gateway.metadata?.name === draft.existing.name &&
      gateway.metadata?.namespace === draft.existing.namespace
  );

  const plan = React.useMemo(
    () =>
      buildExposePlan(draft, {
        apiVersions: {
          gateway: apiVersionFor(availability, kindInfo('Gateway')),
          httpRoute: apiVersionFor(availability, kindInfo('HTTPRoute')),
          referenceGrant: apiVersionFor(availability, kindInfo('ReferenceGrant')),
        },
        existingGateway: draft.gatewayMode === 'existing' ? existingGateway : undefined,
        grants: data.grants,
        namespaceLabels: data.namespaceLabels,
        referenceGrantAvailable: !!availability.kinds.ReferenceGrant,
      }),
    [draft, availability, existingGateway, data.grants, data.namespaceLabels]
  );
  const urls = exposedUrls(draft, draft.gatewayMode === 'existing' ? existingGateway : undefined);

  const runDryRun = async () => {
    setPhase('dry-run');
    setBusy(true);
    const next: ItemResult[] = plan.resources.map(() => ({ state: 'pending' }));
    setResults(next);
    for (let index = 0; index < plan.resources.length; index++) {
      next[index] = { state: 'running' };
      setResults([...next]);
      const result = await writeResource(plan.resources[index], 'create', { dryRun: true });
      next[index] = { state: result.ok ? 'passed' : 'failed', result };
      setResults([...next]);
    }
    setBusy(false);
  };

  const startReview = () => {
    setShowAllErrors(true);
    if (errors.length > 0) return;
    setStage('review');
    runDryRun();
  };

  const apply = async () => {
    setPhase('apply');
    setBusy(true);
    const next: ItemResult[] = results.map(item =>
      item.state === 'created' ? item : { state: 'pending' as ItemState }
    );
    for (let index = 0; index < plan.resources.length; index++) {
      // Resources created by an earlier, partly failed attempt are not created again.
      if (next[index].state === 'created') continue;
      next[index] = { state: 'running' };
      setResults([...next]);
      const result = await writeResource(plan.resources[index], 'create');
      next[index] = { state: result.ok ? 'created' : 'failed', result };
      setResults([...next]);
      if (!result.ok) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    enqueueSnackbar(
      `Service "${draft.service.name}" exposed through ${plan.resources.length} resource(s)`,
      {
        variant: 'success',
      }
    );
    onClose();
    history.push(
      Router.createRouteURL(classOf('HTTPRoute').detailsRoute, {
        namespace: draft.route.namespace,
        name: draft.route.name,
      })
    );
  };

  const steps: WizardStep[] = [
    {
      id: 'service',
      label: 'Service',
      owns: path => path.startsWith('service'),
      content: <ServiceStep />,
    },
    {
      id: 'gateway',
      label: 'Gateway',
      owns: path => path.startsWith('existing') || path.startsWith('create'),
      content: <GatewayStep />,
    },
    {
      id: 'route',
      label: 'Route',
      owns: path => path.startsWith('route'),
      content: <RouteStep />,
    },
  ];

  const allPassed =
    results.length === plan.resources.length &&
    results.every(item => item.state === 'passed' || item.state === 'created');
  const anyCreated = results.some(item => item.state === 'created');

  return (
    <>
      <DialogContent sx={{ p: 3 }}>
        {stage === 'wizard' ? (
          <FormProvider
            value={draft as unknown as KubeJson}
            onChange={next => onChange(followService(draft, asDraft(next)))}
            issues={issues}
            showAllErrors={showAllErrors}
            mode="create"
            availability={availability}
          >
            <WizardShell
              steps={steps}
              summary={<PlanSummary plan={plan} urls={urls} />}
              onReview={startReview}
              onRevealErrors={() => setShowAllErrors(true)}
              reviewLabel="Review and create"
            />
          </FormProvider>
        ) : (
          <ReviewStage plan={plan} results={results} phase={phase} />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="secondary" disabled={busy}>
          {anyCreated ? 'Close' : 'Cancel'}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {stage === 'review' && (
          <>
            <Button onClick={() => setStage('wizard')} disabled={busy || anyCreated}>
              Back to editing
            </Button>
            {!allPassed && phase === 'dry-run' && (
              <Button onClick={runDryRun} disabled={busy} startIcon={<Icon icon="mdi:refresh" />}>
                Run the dry-run again
              </Button>
            )}
            <Button
              variant="contained"
              onClick={apply}
              disabled={busy || (phase === 'dry-run' && !allPassed)}
              startIcon={busy ? <CircularProgress size={16} /> : <Icon icon="mdi:check" />}
            >
              {anyCreated ? 'Retry remaining' : `Create ${plan.resources.length} resource(s)`}
            </Button>
          </>
        )}
      </DialogActions>
    </>
  );
}

export function ExposeServiceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const discovery = useDiscovery();
  const namespaces = useNamespaceFilter();
  const [draft, setDraft] = React.useState<ExposeDraft>(() => newExposeDraft(namespaces[0]));

  React.useEffect(() => {
    if (open) setDraft(newExposeDraft(namespaces[0]));
    // Only reset when the dialog opens, not when the namespace filter changes underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Expose a Service"
      withFullScreen
      fullWidth
      maxWidth="md"
      PaperProps={{ sx: { minHeight: '70vh' } }}
    >
      {discovery.status === 'ready' ? (
        <GatewayApiData
          availability={discovery.availability}
          kinds={['GatewayClass', 'Gateway', 'ReferenceGrant']}
          core={['Namespace']}
        >
          <ExposeServiceContent
            availability={discovery.availability}
            draft={draft}
            onChange={setDraft}
            onClose={onClose}
          />
        </GatewayApiData>
      ) : (
        <DialogContent>
          <Loader title="Discovering the Gateway API…" />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Button that opens the "Expose a Service" wizard. */
export function ExposeServiceButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Icon icon="mdi:earth-arrow-right" />}
        onClick={() => setOpen(true)}
      >
        Expose a Service
      </Button>
      {open && <ExposeServiceDialog open onClose={() => setOpen(false)} />}
    </>
  );
}
