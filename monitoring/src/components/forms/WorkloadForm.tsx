import {
  Box,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import {
  Alertmanager,
  creationApiVersion,
  Probe,
  Prometheus,
  PrometheusAgent,
  ScrapeConfig,
  ThanosRuler,
} from '../../resources/crds';
import { LabelSelector } from '../../types';
import { isValidPromDuration } from '../../utils/duration';
import { MetadataSection, SelectionCheck, validateMetadata } from './common';
import {
  DurationField,
  FieldRow,
  FormSection,
  KeyValueEditor,
  PROM_LABEL_RE,
  SelectorEditor,
  StringListField,
} from './fields';
import { FormIssue, issue, Obj, ResourceFormProps } from './ResourceEditorDialog';
import { FormTabs } from './Wizard';

export type WorkloadKind = 'Prometheus' | 'PrometheusAgent' | 'Alertmanager' | 'ThanosRuler';

const CLASSES = { Prometheus, PrometheusAgent, Alertmanager, ThanosRuler };

export function newWorkload(kind: WorkloadKind, namespace = ''): Obj {
  const base: Obj = {
    apiVersion: creationApiVersion(CLASSES[kind]),
    kind,
    metadata: { name: '', namespace },
    spec: { replicas: 1 },
  };
  switch (kind) {
    case 'Prometheus':
      base.spec = {
        ...base.spec,
        retention: '10d',
        scrapeInterval: '30s',
        evaluationInterval: '30s',
        serviceMonitorSelector: {},
        podMonitorSelector: {},
        ruleSelector: {},
      };
      break;
    case 'PrometheusAgent':
      base.spec = {
        ...base.spec,
        scrapeInterval: '30s',
        serviceMonitorSelector: {},
        podMonitorSelector: {},
      };
      break;
    case 'Alertmanager':
      base.spec = { ...base.spec, retention: '120h', alertmanagerConfigSelector: {} };
      break;
    case 'ThanosRuler':
      base.spec = { ...base.spec, queryEndpoints: [], ruleSelector: {}, evaluationInterval: '30s' };
      break;
  }
  return base;
}

export function validateWorkload(
  kind: WorkloadKind,
  value: Obj,
  t: (s: string, o?: Obj) => string
): FormIssue[] {
  const errors = validateMetadata(value, t);
  const spec = value.spec || {};
  if (spec.replicas !== undefined && (!Number.isInteger(spec.replicas) || spec.replicas < 0)) {
    errors.push(issue('general', t('Replicas must be a non-negative integer.')));
  }
  for (const f of ['retention', 'scrapeInterval', 'evaluationInterval']) {
    if (spec[f] && !isValidPromDuration(spec[f]))
      errors.push(issue('general', t('Invalid duration for {{field}}.', { field: f })));
  }
  if (spec.retentionSize && !/^\d+(B|KB|MB|GB|TB|PB|EB)$/.test(spec.retentionSize)) {
    errors.push(issue('general', t('retentionSize must look like 50GB.')));
  }
  for (const k of Object.keys(spec.externalLabels || {})) {
    if (!PROM_LABEL_RE.test(k))
      errors.push(issue('general', t('Invalid external label name {{k}}.', { k })));
  }
  if (kind === 'ThanosRuler' && !(spec.queryEndpoints || []).length && !spec.queryConfig) {
    errors.push(issue('general', t('ThanosRuler needs at least one query endpoint.')));
  }
  return errors;
}

/**
 * Edits a workload selector pair with explicit semantics: "none" (nil), "all"
 * ({}), or a custom label selector.
 */
function SelectorPairEditor({
  title,
  selector,
  nsSelector,
  onChange,
}: {
  title: string;
  selector?: LabelSelector | null;
  nsSelector?: LabelSelector | null;
  onChange: (selector: LabelSelector | undefined, nsSelector: LabelSelector | undefined) => void;
}) {
  const { t } = useText();
  const mode =
    selector === undefined || selector === null
      ? 'none'
      : Object.keys(selector).length === 0
      ? 'all'
      : 'custom';
  const nsMode =
    nsSelector === undefined || nsSelector === null
      ? 'own'
      : Object.keys(nsSelector).length === 0
      ? 'all'
      : 'custom';
  return (
    <Box sx={{ borderLeft: 3, borderColor: 'divider', pl: 2 }}>
      <Typography variant="subtitle2">{title}</Typography>
      <RadioGroup
        row
        value={mode}
        onChange={e => {
          const m = e.target.value;
          onChange(
            m === 'none' ? undefined : m === 'all' ? {} : { matchLabels: { release: '' } },
            nsSelector ?? undefined
          );
        }}
      >
        <FormControlLabel value="none" control={<Radio size="small" />} label={t('None')} />
        <FormControlLabel value="all" control={<Radio size="small" />} label={t('All')} />
        <FormControlLabel
          value="custom"
          control={<Radio size="small" />}
          label={t('Matching labels')}
        />
      </RadioGroup>
      {mode === 'custom' && (
        <SelectorEditor
          value={selector || {}}
          onChange={s => onChange(s, nsSelector ?? undefined)}
        />
      )}
      {mode !== 'none' && (
        <>
          <Typography variant="caption" color="text.secondary">
            {t('From namespaces')}
          </Typography>
          <RadioGroup
            row
            value={nsMode}
            onChange={e => {
              const m = e.target.value;
              onChange(
                selector ?? undefined,
                m === 'own' ? undefined : m === 'all' ? {} : { matchLabels: {} }
              );
            }}
          >
            <FormControlLabel
              value="own"
              control={<Radio size="small" />}
              label={t('Own namespace')}
            />
            <FormControlLabel
              value="all"
              control={<Radio size="small" />}
              label={t('All namespaces')}
            />
            <FormControlLabel
              value="custom"
              control={<Radio size="small" />}
              label={t('Labelled namespaces')}
            />
          </RadioGroup>
          {nsMode === 'custom' && (
            <SelectorEditor
              value={nsSelector || {}}
              onChange={s => onChange(selector ?? undefined, s)}
            />
          )}
        </>
      )}
    </Box>
  );
}

function ResourcesSection({ spec, setSpec }: { spec: Obj; setSpec: (p: Obj) => void }) {
  const { t } = useText();
  const res = spec.resources || {};
  const set = (bucket: 'requests' | 'limits', key: 'cpu' | 'memory', v: string) => {
    const next = { ...res, [bucket]: { ...(res[bucket] || {}), [key]: v || undefined } };
    if (!v) delete next[bucket][key];
    setSpec({ resources: next });
  };
  return (
    <FormSection
      icon="mdi:server-network"
      title={t('Resources')}
      description={t('Kubernetes quantities, e.g. 500m / 2Gi.')}
    >
      <FieldRow>
        <TextField
          size="small"
          label={t('CPU request')}
          value={res.requests?.cpu || ''}
          onChange={e => set('requests', 'cpu', e.target.value)}
        />
        <TextField
          size="small"
          label={t('Memory request')}
          value={res.requests?.memory || ''}
          onChange={e => set('requests', 'memory', e.target.value)}
        />
        <TextField
          size="small"
          label={t('CPU limit')}
          value={res.limits?.cpu || ''}
          onChange={e => set('limits', 'cpu', e.target.value)}
        />
        <TextField
          size="small"
          label={t('Memory limit')}
          value={res.limits?.memory || ''}
          onChange={e => set('limits', 'memory', e.target.value)}
        />
      </FieldRow>
    </FormSection>
  );
}

function StorageSection({ spec, setSpec }: { spec: Obj; setSpec: (p: Obj) => void }) {
  const { t } = useText();
  const pvc = spec.storage?.volumeClaimTemplate?.spec;
  const enabled = !!pvc;
  const setPvc = (patch: Obj) =>
    setSpec({
      storage: {
        ...spec.storage,
        volumeClaimTemplate: {
          ...spec.storage?.volumeClaimTemplate,
          spec: { accessModes: ['ReadWriteOnce'], ...pvc, ...patch },
        },
      },
    });
  return (
    <FormSection title={t('Storage')} icon="mdi:database">
      <FormControlLabel
        control={
          <Switch
            checked={enabled}
            onChange={e =>
              e.target.checked
                ? setPvc({ resources: { requests: { storage: '10Gi' } } })
                : setSpec({ storage: undefined })
            }
          />
        }
        label={t('Persistent volume (otherwise data is lost when pods restart)')}
      />
      {enabled && (
        <FieldRow>
          <TextField
            size="small"
            label={t('Storage class')}
            value={pvc?.storageClassName || ''}
            onChange={e => setPvc({ storageClassName: e.target.value || undefined })}
            helperText={t('Empty = cluster default')}
          />
          <TextField
            size="small"
            label={t('Size')}
            value={pvc?.resources?.requests?.storage || ''}
            onChange={e => setPvc({ resources: { requests: { storage: e.target.value } } })}
            helperText=" "
          />
        </FieldRow>
      )}
    </FormSection>
  );
}

export function WorkloadForm({
  kind,
  value,
  onChange,
  showErrors,
  editMode,
}: ResourceFormProps & { kind: WorkloadKind }) {
  const { t } = useText();
  const spec = value.spec || {};
  const setSpec = (patch: Obj) => {
    const next = { ...spec, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    onChange({ ...value, spec: next });
  };
  const isProm = kind === 'Prometheus' || kind === 'PrometheusAgent';
  const pair = (selKey: string, nsKey: string, title: string) => (
    <SelectorPairEditor
      key={selKey}
      title={title}
      selector={spec[selKey]}
      nsSelector={spec[nsKey]}
      onChange={(s, ns) => setSpec({ [selKey]: s, [nsKey]: ns })}
    />
  );

  const general = (
    <>
      <MetadataSection
        value={value}
        onChange={onChange}
        showErrors={showErrors}
        editMode={editMode}
      />
      <FormSection title={t('Settings')} icon="mdi:cog">
        <FieldRow>
          <TextField
            size="small"
            type="number"
            label={t('Replicas')}
            value={spec.replicas ?? ''}
            onChange={e =>
              setSpec({ replicas: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            inputProps={{ min: 0 }}
          />
          <TextField
            size="small"
            label={t('Version')}
            value={spec.version || ''}
            onChange={e => setSpec({ version: e.target.value || undefined })}
            helperText={t('Empty = operator default')}
          />
          <TextField
            select
            size="small"
            label={t('Log level')}
            value={spec.logLevel || 'info'}
            onChange={e =>
              setSpec({ logLevel: e.target.value === 'info' ? undefined : e.target.value })
            }
          >
            {['debug', 'info', 'warn', 'error'].map(l => (
              <MenuItem key={l} value={l}>
                {l}
              </MenuItem>
            ))}
          </TextField>
        </FieldRow>
        <FieldRow>
          {(kind === 'Prometheus' || kind === 'Alertmanager' || kind === 'ThanosRuler') && (
            <DurationField
              label={t('Retention')}
              value={spec.retention}
              onChange={v => setSpec({ retention: v })}
            />
          )}
          {kind === 'Prometheus' && (
            <TextField
              size="small"
              label={t('Retention size')}
              placeholder="50GB"
              value={spec.retentionSize || ''}
              onChange={e => setSpec({ retentionSize: e.target.value || undefined })}
            />
          )}
          {isProm && (
            <DurationField
              label={t('Scrape interval')}
              value={spec.scrapeInterval}
              onChange={v => setSpec({ scrapeInterval: v })}
            />
          )}
          {(kind === 'Prometheus' || kind === 'ThanosRuler') && (
            <DurationField
              label={t('Evaluation interval')}
              value={spec.evaluationInterval}
              onChange={v => setSpec({ evaluationInterval: v })}
            />
          )}
        </FieldRow>
        <FormControlLabel
          control={
            <Switch
              checked={!!spec.paused}
              onChange={e => setSpec({ paused: e.target.checked || undefined })}
            />
          }
          label={t('Paused (the operator stops reconciling)')}
        />
      </FormSection>
    </>
  );

  const selectors = (
    <FormSection
      icon="mdi:filter-variant"
      title={t('Selectors')}
      description={t(
        '"None" selects nothing, "All" selects every object. kube-prometheus-stack uses a release label by default.'
      )}
    >
      {isProm &&
        pair('serviceMonitorSelector', 'serviceMonitorNamespaceSelector', t('ServiceMonitors'))}
      {isProm && pair('podMonitorSelector', 'podMonitorNamespaceSelector', t('PodMonitors'))}
      {isProm && pair('probeSelector', 'probeNamespaceSelector', t('Probes'))}
      {isProm && pair('scrapeConfigSelector', 'scrapeConfigNamespaceSelector', t('ScrapeConfigs'))}
      {(kind === 'Prometheus' || kind === 'ThanosRuler') &&
        pair('ruleSelector', 'ruleNamespaceSelector', t('PrometheusRules'))}
      {kind === 'Alertmanager' &&
        pair(
          'alertmanagerConfigSelector',
          'alertmanagerConfigNamespaceSelector',
          t('AlertmanagerConfigs')
        )}
      {kind === 'Alertmanager' && (
        <TextField
          select
          size="small"
          label={t('AlertmanagerConfig matcher strategy')}
          value={spec.alertmanagerConfigMatcherStrategy?.type || 'OnNamespace'}
          onChange={e =>
            setSpec({
              alertmanagerConfigMatcherStrategy:
                e.target.value === 'OnNamespace' ? undefined : { type: e.target.value },
            })
          }
          helperText={t('OnNamespace adds a namespace matcher to every AlertmanagerConfig route')}
        >
          <MenuItem value="OnNamespace">OnNamespace</MenuItem>
          <MenuItem value="None">None</MenuItem>
        </TextField>
      )}
    </FormSection>
  );

  const integrations = (
    <>
      {kind === 'Prometheus' && (
        <FormSection
          icon="mdi:bell-ring"
          title={t('Alerting')}
          description={t('Alertmanager services this Prometheus sends alerts to.')}
        >
          {(spec.alerting?.alertmanagers || []).map((am: Obj, i: number) => (
            <FieldRow key={i}>
              <TextField
                size="small"
                label={t('Namespace')}
                value={am.namespace || ''}
                onChange={e => {
                  const list = [...spec.alerting.alertmanagers];
                  list[i] = { ...am, namespace: e.target.value || undefined };
                  setSpec({ alerting: { alertmanagers: list } });
                }}
              />
              <TextField
                size="small"
                label={t('Service name')}
                value={am.name || ''}
                onChange={e => {
                  const list = [...spec.alerting.alertmanagers];
                  list[i] = { ...am, name: e.target.value };
                  setSpec({ alerting: { alertmanagers: list } });
                }}
              />
              <TextField
                size="small"
                label={t('Port')}
                value={am.port ?? ''}
                onChange={e => {
                  const list = [...spec.alerting.alertmanagers];
                  list[i] = {
                    ...am,
                    port: /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value,
                  };
                  setSpec({ alerting: { alertmanagers: list } });
                }}
              />
            </FieldRow>
          ))}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={!!spec.alerting?.alertmanagers?.length}
                  onChange={e =>
                    setSpec({
                      alerting: e.target.checked
                        ? {
                            alertmanagers: [
                              {
                                namespace: value.metadata?.namespace,
                                name: 'alertmanager-operated',
                                port: 'web',
                              },
                            ],
                          }
                        : undefined,
                    })
                  }
                />
              }
              label={t('Send alerts to Alertmanager')}
            />
          </Box>
        </FormSection>
      )}

      {kind === 'ThanosRuler' && (
        <FormSection title={t('Query endpoints')} icon="mdi:lan-connect">
          <StringListField
            label={t('Thanos Query endpoints')}
            value={spec.queryEndpoints}
            onChange={v => setSpec({ queryEndpoints: v || [] })}
            helperText={t('e.g. dnssrv+_http._tcp.thanos-query.monitoring.svc.cluster.local')}
          />
        </FormSection>
      )}

      {isProm && (
        <FormSection
          icon="mdi:tag-multiple-outline"
          title={t('External labels')}
          description={t('Added to every series and alert leaving this Prometheus.')}
        >
          <KeyValueEditor
            value={spec.externalLabels}
            onChange={externalLabels => setSpec({ externalLabels })}
            keyPattern={PROM_LABEL_RE}
            addLabel={t('Add label')}
          />
        </FormSection>
      )}
    </>
  );

  const resources = (
    <>
      <ResourcesSection spec={spec} setSpec={setSpec} />
      <StorageSection spec={spec} setSpec={setSpec} />
    </>
  );

  const integrationLabel =
    kind === 'Prometheus'
      ? t('Alerting')
      : kind === 'ThanosRuler'
      ? t('Query endpoints')
      : t('External labels');
  return (
    <FormTabs
      tabs={[
        { id: 'general', label: t('General'), content: general },
        { id: 'selectors', label: t('Selectors'), content: selectors },
        ...(kind === 'Alertmanager'
          ? []
          : [{ id: 'integrations', label: integrationLabel, content: integrations }]),
        { id: 'resources', label: t('Resources'), content: resources },
      ]}
    />
  );
}

// ---------------------------------------------------------------------------
// Probe / ScrapeConfig (compact forms; advanced fields via YAML)
// ---------------------------------------------------------------------------

export function newProbe(namespace = ''): Obj {
  return {
    apiVersion: creationApiVersion(Probe),
    kind: 'Probe',
    metadata: { name: '', namespace },
    spec: {
      jobName: '',
      prober: { url: 'blackbox-exporter.monitoring.svc:9115' },
      module: 'http_2xx',
      interval: '60s',
      targets: { staticConfig: { static: [] } },
    },
  };
}

export function validateProbe(value: Obj, t: (s: string, o?: Obj) => string): FormIssue[] {
  const errors = validateMetadata(value, t);
  if (!value.spec?.prober?.url) errors.push(issue('general', t('Prober URL is required.')));
  if (value.spec?.interval && !isValidPromDuration(value.spec.interval))
    errors.push(issue('general', t('Invalid interval.')));
  const statics = value.spec?.targets?.staticConfig?.static || [];
  if (!statics.length && !value.spec?.targets?.ingress)
    errors.push(issue('general', t('Add at least one target.')));
  return errors;
}

export function ProbeForm({ value, onChange, showErrors, editMode }: ResourceFormProps) {
  const { t } = useText();
  const spec = value.spec || {};
  const setSpec = (patch: Obj) => onChange({ ...value, spec: { ...spec, ...patch } });
  return (
    <Box>
      <MetadataSection
        value={value}
        onChange={onChange}
        showErrors={showErrors}
        editMode={editMode}
      />
      <FormSection
        title={t('Prober')}
        icon="mdi:radar"
        description={t('Usually a blackbox-exporter service.')}
      >
        <FieldRow>
          <TextField
            size="small"
            required
            label={t('Prober URL (host:port)')}
            value={spec.prober?.url || ''}
            onChange={e => setSpec({ prober: { ...spec.prober, url: e.target.value } })}
            error={showErrors && !spec.prober?.url}
          />
          <TextField
            size="small"
            label={t('Module')}
            value={spec.module || ''}
            onChange={e => setSpec({ module: e.target.value || undefined })}
          />
          <DurationField
            label={t('Interval')}
            value={spec.interval}
            onChange={v => setSpec({ interval: v })}
          />
        </FieldRow>
        <TextField
          size="small"
          label={t('Job name')}
          value={spec.jobName || ''}
          onChange={e => setSpec({ jobName: e.target.value || undefined })}
        />
      </FormSection>
      <FormSection title={t('Targets')} icon="mdi:target">
        <StringListField
          label={t('Static targets (URLs or host:port)')}
          value={spec.targets?.staticConfig?.static}
          onChange={v =>
            setSpec({
              targets: {
                ...spec.targets,
                staticConfig: { ...spec.targets?.staticConfig, static: v || [] },
              },
            })
          }
        />
      </FormSection>
      <FormSection title={t('Prometheus selection')} icon="mdi:database">
        <SelectionCheck kind="Probe" value={value} onChange={onChange} />
      </FormSection>
    </Box>
  );
}

export function newScrapeConfig(namespace = ''): Obj {
  return {
    apiVersion: creationApiVersion(ScrapeConfig),
    kind: 'ScrapeConfig',
    metadata: { name: '', namespace },
    spec: { metricsPath: '/metrics', scrapeInterval: '30s', staticConfigs: [{ targets: [] }] },
  };
}

export function validateScrapeConfig(value: Obj, t: (s: string, o?: Obj) => string): FormIssue[] {
  const errors = validateMetadata(value, t);
  if (value.spec?.scrapeInterval && !isValidPromDuration(value.spec.scrapeInterval))
    errors.push(issue('general', t('Invalid interval.')));
  return errors;
}

export function ScrapeConfigForm({ value, onChange, showErrors, editMode }: ResourceFormProps) {
  const { t } = useText();
  const spec = value.spec || {};
  const setSpec = (patch: Obj) => onChange({ ...value, spec: { ...spec, ...patch } });
  const statics = spec.staticConfigs || [];
  return (
    <Box>
      <MetadataSection
        value={value}
        onChange={onChange}
        showErrors={showErrors}
        editMode={editMode}
      />
      <FormSection
        title={t('Scrape settings')}
        description={t('For service discovery (Kubernetes, HTTP, DNS, cloud) use the YAML tab.')}
      >
        <FieldRow>
          <TextField
            size="small"
            label={t('Job name')}
            value={spec.jobName || ''}
            onChange={e => setSpec({ jobName: e.target.value || undefined })}
          />
          <TextField
            size="small"
            label={t('Metrics path')}
            value={spec.metricsPath || ''}
            onChange={e => setSpec({ metricsPath: e.target.value || undefined })}
          />
          <DurationField
            label={t('Scrape interval')}
            value={spec.scrapeInterval}
            onChange={v => setSpec({ scrapeInterval: v })}
          />
          <TextField
            select
            size="small"
            label={t('Scheme')}
            value={spec.scheme || 'HTTP'}
            onChange={e =>
              setSpec({ scheme: e.target.value === 'HTTP' ? undefined : e.target.value })
            }
          >
            <MenuItem value="HTTP">HTTP</MenuItem>
            <MenuItem value="HTTPS">HTTPS</MenuItem>
          </TextField>
        </FieldRow>
      </FormSection>
      {statics.map((sc: Obj, i: number) => (
        <FormSection key={i} title={t('Static targets {{n}}', { n: i + 1 })}>
          <StringListField
            label={t('Targets (host:port)')}
            value={sc.targets}
            onChange={v =>
              setSpec({
                staticConfigs: statics.map((x: Obj, idx: number) =>
                  idx === i ? { ...x, targets: v || [] } : x
                ),
              })
            }
          />
          <Typography variant="caption" color="text.secondary">
            {t('Labels')}
          </Typography>
          <KeyValueEditor
            value={sc.labels}
            keyPattern={PROM_LABEL_RE}
            onChange={labels =>
              setSpec({
                staticConfigs: statics.map((x: Obj, idx: number) =>
                  idx === i ? { ...x, labels } : x
                ),
              })
            }
          />
        </FormSection>
      ))}
      <FormSection title={t('Prometheus selection')} icon="mdi:database">
        <SelectionCheck kind="ScrapeConfig" value={value} onChange={onChange} />
      </FormSection>
    </Box>
  );
}
