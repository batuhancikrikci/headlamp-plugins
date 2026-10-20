import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { AlertmanagerConfig, creationApiVersion } from '../../resources/crds';
import {
  AMCInhibitRule,
  AMCMatcher,
  AMCReceiver,
  AMCRoute,
  ReceiverConfig,
  SecretKeySelector,
} from '../../types';
import { isValidPromDuration } from '../../utils/duration';
import { TagList } from '../common/Selectors';
import { MetadataSection, SecretKeyField, SelectionCheck, validateMetadata } from './common';
import { DurationField, FieldRow, FormSection, PROM_LABEL_RE, StringListField } from './fields';
import { FormIssue, issue, Obj, ResourceFormProps } from './ResourceEditorDialog';
import { FormTabs, SummaryList, Wizard } from './Wizard';

export function newAlertmanagerConfig(namespace = ''): Obj {
  return {
    apiVersion: creationApiVersion(AlertmanagerConfig),
    kind: 'AlertmanagerConfig',
    metadata: { name: '', namespace },
    spec: {
      route: {
        receiver: '',
        groupBy: ['alertname', 'job'],
        groupWait: '30s',
        groupInterval: '5m',
        repeatInterval: '4h',
      },
      receivers: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Receiver types
// ---------------------------------------------------------------------------

type FieldKind = 'text' | 'secret' | 'bool' | 'number' | 'list';

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  placeholder?: string;
}

interface ReceiverType {
  key: keyof AMCReceiver & string;
  label: string;
  icon: string;
  fields: FieldDef[];
}

const RECEIVER_TYPES: ReceiverType[] = [
  {
    key: 'slackConfigs',
    label: 'Slack',
    icon: 'mdi:slack',
    fields: [
      { key: 'apiURL', label: 'Webhook URL', kind: 'secret', required: true },
      { key: 'channel', label: 'Channel', kind: 'text', placeholder: '#alerts' },
      { key: 'username', label: 'Username', kind: 'text' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'text', label: 'Text', kind: 'text' },
    ],
  },
  {
    key: 'emailConfigs',
    label: 'Email',
    icon: 'mdi:email',
    fields: [
      { key: 'to', label: 'To', kind: 'text', required: true, placeholder: 'team@example.com' },
      { key: 'from', label: 'From', kind: 'text', placeholder: 'alertmanager@example.com' },
      {
        key: 'smarthost',
        label: 'SMTP host:port',
        kind: 'text',
        placeholder: 'smtp.example.com:587',
      },
      { key: 'authUsername', label: 'SMTP username', kind: 'text' },
      { key: 'authPassword', label: 'SMTP password', kind: 'secret' },
      { key: 'requireTLS', label: 'Require TLS', kind: 'bool' },
    ],
  },
  {
    key: 'webhookConfigs',
    label: 'Webhook',
    icon: 'mdi:webhook',
    fields: [
      { key: 'url', label: 'URL', kind: 'text', placeholder: 'https://hooks.example.com/alerts' },
      { key: 'urlSecret', label: 'URL (from Secret)', kind: 'secret' },
      { key: 'maxAlerts', label: 'Max alerts per message', kind: 'number' },
    ],
  },
  {
    key: 'pagerdutyConfigs',
    label: 'PagerDuty',
    icon: 'mdi:alert-octagon',
    fields: [
      { key: 'routingKey', label: 'Routing key (Events v2)', kind: 'secret', required: true },
      {
        key: 'severity',
        label: 'Severity',
        kind: 'text',
        placeholder: '{{ .CommonLabels.severity }}',
      },
      { key: 'description', label: 'Description', kind: 'text' },
    ],
  },
  {
    key: 'msteamsConfigs',
    label: 'Microsoft Teams',
    icon: 'mdi:microsoft-teams',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', kind: 'secret', required: true },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'text', label: 'Text', kind: 'text' },
    ],
  },
  {
    key: 'telegramConfigs',
    label: 'Telegram',
    icon: 'mdi:send',
    fields: [
      { key: 'botToken', label: 'Bot token', kind: 'secret', required: true },
      { key: 'chatID', label: 'Chat ID', kind: 'number', required: true },
      { key: 'parseMode', label: 'Parse mode', kind: 'text', placeholder: 'HTML' },
    ],
  },
  {
    key: 'opsgenieConfigs',
    label: 'Opsgenie',
    icon: 'mdi:bell-ring',
    fields: [
      { key: 'apiKey', label: 'API key', kind: 'secret', required: true },
      { key: 'message', label: 'Message', kind: 'text' },
      { key: 'priority', label: 'Priority', kind: 'text', placeholder: 'P3' },
    ],
  },
];

/**
 * Receiver field labels are translated dynamically (t(field.label)); listing
 * them here lets the i18n extractor pick them up.
 */
export function receiverFieldLabels(t: (s: string) => string): string[] {
  return [
    t('Webhook URL'),
    t('Channel'),
    t('Username'),
    t('Title'),
    t('Text'),
    t('To'),
    t('From'),
    t('SMTP host:port'),
    t('SMTP username'),
    t('SMTP password'),
    t('Require TLS'),
    t('URL'),
    t('URL (from Secret)'),
    t('Max alerts per message'),
    t('Routing key (Events v2)'),
    t('Severity'),
    t('Description'),
    t('Bot token'),
    t('Chat ID'),
    t('Parse mode'),
    t('API key'),
    t('Message'),
    t('Priority'),
  ];
}

export function receiverTypesOf(r: AMCReceiver): ReceiverType[] {
  return RECEIVER_TYPES.filter(
    rt => Array.isArray(r[rt.key]) && (r[rt.key] as unknown[]).length > 0
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function collectRoutes(route?: AMCRoute): AMCRoute[] {
  if (!route) return [];
  return [route, ...(route.routes || []).flatMap(collectRoutes)];
}

export function validateAlertmanagerConfig(
  value: Obj,
  t: (s: string, o?: Obj) => string
): FormIssue[] {
  const errors = validateMetadata(value, t);
  const rcv = (m: string) => issue('receivers', m);
  const rte = (m: string) => issue('routing', m);
  const spec = value.spec || {};
  const receivers: AMCReceiver[] = spec.receivers || [];
  const names = receivers.map(r => r.name);
  if (receivers.length === 0) errors.push(rcv(t('Add at least one receiver.')));
  receivers.forEach((r, i) => {
    if (!r.name) errors.push(rcv(t('Receiver {{n}}: name is required.', { n: i + 1 })));
    if (names.indexOf(r.name) !== i)
      errors.push(rcv(t('Receiver names must be unique: {{name}}', { name: r.name })));
    for (const rt of receiverTypesOf(r)) {
      (r[rt.key] as ReceiverConfig[]).forEach(cfg => {
        for (const f of rt.fields.filter(f => f.required)) {
          const v = cfg[f.key] as unknown;
          const empty =
            v === undefined || v === '' || (f.kind === 'secret' && !(v as SecretKeySelector)?.name);
          if (empty)
            errors.push(
              rcv(
                t('Receiver {{name}} ({{type}}): {{field}} is required.', {
                  name: r.name,
                  type: rt.label,
                  field: t(f.label),
                })
              )
            );
        }
      });
    }
    if (r.webhookConfigs?.some(c => !c.url && !c.urlSecret)) {
      errors.push(
        rcv(t('Receiver {{name}} (Webhook): set a URL or a URL secret.', { name: r.name }))
      );
    }
  });
  const routes = collectRoutes(spec.route);
  if (!spec.route?.receiver) errors.push(rte(t('The root route needs a receiver.')));
  for (const route of routes) {
    if (route.receiver && !names.includes(route.receiver)) {
      errors.push(
        rte(t('Route references unknown receiver "{{name}}".', { name: route.receiver }))
      );
    }
    for (const d of [route.groupWait, route.groupInterval, route.repeatInterval]) {
      if (d && !isValidPromDuration(d))
        errors.push(rte(t('Invalid duration "{{d}}" in a route.', { d })));
    }
    for (const m of route.matchers || []) {
      if (!PROM_LABEL_RE.test(m.name))
        errors.push(rte(t('Invalid matcher label name "{{name}}".', { name: m.name })));
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

function ReceiverConfigEditor({
  type,
  config,
  onChange,
  onRemove,
  namespace,
  showErrors,
}: {
  type: ReceiverType;
  config: ReceiverConfig;
  onChange: (c: ReceiverConfig) => void;
  onRemove: () => void;
  namespace?: string;
  showErrors: boolean;
}) {
  const { t } = useText();
  const set = (key: string, v: unknown) => {
    const next = { ...config };
    if (v === undefined || v === '') delete next[key];
    else next[key] = v;
    onChange(next);
  };
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon icon={type.icon} />
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          {type.label}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={config.sendResolved !== false}
              onChange={e => set('sendResolved', e.target.checked ? undefined : false)}
            />
          }
          label={t('Send resolved')}
        />
        <Tooltip title={t('Remove')}>
          <IconButton size="small" aria-label={t('Remove')} onClick={onRemove}>
            <Icon icon="mdi:delete" />
          </IconButton>
        </Tooltip>
      </Box>
      {type.fields.map(f => {
        const v = config[f.key];
        switch (f.kind) {
          case 'secret':
            return (
              <SecretKeyField
                key={f.key}
                namespace={namespace}
                label={t(f.label)}
                required={f.required}
                showErrors={showErrors}
                value={v as SecretKeySelector | undefined}
                onChange={sel => set(f.key, sel)}
              />
            );
          case 'bool':
            return (
              <FormControlLabel
                key={f.key}
                control={
                  <Switch checked={!!v} onChange={e => set(f.key, e.target.checked || undefined)} />
                }
                label={t(f.label)}
              />
            );
          case 'number':
            return (
              <TextField
                key={f.key}
                size="small"
                type="number"
                label={t(f.label)}
                required={f.required}
                value={(v as number | undefined) ?? ''}
                onChange={e =>
                  set(f.key, e.target.value === '' ? undefined : Number(e.target.value))
                }
                error={showErrors && !!f.required && v === undefined}
              />
            );
          default:
            return (
              <TextField
                key={f.key}
                size="small"
                label={t(f.label)}
                required={f.required}
                placeholder={f.placeholder}
                value={(v as string | undefined) ?? ''}
                onChange={e => set(f.key, e.target.value)}
                error={showErrors && !!f.required && !v}
              />
            );
        }
      })}
    </Box>
  );
}

function ReceiverEditor({
  receiver,
  onChange,
  onRemove,
  namespace,
  showErrors,
}: {
  receiver: AMCReceiver;
  onChange: (r: AMCReceiver) => void;
  onRemove: () => void;
  namespace?: string;
  showErrors: boolean;
}) {
  const { t } = useText();
  const addIntegration = (rt: ReceiverType) => {
    const list = (receiver[rt.key] as ReceiverConfig[] | undefined) || [];
    onChange({ ...receiver, [rt.key]: [...list, {}] });
  };
  return (
    <FormSection
      icon="mdi:account-group"
      title={t('Receiver: {{name}}', { name: receiver.name || t('(unnamed)') })}
      actions={
        <Tooltip title={t('Remove receiver')}>
          <IconButton size="small" aria-label={t('Remove receiver')} onClick={onRemove}>
            <Icon icon="mdi:delete" />
          </IconButton>
        </Tooltip>
      }
    >
      <TextField
        size="small"
        required
        label={t('Receiver name')}
        value={receiver.name}
        onChange={e => onChange({ ...receiver, name: e.target.value })}
        error={showErrors && !receiver.name}
      />
      {RECEIVER_TYPES.map(rt =>
        ((receiver[rt.key] as ReceiverConfig[] | undefined) || []).map((cfg, i) => (
          <ReceiverConfigEditor
            key={`${rt.key}-${i}`}
            type={rt}
            config={cfg}
            namespace={namespace}
            showErrors={showErrors}
            onChange={c =>
              onChange({
                ...receiver,
                [rt.key]: (receiver[rt.key] as ReceiverConfig[]).map((x, idx) =>
                  idx === i ? c : x
                ),
              })
            }
            onRemove={() => {
              const list = (receiver[rt.key] as ReceiverConfig[]).filter((_, idx) => idx !== i);
              const next = { ...receiver, [rt.key]: list };
              if (list.length === 0) delete (next as Obj)[rt.key];
              onChange(next);
            }}
          />
        ))
      )}
      <Typography variant="caption" color="text.secondary">
        {t('Add an integration')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 1,
        }}
      >
        {RECEIVER_TYPES.map(rt => (
          <Card key={rt.key} variant="outlined">
            <CardActionArea
              onClick={() => addIntegration(rt)}
              aria-label={t('Add {{type}}', { type: rt.label })}
            >
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
                <Icon icon={rt.icon} width={22} />
                <Typography variant="body2">{rt.label}</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
      {receiverTypesOf(receiver).length === 0 && (
        <Alert severity="info">
          {t('A receiver without integrations silently drops notifications ("null" receiver).')}
        </Alert>
      )}
    </FormSection>
  );
}

const MATCH_TYPES: Array<NonNullable<AMCMatcher['matchType']>> = ['=', '!=', '=~', '!~'];

function MatchersEditor({
  value,
  onChange,
}: {
  value?: AMCMatcher[];
  onChange: (m: AMCMatcher[] | undefined) => void;
}) {
  const { t } = useText();
  const list = value || [];
  const set = (next: AMCMatcher[]) => onChange(next.length ? next : undefined);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {list.map((m, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label={t('Label')}
            value={m.name}
            error={!!m.name && !PROM_LABEL_RE.test(m.name)}
            onChange={e =>
              set(list.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
            }
            sx={{ flex: 1 }}
          />
          <TextField
            select
            size="small"
            label={t('Operator')}
            value={m.matchType || (m.regex ? '=~' : '=')}
            onChange={e =>
              set(
                list.map((x, idx) => {
                  if (idx !== i) return x;
                  // matchType supersedes the legacy v1alpha1 "regex" flag.
                  const next: AMCMatcher = {
                    ...x,
                    matchType: e.target.value as AMCMatcher['matchType'],
                  };
                  delete next.regex;
                  return next;
                })
              )
            }
            sx={{ width: 110 }}
          >
            {MATCH_TYPES.map(op => (
              <MenuItem key={op} value={op}>
                {op}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t('Value')}
            value={m.value || ''}
            onChange={e =>
              set(list.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x)))
            }
            sx={{ flex: 2 }}
          />
          <Tooltip title={t('Remove')}>
            <IconButton
              aria-label={t('Remove')}
              onClick={() => set(list.filter((_, idx) => idx !== i))}
            >
              <Icon icon="mdi:minus-circle-outline" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:plus-circle-outline" />}
          onClick={() => set([...list, { name: '', value: '', matchType: '=' }])}
        >
          {t('Add matcher')}
        </Button>
      </Box>
    </Box>
  );
}

function RouteFields({
  route,
  onChange,
  receiverNames,
  isRoot,
  showErrors,
}: {
  route: AMCRoute;
  onChange: (r: AMCRoute) => void;
  receiverNames: string[];
  isRoot?: boolean;
  showErrors: boolean;
}) {
  const { t } = useText();
  const set = (patch: Partial<AMCRoute>) => onChange({ ...route, ...patch });
  return (
    <>
      <FieldRow>
        <TextField
          select
          size="small"
          label={t('Receiver')}
          required={isRoot}
          value={route.receiver || ''}
          onChange={e => set({ receiver: e.target.value || undefined })}
          error={showErrors && !!isRoot && !route.receiver}
          helperText={receiverNames.length === 0 ? t('Create a receiver first') : ' '}
        >
          {!isRoot && <MenuItem value="">{t('(inherit from parent)')}</MenuItem>}
          {receiverNames.map(n => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
        <StringListField
          label={t('Group by')}
          value={route.groupBy}
          onChange={v => set({ groupBy: v })}
          options={['alertname', 'job', 'namespace', 'severity', 'service', 'cluster', '...']}
          helperText={t('"..." groups by all labels')}
        />
      </FieldRow>
      <FieldRow>
        <DurationField
          label={t('Group wait')}
          value={route.groupWait}
          onChange={v => set({ groupWait: v })}
        />
        <DurationField
          label={t('Group interval')}
          value={route.groupInterval}
          onChange={v => set({ groupInterval: v })}
        />
        <DurationField
          label={t('Repeat interval')}
          value={route.repeatInterval}
          onChange={v => set({ repeatInterval: v })}
        />
      </FieldRow>
      <Box>
        <Typography variant="caption" color="text.secondary">
          {t('Matchers')}
        </Typography>
        <MatchersEditor value={route.matchers} onChange={matchers => set({ matchers })} />
      </Box>
      {!isRoot && (
        <FormControlLabel
          control={
            <Switch
              checked={!!route.continue}
              onChange={e => set({ continue: e.target.checked || undefined })}
            />
          }
          label={t('Continue matching sibling routes')}
        />
      )}
    </>
  );
}

function InhibitRuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: AMCInhibitRule;
  onChange: (r: AMCInhibitRule) => void;
  onRemove: () => void;
}) {
  const { t } = useText();
  return (
    <FormSection
      title={t('Inhibit rule')}
      description={t(
        'Mutes alerts matching the target matchers while an alert matching the source matchers fires.'
      )}
      actions={
        <Tooltip title={t('Remove')}>
          <IconButton size="small" aria-label={t('Remove')} onClick={onRemove}>
            <Icon icon="mdi:delete" />
          </IconButton>
        </Tooltip>
      }
    >
      <Typography variant="caption" color="text.secondary">
        {t('Source (e.g. severity="critical")')}
      </Typography>
      <MatchersEditor
        value={rule.sourceMatch}
        onChange={sourceMatch => onChange({ ...rule, sourceMatch })}
      />
      <Typography variant="caption" color="text.secondary">
        {t('Target (e.g. severity="warning")')}
      </Typography>
      <MatchersEditor
        value={rule.targetMatch}
        onChange={targetMatch => onChange({ ...rule, targetMatch })}
      />
      <StringListField
        label={t('Equal labels')}
        value={rule.equal}
        onChange={equal => onChange({ ...rule, equal })}
        options={['alertname', 'namespace', 'cluster', 'service']}
      />
    </FormSection>
  );
}

export function AlertmanagerConfigForm({
  value,
  onChange,
  showErrors,
  editMode,
  variant,
  errors,
  onSubmit,
  submitting,
  revealErrors,
}: ResourceFormProps & { variant: 'form' | 'wizard' }) {
  const { t } = useText();
  const spec = value.spec || {};
  const configNamespace = value.metadata?.namespace;
  const receivers: AMCReceiver[] = spec.receivers || [];
  const route: AMCRoute = spec.route || {};
  const inhibitRules: AMCInhibitRule[] = spec.inhibitRules || [];
  const setSpec = (patch: Obj) => onChange({ ...value, spec: { ...spec, ...patch } });
  const receiverNames = receivers.map(r => r.name).filter(Boolean);
  const childRoutes = route.routes || [];

  const receiversStep = (
    <Box>
      {receivers.map((r, i) => (
        <ReceiverEditor
          key={i}
          receiver={r}
          namespace={configNamespace}
          showErrors={showErrors}
          onChange={nr => setSpec({ receivers: receivers.map((x, idx) => (idx === i ? nr : x)) })}
          onRemove={() => setSpec({ receivers: receivers.filter((_, idx) => idx !== i) })}
        />
      ))}
      <Button
        startIcon={<Icon icon="mdi:plus" />}
        sx={{ mb: 2 }}
        onClick={() => {
          const name = receivers.length ? `receiver-${receivers.length + 1}` : 'default';
          onChange({
            ...value,
            spec: {
              ...spec,
              receivers: [...receivers, { name }],
              route: route.receiver ? route : { ...route, receiver: name },
            },
          });
        }}
      >
        {t('Add receiver')}
      </Button>
      {configNamespace && (
        <Alert severity="info">
          {t('Secrets referenced by receivers must exist in the "{{nsName}}" namespace.', {
            nsName: configNamespace,
          })}
        </Alert>
      )}
    </Box>
  );

  const routingStep = (
    <Box>
      <FormSection
        icon="mdi:sitemap"
        title={t('Root route')}
        description={t(
          'The operator scopes this config to its namespace: a namespace="{{nsName}}" matcher is added to the root route unless the Alertmanager uses the "None" matcher strategy.',
          { nsName: configNamespace || '…' }
        )}
      >
        <RouteFields
          route={route}
          isRoot
          receiverNames={receiverNames}
          showErrors={showErrors}
          onChange={r => setSpec({ route: { ...r, routes: route.routes } })}
        />
      </FormSection>
      {childRoutes.map((cr, i) => (
        <FormSection
          key={i}
          title={t('Child route {{n}}', { n: i + 1 })}
          actions={
            <Tooltip title={t('Remove route')}>
              <IconButton
                size="small"
                aria-label={t('Remove route')}
                onClick={() =>
                  setSpec({
                    route: { ...route, routes: childRoutes.filter((_, idx) => idx !== i) },
                  })
                }
              >
                <Icon icon="mdi:delete" />
              </IconButton>
            </Tooltip>
          }
        >
          <RouteFields
            route={cr}
            receiverNames={receiverNames}
            showErrors={showErrors}
            onChange={r =>
              setSpec({
                route: {
                  ...route,
                  routes: childRoutes.map((x, idx) =>
                    idx === i ? { ...r, routes: cr.routes } : x
                  ),
                },
              })
            }
          />
          {cr.routes?.length ? (
            <Alert severity="info">
              {t('This route has nested routes; edit them in the YAML tab.')}
            </Alert>
          ) : null}
        </FormSection>
      ))}
      <Button
        startIcon={<Icon icon="mdi:plus" />}
        sx={{ mb: 2 }}
        onClick={() =>
          setSpec({
            route: {
              ...route,
              routes: [
                ...childRoutes,
                { matchers: [{ name: 'severity', value: 'critical', matchType: '=' }] },
              ],
            },
          })
        }
      >
        {t('Add child route')}
      </Button>
    </Box>
  );

  const inhibitStep = (
    <Box>
      {inhibitRules.map((r, i) => (
        <InhibitRuleEditor
          key={i}
          rule={r}
          onChange={nr =>
            setSpec({ inhibitRules: inhibitRules.map((x, idx) => (idx === i ? nr : x)) })
          }
          onRemove={() => setSpec({ inhibitRules: inhibitRules.filter((_, idx) => idx !== i) })}
        />
      ))}
      <Button
        startIcon={<Icon icon="mdi:plus" />}
        sx={{ mb: 2 }}
        onClick={() =>
          setSpec({
            inhibitRules: [
              ...inhibitRules,
              {
                sourceMatch: [{ name: 'severity', value: 'critical', matchType: '=' }],
                targetMatch: [{ name: 'severity', value: 'warning', matchType: '=' }],
                equal: ['alertname'],
              },
            ],
          })
        }
      >
        {t('Add inhibit rule')}
      </Button>
    </Box>
  );

  const selectionStep = (
    <FormSection
      icon="mdi:email-alert"
      title={t('Alertmanager selection')}
      description={t(
        'Alertmanager loads only configs matched by alertmanagerConfigSelector and alertmanagerConfigNamespaceSelector.'
      )}
    >
      <SelectionCheck kind="AlertmanagerConfig" value={value} onChange={onChange} />
    </FormSection>
  );

  const general = (
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
          { id: 'general', label: t('General'), content: general },
          { id: 'receivers', label: t('Receivers'), content: receiversStep },
          { id: 'routing', label: t('Routing'), content: routingStep },
          { id: 'inhibition', label: t('Inhibition'), content: inhibitStep },
          { id: 'alertmanager', label: t('Alertmanager'), content: selectionStep },
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
          description: t(
            'Name the configuration. It only applies to alerts from its own namespace by default.'
          ),
          content: general,
          errors: bySection('general'),
        },
        {
          id: 'receivers',
          label: t('Receivers'),
          description: t('Where notifications go. Pick one or more integrations per receiver.'),
          content: receiversStep,
          errors: bySection('receivers'),
        },
        {
          id: 'routing',
          label: t('Routing'),
          description: t(
            'Which alerts go to which receiver, and how they are grouped and repeated.'
          ),
          content: routingStep,
          errors: bySection('routing'),
        },
        {
          id: 'inhibition',
          label: t('Inhibition'),
          description: t(
            'Optionally mute less severe alerts while a related critical alert fires.'
          ),
          content: inhibitStep,
          optional: true,
        },
        {
          id: 'review',
          label: t('Review'),
          description: t('Check the summary and which Alertmanager will load this configuration.'),
          content: (
            <>
              <FormSection title={t('Summary')} icon="mdi:clipboard-check-outline">
                <SummaryList
                  rows={[
                    { id: 'name', label: t('Name'), value: value.metadata?.name || '-' },
                    { id: 'ns', label: t('Namespace'), value: configNamespace || '-' },
                    {
                      id: 'receivers',
                      label: t('Receivers'),
                      value: (
                        <TagList
                          items={receivers.map(
                            r =>
                              `${r.name}: ${
                                receiverTypesOf(r)
                                  .map(rt => rt.label)
                                  .join(', ') || 'null'
                              }`
                          )}
                        />
                      ),
                    },
                    { id: 'root', label: t('Root route'), value: route.receiver || '-' },
                    { id: 'children', label: t('Routes'), value: String(childRoutes.length) },
                    {
                      id: 'inhibit',
                      label: t('Inhibit rules'),
                      value: String(inhibitRules.length),
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
