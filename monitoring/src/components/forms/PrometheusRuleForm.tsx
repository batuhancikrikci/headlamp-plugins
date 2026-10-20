import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useState } from 'react';
import { useText } from '../../common/i18n';
import { usePrometheusEndpoint } from '../../hooks/useMonitoringEndpoint';
import { creationApiVersion, PrometheusRule } from '../../resources/crds';
import { PromSeriesResult, Rule, RuleGroup } from '../../types';
import { isValidPromDuration } from '../../utils/duration';
import { promQuery } from '../../utils/monitoringApi';
import { TagList } from '../common/Selectors';
import { SeverityChip } from '../common/StatusChip';
import { MetadataSection, SelectionCheck, validateMetadata } from './common';
import { DurationField, FieldRow, FormSection, KeyValueEditor, PROM_LABEL_RE } from './fields';
import { FormIssue, issue, Obj, ResourceFormProps } from './ResourceEditorDialog';
import { FormTabs, SummaryList, Wizard } from './Wizard';

export function newPrometheusRule(namespace = ''): Obj {
  return {
    apiVersion: creationApiVersion(PrometheusRule),
    kind: 'PrometheusRule',
    metadata: { name: '', namespace },
    spec: {
      groups: [
        {
          name: '',
          rules: [
            {
              alert: '',
              expr: '',
              for: '5m',
              labels: { severity: 'warning' },
              annotations: { summary: '', description: '' },
            },
          ],
        },
      ],
    },
  };
}

const RECORD_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

export function validatePrometheusRule(value: Obj, t: (s: string, o?: Obj) => string): FormIssue[] {
  const errors = validateMetadata(value, t);
  const rule = (message: string) => issue('rules', message);
  const groups: RuleGroup[] = value.spec?.groups || [];
  if (groups.length === 0) errors.push(rule(t('Add at least one rule group.')));
  const names = new Set<string>();
  groups.forEach((g, gi) => {
    const gLabel = g.name || `#${gi + 1}`;
    if (!g.name) errors.push(rule(t('Group {{g}}: name is required.', { g: gLabel })));
    else if (names.has(g.name))
      errors.push(rule(t('Group names must be unique: {{g}}', { g: g.name })));
    names.add(g.name);
    if (g.interval && !isValidPromDuration(g.interval))
      errors.push(rule(t('Group {{g}}: invalid interval.', { g: gLabel })));
    if (!g.rules?.length)
      errors.push(rule(t('Group {{g}}: add at least one rule.', { g: gLabel })));
    (g.rules || []).forEach((r, ri) => {
      const rLabel = `${gLabel}/${r.alert || r.record || ri + 1}`;
      if (r.alert !== undefined && r.record !== undefined)
        errors.push(rule(t('Rule {{r}}: set either alert or record.', { r: rLabel })));
      if (r.alert !== undefined && !r.alert)
        errors.push(rule(t('Rule {{r}}: alert name is required.', { r: rLabel })));
      if (r.record !== undefined && !RECORD_RE.test(r.record))
        errors.push(rule(t('Rule {{r}}: invalid record name.', { r: rLabel })));
      if (r.alert === undefined && r.record === undefined)
        errors.push(rule(t('Rule {{r}}: set alert or record.', { r: rLabel })));
      if (r.expr === undefined || String(r.expr).trim() === '')
        errors.push(rule(t('Rule {{r}}: expression is required.', { r: rLabel })));
      if (r.for && !isValidPromDuration(r.for))
        errors.push(rule(t('Rule {{r}}: invalid "for" duration.', { r: rLabel })));
      for (const k of Object.keys(r.labels || {})) {
        if (!PROM_LABEL_RE.test(k))
          errors.push(rule(t('Rule {{r}}: invalid label name {{k}}.', { r: rLabel, k })));
      }
    });
  });
  return errors;
}

function QueryTester({ expr, baseUrl }: { expr: string; baseUrl: string }) {
  const { t } = useText();
  const [state, setState] = useState<{
    loading: boolean;
    error?: string;
    count?: number;
    sample?: PromSeriesResult[];
  }>({
    loading: false,
  });
  const run = async () => {
    setState({ loading: true });
    try {
      const data = await promQuery(baseUrl, expr);
      const result =
        Array.isArray(data.result) && typeof data.result[0] === 'object'
          ? (data.result as PromSeriesResult[])
          : [];
      setState({
        loading: false,
        count: data.resultType === 'vector' ? result.length : 1,
        sample: result.slice(0, 5),
      });
    } catch (e) {
      setState({ loading: false, error: (e as Error).message });
    }
  };
  return (
    <Box>
      <Button
        size="small"
        startIcon={<Icon icon="mdi:play" />}
        onClick={run}
        disabled={!baseUrl || !expr.trim() || state.loading}
      >
        {t('Test query')}
      </Button>
      {!baseUrl && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {t('No Prometheus available for testing')}
        </Typography>
      )}
      {state.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {state.error}
        </Alert>
      )}
      {state.count !== undefined && !state.error && (
        <Alert severity={state.count > 0 ? 'warning' : 'success'} sx={{ mt: 1 }}>
          {state.count > 0
            ? t('{{count}} series currently match: an alert with this expression would fire now.', {
                count: state.count,
              })
            : t('The expression is valid and currently returns no series.')}
          {state.sample?.map((s, i) => (
            <Typography
              key={i}
              variant="caption"
              display="block"
              sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
            >
              {JSON.stringify(s.metric)} = {s.value?.[1]}
            </Typography>
          ))}
        </Alert>
      )}
    </Box>
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
  showErrors,
  baseUrl,
}: {
  rule: Rule;
  onChange: (r: Rule) => void;
  onRemove?: () => void;
  showErrors: boolean;
  baseUrl: string;
}) {
  const { t } = useText();
  const type = rule.record !== undefined ? 'record' : 'alert';
  const set = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });
  const name = type === 'alert' ? rule.alert : rule.record;
  const severity = rule.labels?.severity;
  return (
    <Accordion defaultExpanded={!name} disableGutters variant="outlined">
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={type === 'alert' ? t('Alert') : t('Record')}
            variant="outlined"
          />
          <Typography variant="body2" fontWeight={600}>
            {name || t('(unnamed)')}
          </Typography>
          {type === 'alert' && severity && <SeverityChip severity={severity} />}
        </Box>
        {onRemove && (
          <Tooltip title={t('Remove rule')}>
            <IconButton
              size="small"
              aria-label={t('Remove rule')}
              onClick={e => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Icon icon="mdi:delete" />
            </IconButton>
          </Tooltip>
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={type}
          onChange={(_, v) => {
            if (!v) return;
            if (v === 'record') {
              // Recording rules have no alert name, "for" or annotations.
              const next: Rule = { ...rule, record: rule.alert || '' };
              delete next.alert;
              delete next.for;
              delete next.annotations;
              onChange(next);
            } else {
              const next: Rule = {
                ...rule,
                alert: rule.record || '',
                for: '5m',
                labels: { severity: 'warning', ...rule.labels },
              };
              delete next.record;
              onChange(next);
            }
          }}
        >
          <ToggleButton value="alert">{t('Alerting rule')}</ToggleButton>
          <ToggleButton value="record">{t('Recording rule')}</ToggleButton>
        </ToggleButtonGroup>
        <FieldRow>
          <TextField
            size="small"
            required
            label={type === 'alert' ? t('Alert name') : t('Record (metric name)')}
            value={name || ''}
            onChange={e =>
              set(type === 'alert' ? { alert: e.target.value } : { record: e.target.value })
            }
            error={showErrors && !name}
            helperText={type === 'record' ? t('e.g. namespace:http_requests:rate5m') : ' '}
          />
          {type === 'alert' && (
            <DurationField
              label={t('For')}
              value={rule.for}
              onChange={v => set({ for: v })}
              helperText={t('How long the condition must hold before firing')}
            />
          )}
          {type === 'alert' && (
            <TextField
              select
              size="small"
              label={t('Severity')}
              value={severity || ''}
              onChange={e => set({ labels: { ...rule.labels, severity: e.target.value } })}
              helperText=" "
            >
              {['critical', 'warning', 'info', 'none'].map(s => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          )}
        </FieldRow>
        <TextField
          label={t('PromQL expression')}
          required
          multiline
          minRows={2}
          value={String(rule.expr ?? '')}
          onChange={e => set({ expr: e.target.value })}
          error={showErrors && !String(rule.expr ?? '').trim()}
          inputProps={{ style: { fontFamily: 'monospace' } }}
        />
        <QueryTester expr={String(rule.expr ?? '')} baseUrl={baseUrl} />
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('Labels')}
          </Typography>
          <KeyValueEditor
            value={rule.labels}
            onChange={labels => set({ labels })}
            keyPattern={PROM_LABEL_RE}
            addLabel={t('Add label')}
          />
        </Box>
        {type === 'alert' && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('Annotations')} · {t('Go templating is supported, e.g.')}{' '}
              {'{{ $labels.namespace }}, {{ $value }}'}
            </Typography>
            <KeyValueEditor
              value={rule.annotations}
              onChange={annotations => set({ annotations })}
              keyPattern={PROM_LABEL_RE}
              addLabel={t('Add annotation')}
              multilineValues
              suggestions={['summary', 'description', 'runbook_url']}
            />
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function PrometheusRuleForm({
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
  const prom = usePrometheusEndpoint();
  const groups: RuleGroup[] = value.spec?.groups || [];
  const setGroups = (next: RuleGroup[]) =>
    onChange({ ...value, spec: { ...value.spec, groups: next } });
  const setGroup = (i: number, g: RuleGroup) =>
    setGroups(groups.map((x, idx) => (idx === i ? g : x)));

  const general = (
    <MetadataSection
      value={value}
      onChange={onChange}
      showErrors={showErrors}
      editMode={editMode}
    />
  );

  const rulesStep = (
    <Box>
      {groups.map((g, gi) => (
        <FormSection
          key={gi}
          icon="mdi:format-list-checks"
          title={t('Rule group: {{name}}', { name: g.name || `#${gi + 1}` })}
          actions={
            groups.length > 1 && (
              <Tooltip title={t('Remove group')}>
                <IconButton
                  aria-label={t('Remove group')}
                  size="small"
                  onClick={() => setGroups(groups.filter((_, i) => i !== gi))}
                >
                  <Icon icon="mdi:delete" />
                </IconButton>
              </Tooltip>
            )
          }
        >
          <FieldRow>
            <TextField
              size="small"
              required
              label={t('Group name')}
              value={g.name}
              onChange={e => setGroup(gi, { ...g, name: e.target.value })}
              error={showErrors && !g.name}
            />
            <DurationField
              label={t('Evaluation interval')}
              value={g.interval}
              onChange={v => setGroup(gi, { ...g, interval: v })}
              helperText={t('Empty = Prometheus evaluationInterval')}
            />
          </FieldRow>
          {(g.rules || []).map((r, ri) => (
            <RuleEditor
              key={ri}
              rule={r}
              baseUrl={prom.baseUrl}
              showErrors={showErrors}
              onChange={nr =>
                setGroup(gi, { ...g, rules: g.rules.map((x, idx) => (idx === ri ? nr : x)) })
              }
              onRemove={
                g.rules.length > 1
                  ? () => setGroup(gi, { ...g, rules: g.rules.filter((_, idx) => idx !== ri) })
                  : undefined
              }
            />
          ))}
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() =>
                setGroup(gi, {
                  ...g,
                  rules: [
                    ...(g.rules || []),
                    {
                      alert: '',
                      expr: '',
                      for: '5m',
                      labels: { severity: 'warning' },
                      annotations: { summary: '' },
                    },
                  ],
                })
              }
            >
              {t('Add alerting rule')}
            </Button>
            <Button
              size="small"
              startIcon={<Icon icon="mdi:plus" />}
              onClick={() =>
                setGroup(gi, { ...g, rules: [...(g.rules || []), { record: '', expr: '' }] })
              }
            >
              {t('Add recording rule')}
            </Button>
          </Box>
        </FormSection>
      ))}
      <Button
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => setGroups([...groups, { name: '', rules: [] }])}
        sx={{ mb: 2 }}
      >
        {t('Add rule group')}
      </Button>
    </Box>
  );

  const evaluation = (
    <FormSection
      icon="mdi:database"
      title={t('Rule evaluation')}
      description={t(
        'Prometheus/ThanosRuler load only rules matched by their ruleSelector and ruleNamespaceSelector.'
      )}
    >
      <SelectionCheck kind="PrometheusRule" value={value} onChange={onChange} />
    </FormSection>
  );

  if (variant === 'form') {
    return (
      <FormTabs
        tabs={[
          { id: 'general', label: t('General'), content: general },
          { id: 'rules', label: t('Rules'), content: rulesStep },
          { id: 'evaluation', label: t('Rule evaluation'), content: evaluation },
        ]}
      />
    );
  }

  const counts = groups.reduce(
    (acc, g) => {
      for (const r of g.rules || []) {
        if (r.record !== undefined) acc.records++;
        else acc.alerts++;
      }
      return acc;
    },
    { alerts: 0, records: 0 }
  );

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
          description: t('Name the rule set and choose where it is created.'),
          content: general,
          errors: errors.filter(e => e.section === 'general'),
        },
        {
          id: 'rules',
          label: t('Rules'),
          description: t(
            'Define alerting and recording rules. Use Test query to try an expression against Prometheus.'
          ),
          content: rulesStep,
          errors: errors.filter(e => e.section === 'rules'),
        },
        {
          id: 'review',
          label: t('Review'),
          description: t('Check the summary and which Prometheus will evaluate the rules.'),
          content: (
            <>
              <FormSection title={t('Summary')} icon="mdi:clipboard-check-outline">
                <SummaryList
                  rows={[
                    { id: 'name', label: t('Name'), value: value.metadata?.name || '-' },
                    { id: 'ns', label: t('Namespace'), value: value.metadata?.namespace || '-' },
                    {
                      id: 'groups',
                      label: t('Groups'),
                      value: <TagList items={groups.map(g => g.name || '?')} />,
                    },
                    { id: 'alerts', label: t('Alerting rules'), value: String(counts.alerts) },
                    { id: 'records', label: t('Recording rules'), value: String(counts.records) },
                  ]}
                />
              </FormSection>
              {evaluation}
            </>
          ),
        },
      ]}
    />
  );
}
