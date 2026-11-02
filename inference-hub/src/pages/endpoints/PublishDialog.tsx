import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React from 'react';
import { Discovery, isServed, locationsOf } from '../../api/discovery';
import { createObject, deleteObject, updateObject } from '../../api/mutations';
import { resolveTarget } from '../../api/openai';
import { CodeBlock } from '../../common/CodeBlock';
import { t } from '../../common/i18n';
import { toYaml } from '../../components/common/YamlEditorDialog';
import { useCurrentCluster } from '../../hooks/useCluster';
import { useResourceList } from '../../hooks/useLive';
import { endpointTarget } from '../../hooks/usePlaygroundTargets';
import {
  ApiVersions,
  endpointPool,
  PublishBackend,
  PublishForm,
  publishPlan,
  serviceAddress,
  validatePublish,
} from '../../resources/agentRouter';
import { ModelEndpoint } from '../../resources/endpoint';
import { KubeJson } from '../../resources/types';

const STEPS = ['Route', 'Model and backend', 'Review'];

type BackendState =
  | { status: 'resolving' }
  | { status: 'ready'; backend: PublishBackend }
  | { status: 'error'; message: string };

const key = (obj: KubeJson) => `${obj.metadata.namespace}/${obj.metadata.name}`;

/** How the route reaches the endpoint: its InferencePool, or its service (resolved like the Playground). */
function useBackend(endpoint: ModelEndpoint, open: boolean): BackendState {
  const cluster = useCurrentCluster();
  const pool = endpointPool(endpoint.raw);
  const [state, setState] = React.useState<BackendState>(
    pool ? { status: 'ready', backend: { type: 'pool', pool } } : { status: 'resolving' }
  );
  React.useEffect(() => {
    if (!open || pool) return;
    let cancelled = false;
    setState({ status: 'resolving' });
    resolveTarget(cluster, endpointTarget(endpoint))
      .then(resolved => {
        const address = serviceAddress(resolved.inClusterUrl, resolved.apiPrefix);
        if (cancelled) return;
        setState(
          address
            ? { status: 'ready', backend: { type: 'service', address } }
            : { status: 'error', message: t('The address of the model server is not known.') }
        );
      })
      .catch((err: Error) => !cancelled && setState({ status: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cluster, endpoint.namespace, endpoint.name, !!pool]);
  return state;
}

/**
 * Publishes an endpoint through Agent Router: adds a model rule to an existing AIGatewayRoute or
 * creates a new one. Objects are created, never overwritten; the route is updated with its
 * resourceVersion; created objects are removed again when the route cannot be written.
 */
export function PublishDialog({
  open,
  onClose,
  endpoint,
  discovery,
}: {
  open: boolean;
  onClose: () => void;
  endpoint: ModelEndpoint;
  discovery: Discovery;
}) {
  const cluster = useCurrentCluster();
  const { enqueueSnackbar } = useSnackbar();
  const routes = useResourceList<KubeJson>('aigatewayroutes', open ? {} : null);
  const gateways = useResourceList<KubeJson>('gateways', open ? {} : null);
  const serviceBackends = useResourceList<KubeJson>(
    'aiservicebackends',
    open ? { namespace: endpoint.namespace } : null
  );
  const envoyBackends = useResourceList<KubeJson>(
    'envoybackends',
    open ? { namespace: endpoint.namespace } : null
  );
  const backend = useBackend(endpoint, open);
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState<PublishForm>(() => ({
    mode: 'new',
    routeName: endpoint.name,
    routeNamespace: endpoint.namespace,
    gatewayName: '',
    gatewayNamespace: '',
    models: [endpoint.servedModelName].filter(Boolean),
    createGrant: true,
  }));
  const [modelsText, setModelsText] = React.useState(form.models.join(', '));
  const [busy, setBusy] = React.useState<'validate' | 'publish' | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const update = (patch: Partial<PublishForm>) => {
    setForm(f => ({ ...f, ...patch }));
    setResult(null);
  };

  const versions: ApiVersions = {
    route: locationsOf(discovery, 'aigatewayroutes')[0]?.apiVersion || '',
    serviceBackend: locationsOf(discovery, 'aiservicebackends')[0]?.apiVersion || '',
    envoyBackend: locationsOf(discovery, 'envoybackends')[0]?.apiVersion || '',
    referenceGrant: locationsOf(discovery, 'referencegrants')[0]?.apiVersion,
  };
  const existingRoute = routes.items.find(
    r => r.metadata.name === form.routeName && r.metadata.namespace === form.routeNamespace
  );
  const errors = [
    ...validatePublish(form, existingRoute),
    ...(backend.status === 'error' ? [backend.message] : []),
    ...(backend.status === 'ready' &&
    backend.backend.type === 'service' &&
    !isServed(discovery, 'envoybackends')
      ? [t('Envoy Gateway Backends are not served: enable the Backend API of Envoy Gateway.')]
      : []),
  ];
  const plan =
    backend.status === 'ready' && errors.length === 0
      ? publishPlan(endpoint.raw, backend.backend, form, versions, existingRoute, [
          ...serviceBackends.items,
          ...envoyBackends.items,
        ])
      : null;
  const crossNamespace = form.routeNamespace !== endpoint.namespace;

  const run = async (dryRun: boolean) => {
    if (!plan) return;
    setBusy(dryRun ? 'validate' : 'publish');
    setResult(null);
    const created: KubeJson[] = [];
    const notes: string[] = [];
    let writingRoute = false;
    try {
      for (const obj of plan.create) {
        try {
          await createObject(obj, { cluster, dryRun });
          if (!dryRun) created.push(obj);
        } catch (err) {
          // A grant from an earlier publish for the same namespace is reused, not replaced.
          if (obj.kind === 'ReferenceGrant' && (err as { status?: number }).status === 409) {
            notes.push(t('The existing ReferenceGrant {{name}} is kept.', { name: key(obj) }));
            continue;
          }
          throw err;
        }
      }
      writingRoute = true;
      if (plan.routeIsNew) await createObject(plan.route, { cluster, dryRun });
      else await updateObject(plan.route, { cluster, dryRun });
      if (dryRun) {
        setResult({
          ok: true,
          message: [t('The API server accepted every object (dry run).'), ...notes].join(' '),
        });
      } else {
        enqueueSnackbar(
          t('{{models}} published on AIGatewayRoute {{route}}', {
            models: form.models.join(', '),
            route: key(plan.route),
          }),
          { variant: 'success' }
        );
        onClose();
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      // Do not leave half a publication behind.
      for (const obj of created.reverse()) {
        await deleteObject(obj, { cluster }).catch(() => undefined);
      }
      const conflict = (err as { status?: number }).status === 409;
      setResult({
        ok: false,
        message: !conflict
          ? message
          : writingRoute && !plan.routeIsNew
          ? `${message} ${t(
              'The route changed in the meantime; close the dialog and publish again.'
            )}`
          : `${message} ${t('An object with this name already exists; nothing was overwritten.')}`,
      });
    } finally {
      setBusy(null);
    }
  };

  const gatewayOptions = gateways.items.map(key);
  const routeOptions = routes.items.map(key);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('Publish {{name}} to Agent Router', { name: endpoint.name })}</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map(s => (
            <Step key={s}>
              <StepLabel>{t(s)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <RadioGroup
              row
              value={form.mode}
              onChange={e =>
                update(
                  e.target.value === 'new'
                    ? {
                        mode: 'new',
                        routeName: endpoint.name,
                        routeNamespace: endpoint.namespace,
                      }
                    : { mode: 'existing', routeName: '', routeNamespace: '' }
                )
              }
            >
              <FormControlLabel value="new" control={<Radio />} label={t('New route')} />
              <FormControlLabel
                value="existing"
                control={<Radio />}
                label={t('Add to an existing route')}
                disabled={routes.items.length === 0}
              />
            </RadioGroup>
            {form.mode === 'existing' ? (
              <Autocomplete
                options={routeOptions}
                value={form.routeName ? `${form.routeNamespace}/${form.routeName}` : null}
                onChange={(_, v) => {
                  const [ns, name] = (v || '/').split('/');
                  update({ routeNamespace: ns, routeName: name });
                }}
                renderInput={p => (
                  <TextField
                    {...p}
                    label={t('AIGatewayRoute')}
                    helperText={t(
                      'A rule for the model is added; the other rules stay as they are.'
                    )}
                  />
                )}
              />
            ) : (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label={t('Route name')}
                    value={form.routeName}
                    onChange={e => update({ routeName: e.target.value.trim() })}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label={t('Namespace')}
                    value={form.routeNamespace}
                    onChange={e => update({ routeNamespace: e.target.value.trim() })}
                    helperText={t('Defaults to the namespace of the endpoint.')}
                  />
                </Grid>
                <Grid item xs={12}>
                  <Autocomplete
                    options={gatewayOptions}
                    value={form.gatewayName ? `${form.gatewayNamespace}/${form.gatewayName}` : null}
                    onChange={(_, v) => {
                      const [ns, name] = (v || '/').split('/');
                      update({ gatewayNamespace: ns, gatewayName: name });
                    }}
                    renderInput={p => (
                      <TextField
                        {...p}
                        label={t('Gateway')}
                        helperText={t(
                          'The Gateway that Agent Router serves (its GatewayConfig / Envoy Gateway class).'
                        )}
                      />
                    )}
                  />
                </Grid>
              </Grid>
            )}
          </Box>
        )}

        {step === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              label={t('Model names')}
              value={modelsText}
              onChange={e => {
                setModelsText(e.target.value);
                update({
                  models: e.target.value
                    .split(',')
                    .map(m => m.trim())
                    .filter(Boolean),
                });
              }}
              helperText={t(
                'Comma separated. Clients select the model with these names (the model field of OpenAI requests); the endpoint serves {{served}}.',
                { served: endpoint.servedModelName }
              )}
            />
            {backend.status === 'resolving' && (
              <Alert severity="info" icon={<CircularProgress size={18} />}>
                {t('Finding the service of the model server…')}
              </Alert>
            )}
            {backend.status === 'error' && <Alert severity="error">{backend.message}</Alert>}
            {backend.status === 'ready' && backend.backend.type === 'pool' && (
              <Alert severity="success" icon={<Icon icon="mdi:routes" />}>
                {t(
                  'Requests go to InferencePool {{pool}}, so the llm-d endpoint picker keeps balancing the load (prefix cache and KV cache aware).',
                  { pool: `${backend.backend.pool.namespace}/${backend.backend.pool.name}` }
                )}
              </Alert>
            )}
            {backend.status === 'ready' && backend.backend.type === 'service' && (
              <Alert severity="info" icon={<Icon icon="mdi:server-network" />}>
                {t(
                  'Requests go to {{url}} through an Envoy Gateway Backend and an AIServiceBackend (OpenAI schema). Both are owned by the endpoint and are deleted with it.',
                  {
                    url: `${backend.backend.address.scheme}://${backend.backend.address.host}:${backend.backend.address.port}${backend.backend.address.apiPrefix}`,
                  }
                )}
                {backend.backend.address.scheme === 'https' &&
                  ` ${t('The self-signed certificate of the model server is not verified.')}`}
              </Alert>
            )}
            {crossNamespace && (
              <Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.createGrant}
                      disabled={!versions.referenceGrant}
                      onChange={e => update({ createGrant: e.target.checked })}
                    />
                  }
                  label={t('Create a ReferenceGrant in {{ns}}', { ns: endpoint.namespace })}
                />
                <Typography variant="body2" color="text.secondary">
                  {t(
                    'The route is in {{route}} and the backend in {{ns}}: a ReferenceGrant in {{ns}} must allow AIGatewayRoutes of {{route}} to reference it.',
                    { route: form.routeNamespace, ns: endpoint.namespace }
                  )}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {step === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {errors.length > 0 && (
              <Alert severity="error">
                {errors.map(e => (
                  <div key={e}>{t(e)}</div>
                ))}
              </Alert>
            )}
            {plan &&
              backend.status === 'ready' &&
              backend.backend.type === 'service' &&
              !plan.create.some(o => o.kind === 'AIServiceBackend') && (
                <Alert severity="info">
                  {t(
                    'The endpoint already has its Backend and AIServiceBackend (from an earlier publication); the new rule uses them.'
                  )}
                </Alert>
              )}
            {plan &&
              [
                ...plan.create.map(obj => ({ obj, action: t('Create') })),
                { obj: plan.route, action: plan.routeIsNew ? t('Create') : t('Update') },
              ].map(({ obj, action }) => (
                <Box key={`${obj.kind}/${key(obj)}`}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {action} {obj.kind} {key(obj)}
                  </Typography>
                  <CodeBlock value={toYaml(obj)} maxHeight={240} />
                </Box>
              ))}
            {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.message}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={!!busy}>
          {t('Cancel')}
        </Button>
        <Box sx={{ flexGrow: 1 }} />
        {step > 0 && (
          <Button onClick={() => setStep(s => s - 1)} disabled={!!busy}>
            {t('Back')}
          </Button>
        )}
        {step < 2 ? (
          <Button variant="contained" onClick={() => setStep(s => s + 1)}>
            {t('Next')}
          </Button>
        ) : (
          <>
            <Button onClick={() => run(true)} disabled={!plan || !!busy}>
              {busy === 'validate' ? <CircularProgress size={16} /> : t('Validate (dry run)')}
            </Button>
            <Button variant="contained" onClick={() => run(false)} disabled={!plan || !!busy}>
              {busy === 'publish' ? <CircularProgress size={16} /> : t('Publish')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
