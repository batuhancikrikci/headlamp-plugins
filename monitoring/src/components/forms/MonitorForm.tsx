import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useMemo } from 'react';
import { useText } from '../../common/i18n';
import { creationApiVersion, PodMonitor, ServiceMonitor } from '../../resources/crds';
import { MonitorEndpoint, MonitorNamespaceSelector } from '../../types';
import { isValidPromDuration } from '../../utils/duration';
import { ObjectRef, serviceMonitorMatchesService } from '../../utils/relations';
import { SelectorDisplay, TagList } from '../common/Selectors';
import {
  MatchPreview,
  MetadataSection,
  SecretKeyField,
  SelectionCheck,
  validateMetadata,
} from './common';
import { DurationField, FieldRow, FormSection, SelectorEditor, StringListField } from './fields';
import { FormIssue, issue, Obj, ResourceFormProps } from './ResourceEditorDialog';
import { FormTabs, SummaryList, Wizard } from './Wizard';

export type MonitorKind = 'ServiceMonitor' | 'PodMonitor';

export function newMonitor(kind: MonitorKind, namespace = ''): Obj {
  const cls = kind === 'ServiceMonitor' ? ServiceMonitor : PodMonitor;
  const endpointsKey = kind === 'ServiceMonitor' ? 'endpoints' : 'podMetricsEndpoints';
  return {
    apiVersion: creationApiVersion(cls),
    kind,
    metadata: { name: '', namespace },
    spec: {
      selector: { matchLabels: {} },
      [endpointsKey]: [{ port: '', path: '/metrics', interval: '30s' }],
    },
  };
}

const endpointsKeyOf = (kind: MonitorKind) =>
  kind === 'ServiceMonitor' ? 'endpoints' : 'podMetricsEndpoints';

export function validateMonitor(
  kind: MonitorKind,
  value: Obj,
  t: (s: string, o?: Obj) => string
): FormIssue[] {
  const errors = validateMetadata(value, t);
  const spec = value.spec || {};
  const endpoints: MonitorEndpoint[] = spec[endpointsKeyOf(kind)] || [];
  if (!spec.selector) {
    errors.push(
      issue('targets', t('A selector is required (use an empty selector to match everything).'))
    );
  }
  if (endpoints.length === 0) errors.push(issue('endpoints', t('Add at least one endpoint.')));
  endpoints.forEach((ep, i) => {
    if (!ep.port && ep.targetPort === undefined && ep.portNumber === undefined) {
      errors.push(issue('endpoints', t('Endpoint {{n}}: a port is required.', { n: i + 1 })));
    }
    if (ep.interval && !isValidPromDuration(ep.interval)) {
      errors.push(issue('endpoints', t('Endpoint {{n}}: invalid interval.', { n: i + 1 })));
    }
    if (ep.scrapeTimeout && !isValidPromDuration(ep.scrapeTimeout)) {
      errors.push(issue('endpoints', t('Endpoint {{n}}: invalid scrape timeout.', { n: i + 1 })));
    }
  });
  return errors;
}

interface PortOption {
  name: string;
  port: number;
  source: string;
}

/** Namespaces a monitor can see (undefined = all). */
function visibleNamespaces(value: Obj): string[] | undefined {
  const ns = value.metadata?.namespace;
  const nsSel: MonitorNamespaceSelector | undefined = value.spec?.namespaceSelector;
  if (nsSel?.any) return undefined;
  if (nsSel?.matchNames?.length) return nsSel.matchNames;
  return ns ? [ns] : [];
}

function useMatchedTargets(kind: MonitorKind, value: Obj, items: Obj[] | null, hasScope: boolean) {
  const ns = value.metadata?.namespace;
  return useMemo(() => {
    if (!hasScope) return { all: [] as Obj[], matched: [] as Obj[], ports: [] as PortOption[] };
    if (!items)
      return {
        all: null as null | Obj[],
        matched: null as null | Obj[],
        ports: [] as PortOption[],
      };
    const all = items;
    const monitor = { metadata: { namespace: ns }, spec: value.spec };
    const matched = all.filter(o => serviceMonitorMatchesService(monitor, o as ObjectRef));
    const ports: PortOption[] = [];
    for (const o of matched) {
      const list: Array<{ name?: string; port: number }> =
        kind === 'ServiceMonitor'
          ? (o.spec?.ports || []).map((p: Obj) => ({ name: p.name, port: p.port }))
          : (o.spec?.containers || []).flatMap((c: Obj) =>
              (c.ports || []).map((p: Obj) => ({ name: p.name, port: p.containerPort }))
            );
      for (const p of list) {
        if (p.name && !ports.some(x => x.name === p.name))
          ports.push({ name: p.name, port: p.port, source: o.metadata.name });
      }
    }
    return { all, matched, ports };
  }, [items, ns, value.spec, kind, hasScope]);
}

function EndpointEditor({
  kind,
  endpoint,
  onChange,
  onRemove,
  ports,
  namespace,
  index,
  showErrors,
}: {
  kind: MonitorKind;
  endpoint: MonitorEndpoint;
  onChange: (ep: MonitorEndpoint) => void;
  onRemove?: () => void;
  ports: PortOption[];
  namespace?: string;
  index: number;
  showErrors: boolean;
}) {
  const { t } = useText();
  const set = (patch: Partial<MonitorEndpoint>) => onChange({ ...endpoint, ...patch });
  const auth = endpoint.basicAuth ? 'basic' : endpoint.authorization ? 'bearer' : 'none';
  const portMissing =
    !endpoint.port && endpoint.targetPort === undefined && endpoint.portNumber === undefined;
  const unknownPort =
    !!endpoint.port && ports.length > 0 && !ports.some(p => p.name === endpoint.port);
  return (
    <FormSection
      title={t('Endpoint {{n}}', { n: index + 1 })}
      actions={
        onRemove && (
          <Tooltip title={t('Remove endpoint')}>
            <IconButton aria-label={t('Remove endpoint')} onClick={onRemove} size="small">
              <Icon icon="mdi:delete" />
            </IconButton>
          </Tooltip>
        )
      }
    >
      <FieldRow>
        <Autocomplete
          freeSolo
          options={ports.map(p => p.name)}
          getOptionLabel={o => o}
          renderOption={(props, option) => {
            const p = ports.find(x => x.name === option);
            return (
              <li {...props} key={option}>
                {option}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {p ? `${p.port} · ${p.source}` : ''}
                </Typography>
              </li>
            );
          }}
          value={endpoint.port || ''}
          onInputChange={(_, v) =>
            (v || undefined) !== endpoint.port && set({ port: v || undefined })
          }
          renderInput={params => (
            <TextField
              {...params}
              size="small"
              required
              label={kind === 'ServiceMonitor' ? t('Service port name') : t('Container port name')}
              error={showErrors && portMissing}
              helperText={
                unknownPort
                  ? t('No matched target exposes a port with this name')
                  : t('Named port of the matched targets')
              }
            />
          )}
        />
        <TextField
          size="small"
          label={t('Path')}
          value={endpoint.path || ''}
          placeholder="/metrics"
          onChange={e => set({ path: e.target.value || undefined })}
          helperText=" "
        />
        <TextField
          select
          size="small"
          label={t('Scheme')}
          value={endpoint.scheme || 'http'}
          onChange={e => set({ scheme: e.target.value === 'http' ? undefined : e.target.value })}
          helperText=" "
        >
          <MenuItem value="http">http</MenuItem>
          <MenuItem value="https">https</MenuItem>
        </TextField>
      </FieldRow>
      <FieldRow>
        <DurationField
          label={t('Scrape interval')}
          value={endpoint.interval}
          onChange={v => set({ interval: v })}
          helperText={t('Empty = Prometheus default')}
        />
        <DurationField
          label={t('Scrape timeout')}
          value={endpoint.scrapeTimeout}
          onChange={v => set({ scrapeTimeout: v })}
          helperText={t('Must not exceed the interval')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={!!endpoint.honorLabels}
              onChange={e => set({ honorLabels: e.target.checked || undefined })}
            />
          }
          label={t('Honor labels')}
        />
      </FieldRow>
      {endpoint.scheme === 'https' && (
        <FormControlLabel
          control={
            <Switch
              checked={!!endpoint.tlsConfig?.insecureSkipVerify}
              onChange={e =>
                set({
                  tlsConfig: e.target.checked
                    ? { ...endpoint.tlsConfig, insecureSkipVerify: true }
                    : { ...endpoint.tlsConfig, insecureSkipVerify: undefined },
                })
              }
            />
          }
          label={t('Skip TLS verification (insecure)')}
        />
      )}
      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('Authentication')}
        </Typography>
        <RadioGroup
          row
          value={auth}
          onChange={e => {
            const v = e.target.value;
            set({
              basicAuth: v === 'basic' ? { username: undefined, password: undefined } : undefined,
              authorization:
                v === 'bearer' ? { type: 'Bearer', credentials: undefined } : undefined,
            });
          }}
        >
          <FormControlLabel value="none" control={<Radio size="small" />} label={t('None')} />
          <FormControlLabel
            value="basic"
            control={<Radio size="small" />}
            label={t('Basic auth')}
          />
          <FormControlLabel
            value="bearer"
            control={<Radio size="small" />}
            label={t('Bearer token')}
          />
        </RadioGroup>
        {auth === 'basic' && (
          <>
            <SecretKeyField
              namespace={namespace}
              label={t('Username')}
              value={endpoint.basicAuth?.username}
              onChange={v => set({ basicAuth: { ...endpoint.basicAuth, username: v } })}
            />
            <SecretKeyField
              namespace={namespace}
              label={t('Password')}
              value={endpoint.basicAuth?.password}
              onChange={v => set({ basicAuth: { ...endpoint.basicAuth, password: v } })}
            />
          </>
        )}
        {auth === 'bearer' && (
          <SecretKeyField
            namespace={namespace}
            label={t('Token')}
            value={endpoint.authorization?.credentials}
            onChange={v => set({ authorization: { type: 'Bearer', credentials: v } })}
          />
        )}
      </Box>
      {endpoint.relabelings?.length || endpoint.metricRelabelings?.length ? (
        <Alert severity="info">
          {t(
            'This endpoint has {{r}} relabeling and {{m}} metric relabeling rules; edit them in the YAML tab.',
            {
              r: endpoint.relabelings?.length || 0,
              m: endpoint.metricRelabelings?.length || 0,
            }
          )}
        </Alert>
      ) : null}
    </FormSection>
  );
}

type Variant = { variant: 'form' | 'wizard' };

/** ServiceMonitor form/wizard: previews Services the selector matches. */
export function ServiceMonitorForm(props: ResourceFormProps & Variant) {
  const namespaces = visibleNamespaces(props.value);
  const hasScope = namespaces === undefined || namespaces.length > 0;
  const [services] = K8s.ResourceClasses.Service.useList(
    namespaces ? { namespace: namespaces } : {}
  );
  const items = useMemo(() => (services ? services.map(s => s.jsonData as Obj) : null), [services]);
  return <MonitorFormInner {...props} kind="ServiceMonitor" items={items} hasScope={hasScope} />;
}

/** PodMonitor form/wizard: previews Pods the selector matches. */
export function PodMonitorForm(props: ResourceFormProps & Variant) {
  const namespaces = visibleNamespaces(props.value);
  const hasScope = namespaces === undefined || namespaces.length > 0;
  const [pods] = K8s.ResourceClasses.Pod.useList(namespaces ? { namespace: namespaces } : {});
  const items = useMemo(() => (pods ? pods.map(p => p.jsonData as Obj) : null), [pods]);
  return <MonitorFormInner {...props} kind="PodMonitor" items={items} hasScope={hasScope} />;
}

function MonitorFormInner({
  kind,
  value,
  onChange,
  showErrors,
  editMode,
  items,
  hasScope,
  variant,
  errors,
  onSubmit,
  submitting,
  revealErrors,
}: ResourceFormProps & Variant & { kind: MonitorKind; items: Obj[] | null; hasScope: boolean }) {
  const { t } = useText();
  const spec = value.spec || {};
  const key = endpointsKeyOf(kind);
  const endpoints: MonitorEndpoint[] = spec[key] || [];
  const setSpec = (patch: Obj) => onChange({ ...value, spec: { ...spec, ...patch } });
  const { all, matched, ports } = useMatchedTargets(kind, value, items, hasScope);
  const ns = value.metadata?.namespace;
  const nsSel: MonitorNamespaceSelector = spec.namespaceSelector || {};
  const nsMode = nsSel.any ? 'any' : nsSel.matchNames?.length ? 'list' : 'own';

  const pickTarget = (name: string | null) => {
    const target = all?.find(o => o.metadata.name === name);
    if (!target) return;
    const labels = target.metadata.labels || {};
    // Prefer stable identity labels over everything the object carries.
    const preferred = [
      'app.kubernetes.io/name',
      'app.kubernetes.io/instance',
      'app',
      'k8s-app',
      'component',
    ];
    const chosen = Object.fromEntries(
      Object.entries(labels).filter(([k]) => preferred.includes(k))
    );
    const matchLabels = Object.keys(chosen).length ? chosen : labels;
    const firstPort =
      kind === 'ServiceMonitor'
        ? target.spec?.ports?.find((p: Obj) => p.name)?.name
        : target.spec?.containers?.flatMap((c: Obj) => c.ports || []).find((p: Obj) => p.name)
            ?.name;
    const nextEndpoints = endpoints.length
      ? [...endpoints]
      : [{ path: '/metrics', interval: '30s' }];
    if (!nextEndpoints[0].port && firstPort)
      nextEndpoints[0] = { ...nextEndpoints[0], port: firstPort };
    onChange({
      ...value,
      metadata: { ...value.metadata, name: value.metadata?.name || target.metadata.name },
      spec: { ...spec, selector: { matchLabels }, [key]: nextEndpoints },
    });
  };

  const targetStep = (
    <FormSection
      icon="mdi:target"
      title={kind === 'ServiceMonitor' ? t('Target services') : t('Target pods')}
      description={
        kind === 'ServiceMonitor'
          ? t('Prometheus scrapes the endpoints of every Service matched by the selector below.')
          : t('Prometheus scrapes every Pod matched by the selector below.')
      }
    >
      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('Namespaces to look in')}
        </Typography>
        <RadioGroup
          row
          value={nsMode}
          onChange={e => {
            const m = e.target.value;
            setSpec({
              namespaceSelector:
                m === 'any'
                  ? { any: true }
                  : m === 'list'
                  ? { matchNames: ns ? [ns] : [] }
                  : undefined,
            });
          }}
        >
          <FormControlLabel
            value="own"
            control={<Radio size="small" />}
            label={t('Same namespace')}
          />
          <FormControlLabel
            value="list"
            control={<Radio size="small" />}
            label={t('Selected namespaces')}
          />
          <FormControlLabel
            value="any"
            control={<Radio size="small" />}
            label={t('All namespaces')}
          />
        </RadioGroup>
        {nsMode === 'list' && (
          <StringListField
            label={t('Namespaces')}
            value={nsSel.matchNames}
            onChange={v => setSpec({ namespaceSelector: { matchNames: v || [] } })}
          />
        )}
      </Box>
      <Autocomplete
        options={(all || []).map(o => o.metadata.name as string)}
        onChange={(_, v) => pickTarget(v)}
        value={null}
        renderInput={params => (
          <TextField
            {...params}
            size="small"
            label={
              kind === 'ServiceMonitor'
                ? t('Start from an existing Service')
                : t('Start from an existing Pod')
            }
            helperText={t('Fills the selector and port from the chosen object')}
          />
        )}
      />
      <Divider />
      <SelectorEditor value={spec.selector} onChange={selector => setSpec({ selector })} />
      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('Matched now')}
        </Typography>
        <MatchPreview
          names={matched ? matched.map(o => `${o.metadata.namespace}/${o.metadata.name}`) : null}
          emptyText={t('The selector does not match anything yet.')}
        />
      </Box>
    </FormSection>
  );

  const endpointsStep = (
    <Box>
      {endpoints.map((ep, i) => (
        <EndpointEditor
          key={i}
          kind={kind}
          index={i}
          endpoint={ep}
          ports={ports}
          namespace={ns}
          showErrors={showErrors}
          onChange={next => setSpec({ [key]: endpoints.map((e, idx) => (idx === i ? next : e)) })}
          onRemove={
            endpoints.length > 1
              ? () => setSpec({ [key]: endpoints.filter((_, idx) => idx !== i) })
              : undefined
          }
        />
      ))}
      <Button
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => setSpec({ [key]: [...endpoints, { port: '', path: '/metrics' }] })}
        sx={{ mb: 2 }}
      >
        {t('Add endpoint')}
      </Button>
    </Box>
  );

  const advancedStep = (
    <FormSection title={t('Labels and limits')} icon="mdi:tag-multiple-outline">
      <FieldRow>
        <TextField
          size="small"
          label={t('Job label')}
          value={spec.jobLabel || ''}
          onChange={e => setSpec({ jobLabel: e.target.value || undefined })}
          helperText={t('Label of the target whose value becomes the job name')}
        />
        <TextField
          size="small"
          type="number"
          label={t('Sample limit')}
          value={spec.sampleLimit ?? ''}
          onChange={e =>
            setSpec({ sampleLimit: e.target.value ? Number(e.target.value) : undefined })
          }
          helperText={t('Scrape fails when exceeded (0 = no limit)')}
        />
      </FieldRow>
      {kind === 'ServiceMonitor' && (
        <StringListField
          label={t('Target labels (copied from the Service)')}
          value={spec.targetLabels}
          onChange={v => setSpec({ targetLabels: v })}
        />
      )}
      <StringListField
        label={t('Pod target labels (copied from the Pod)')}
        value={spec.podTargetLabels}
        onChange={v => setSpec({ podTargetLabels: v })}
      />
    </FormSection>
  );

  const selectionStep = (
    <FormSection
      icon="mdi:database"
      title={t('Prometheus selection')}
      description={t(
        'Prometheus only loads monitors matched by its selectors. kube-prometheus-stack usually requires a "release" label.'
      )}
    >
      <SelectionCheck kind={kind} value={value} onChange={onChange} />
    </FormSection>
  );

  const metadataStep = (
    <MetadataSection
      value={value}
      onChange={onChange}
      showErrors={showErrors}
      editMode={editMode}
    />
  );

  if (variant === 'form') {
    return (
      <FormTabs
        tabs={[
          { id: 'general', label: t('General'), content: metadataStep },
          { id: 'targets', label: t('Targets'), content: targetStep },
          { id: 'endpoints', label: t('Endpoints'), content: endpointsStep },
          { id: 'options', label: t('Options'), content: advancedStep },
          { id: 'prometheus', label: t('Prometheus'), content: selectionStep },
        ]}
      />
    );
  }

  const bySection = (section: string) => errors.filter(e => e.section === section);
  return (
    <Wizard
      submitLabel={t('Create')}
      onSubmit={onSubmit}
      submitting={submitting}
      allErrors={errors}
      onBlocked={revealErrors}
      steps={[
        {
          id: 'general',
          label: t('General'),
          description: t('Name the monitor and choose where it is created.'),
          content: metadataStep,
          errors: bySection('general'),
        },
        {
          id: 'targets',
          label: t('Targets'),
          description:
            kind === 'ServiceMonitor'
              ? t(
                  'Choose the Services to scrape. Start from an existing Service to fill the selector.'
                )
              : t('Choose the Pods to scrape. Start from an existing Pod to fill the selector.'),
          content: targetStep,
          errors: bySection('targets'),
        },
        {
          id: 'endpoints',
          label: t('Endpoints'),
          description: t('Which port and path expose the metrics, and how often to scrape them.'),
          content: endpointsStep,
          errors: bySection('endpoints'),
        },
        {
          id: 'options',
          label: t('Options'),
          description: t('Optional labels and limits.'),
          content: advancedStep,
          optional: true,
        },
        {
          id: 'review',
          label: t('Review'),
          description: t(
            'Check the summary and the Prometheus selection, or open the YAML tab to review the full manifest.'
          ),
          content: (
            <>
              <FormSection title={t('Summary')} icon="mdi:clipboard-check-outline">
                <SummaryList
                  rows={[
                    { id: 'name', label: t('Name'), value: value.metadata?.name || '-' },
                    { id: 'ns', label: t('Namespace'), value: ns || '-' },
                    {
                      id: 'selector',
                      label: t('Selector'),
                      value: <SelectorDisplay selector={spec.selector} nilMeaning="all" />,
                    },
                    {
                      id: 'matched',
                      label: t('Matched now'),
                      value: (
                        <MatchPreview
                          names={
                            matched
                              ? matched.map(o => `${o.metadata.namespace}/${o.metadata.name}`)
                              : null
                          }
                          emptyText={t('The selector does not match anything yet.')}
                        />
                      ),
                    },
                    {
                      id: 'endpoints',
                      label: t('Endpoints'),
                      value: (
                        <TagList
                          items={endpoints.map(
                            e =>
                              `${e.port || e.portNumber || e.targetPort || '?'}${
                                e.path || '/metrics'
                              } · ${e.interval || t('default')}`
                          )}
                        />
                      ),
                    },
                  ]}
                />
              </FormSection>
              {selectionStep}
            </>
          ),
        },
      ]}
    />
  );
}
