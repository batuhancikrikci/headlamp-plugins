/**
 * Form inputs shared by the Cilium forms: metadata, label maps, label selectors, CIDR lists and
 * name pickers backed by live objects.
 */
import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import type { KubeObjectClass } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { FieldGrid, HelpTip, StringListInput, TextInput } from '../../../common/form/Fields';
import { useText } from '../../../common/i18n';
import { isValidResourceName, setIn } from '../../../common/objects';
import { crdByKind } from '../../../resources/registry';
import {
  KubeJson,
  Labels,
  LabelSelector,
  LabelSelectorRequirement,
  SelectorOperator,
} from '../../../resources/types';
import { isValidCIDR, isValidCIDROrIP } from '../../../utils/cidr';
import { isSelectorEmpty, isValidLabelKey, isValidLabelValue } from '../../../utils/selectors';

interface NamedItem {
  metadata: { name: string };
}

/** Sorted, de-duplicated names of a `useList` result. */
function useNames(cls: KubeObjectClass, namespace?: string): { names: string[]; loading: boolean } {
  const [items, error] = cls.useList(cls.isNamespaced && namespace ? { namespace } : {});
  const names = React.useMemo(
    () =>
      Array.from(new Set(((items as NamedItem[] | null) || []).map(i => i.metadata.name))).sort(),
    [items]
  );
  return { names, loading: items === null && !error };
}

interface NameAutocompleteProps {
  cls: KubeObjectClass;
  namespace?: string;
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  error?: string;
}

/** Name picker backed by a live list of objects; free text is still allowed. */
export function NameAutocomplete({
  cls,
  namespace,
  label,
  value,
  onChange,
  required,
  disabled,
  helperText,
  error,
}: NameAutocompleteProps) {
  const { t } = useText();
  const { names, loading } = useNames(cls, namespace);
  const unknown = !!value && !loading && names.length > 0 && !names.includes(value);

  return (
    <Autocomplete
      freeSolo
      size="small"
      options={names}
      loading={loading}
      value={value ?? null}
      inputValue={value ?? ''}
      disabled={disabled}
      onInputChange={(_, next) => onChange(next === '' ? undefined : next)}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={!!error}
          helperText={
            error ||
            (unknown ? t('No {{kind}} with this name exists yet', { kind: cls.kind }) : helperText)
          }
        />
      )}
    />
  );
}

/** Namespace picker (free text allowed, so namespaces the user cannot list still work). */
export function NamespaceInput(props: Omit<NameAutocompleteProps, 'cls' | 'namespace'>) {
  return <NameAutocomplete {...props} cls={K8s.ResourceClasses.Namespace} />;
}

/** Name (and namespace, for namespaced kinds) of the edited object. */
export function MetadataFields({
  value,
  onChange,
  mode,
}: {
  value: KubeJson;
  onChange: (next: KubeJson) => void;
  mode: 'create' | 'edit';
}) {
  const { t } = useText();
  const namespaced = crdByKind(value.kind)?.namespaced ?? !!value.metadata?.namespace;
  const name = value.metadata?.name;
  return (
    <FieldGrid>
      <TextInput
        label={t('Name')}
        required
        disabled={mode === 'edit'}
        value={name}
        onChange={v => onChange(setIn(value, ['metadata', 'name'], v))}
        error={name && !isValidResourceName(name) ? t('Not a valid resource name') : undefined}
        helperText={mode === 'edit' ? t('The name cannot be changed') : undefined}
      />
      {namespaced && (
        <NamespaceInput
          label={t('Namespace')}
          required
          disabled={mode === 'edit'}
          value={value.metadata?.namespace}
          onChange={v => onChange(setIn(value, ['metadata', 'namespace'], v))}
        />
      )}
    </FieldGrid>
  );
}

interface Row {
  key: string;
  value: string;
}

function toRows(value?: Labels): Row[] {
  return Object.entries(value || {}).map(([key, v]) => ({ key, value: v }));
}

function toLabels(rows: Row[]): Labels {
  const out: Labels = {};
  for (const row of rows) if (row.key) out[row.key] = row.value;
  return out;
}

function sameLabels(a: Labels, b: Labels): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => a[k] === b[k]);
}

/**
 * Editor for a string map (labels, config overrides). Rows are kept locally so that a row with
 * a half-typed key does not disappear; the map itself only contains rows that have a key.
 */
export function KeyValueEditor({
  value,
  onChange,
  keyLabel,
  valueLabel,
  addLabel,
  keySuggestions = [],
  validateLabels,
  keepEmpty,
}: {
  value: Labels | undefined;
  onChange: (value: Labels | undefined) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  keySuggestions?: string[];
  /** Validate keys and values as Kubernetes labels. */
  validateLabels?: boolean;
  /** Emit `{}` instead of `undefined` when the last row is removed. */
  keepEmpty?: boolean;
}) {
  const { t } = useText();
  const [rows, setRows] = React.useState<Row[]>(() => toRows(value));

  // Re-sync when the value changed from outside (YAML tab, wizard preset).
  React.useEffect(() => {
    setRows(current => (sameLabels(toLabels(current), value || {}) ? current : toRows(value)));
  }, [value]);

  const commit = (next: Row[]) => {
    setRows(next);
    const labels = toLabels(next);
    onChange(Object.keys(labels).length === 0 && !keepEmpty ? undefined : labels);
  };
  const update = (index: number, patch: Partial<Row>) =>
    commit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <Box>
      {rows.map((row, index) => {
        const duplicate = !!row.key && rows.findIndex(r => r.key === row.key) !== index;
        const keyError =
          validateLabels && row.key && !isValidLabelKey(row.key)
            ? t('Invalid label key')
            : duplicate
            ? t('Duplicate key')
            : undefined;
        const valueError =
          validateLabels && !isValidLabelValue(row.value) ? t('Invalid label value') : undefined;
        return (
          // Rows have no identity other than their position while a key is being typed.
          // eslint-disable-next-line react/no-array-index-key
          <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
            <Autocomplete
              freeSolo
              size="small"
              sx={{ flex: 1 }}
              options={keySuggestions.filter(s => !rows.some(r => r.key === s))}
              value={row.key}
              inputValue={row.key}
              onInputChange={(_, next) => update(index, { key: next.trim() })}
              renderInput={params => (
                <TextField
                  {...params}
                  label={keyLabel || t('Key')}
                  error={!!keyError}
                  helperText={keyError}
                />
              )}
            />
            <TextField
              size="small"
              sx={{ flex: 1 }}
              label={valueLabel || t('Value')}
              value={row.value}
              error={!!valueError}
              helperText={valueError}
              onChange={e => update(index, { value: e.target.value })}
            />
            <Tooltip title={t('Remove')}>
              <IconButton
                size="small"
                sx={{ mt: 0.5 }}
                aria-label={t('Remove')}
                onClick={() => commit(rows.filter((_, i) => i !== index))}
              >
                <Icon icon="mdi:delete-outline" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => setRows([...rows, { key: '', value: '' }])}
      >
        {addLabel || t('Add label')}
      </Button>
    </Box>
  );
}

const OPERATORS: SelectorOperator[] = ['In', 'NotIn', 'Exists', 'DoesNotExist'];

function ExpressionRow({
  requirement,
  onChange,
  onRemove,
}: {
  requirement: LabelSelectorRequirement;
  onChange: (next: LabelSelectorRequirement) => void;
  onRemove: () => void;
}) {
  const { t } = useText();
  const needsValues = requirement.operator === 'In' || requirement.operator === 'NotIn';
  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
      <TextField
        size="small"
        sx={{ flex: 1 }}
        label={t('Key')}
        value={requirement.key}
        error={!!requirement.key && !isValidLabelKey(requirement.key)}
        onChange={e => onChange({ ...requirement, key: e.target.value.trim() })}
      />
      <TextField
        select
        size="small"
        sx={{ width: 150 }}
        label={t('Operator')}
        value={requirement.operator}
        onChange={e => {
          const operator = e.target.value as SelectorOperator;
          const keepValues = operator === 'In' || operator === 'NotIn';
          onChange({
            key: requirement.key,
            operator,
            ...(keepValues ? { values: requirement.values || [] } : {}),
          });
        }}
      >
        {OPERATORS.map(op => (
          <MenuItem key={op} value={op}>
            {op}
          </MenuItem>
        ))}
      </TextField>
      <Box sx={{ flex: 1.5 }}>
        {needsValues ? (
          <StringListInput
            label={t('Values')}
            value={requirement.values}
            onChange={values => onChange({ ...requirement, values: values || [] })}
            validateItem={isValidLabelValue}
          />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {requirement.operator === 'Exists'
              ? t('Matches when the label is present')
              : t('Matches when the label is absent')}
          </Typography>
        )}
      </Box>
      <Tooltip title={t('Remove')}>
        <IconButton size="small" sx={{ mt: 0.5 }} aria-label={t('Remove')} onClick={onRemove}>
          <Icon icon="mdi:delete-outline" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export interface LabelSelectorEditorProps {
  label: string;
  value: LabelSelector | undefined;
  onChange: (value: LabelSelector | undefined) => void;
  help?: string;
  /**
   * Whether the selector may be absent. When set, a switch toggles between "not set" and a
   * selector; `nilText` explains what "not set" means for this field.
   */
  optional?: boolean;
  nilText?: string;
  /** What an empty selector matches, e.g. "every endpoint in the namespace". */
  emptyText?: string;
  keySuggestions?: string[];
}

/** Editor for a Kubernetes label selector (matchLabels and matchExpressions). */
export function LabelSelectorEditor({
  label,
  value,
  onChange,
  help,
  optional,
  nilText,
  emptyText,
  keySuggestions,
}: LabelSelectorEditorProps) {
  const { t } = useText();
  const enabled = value !== undefined && value !== null;
  const expressions = value?.matchExpressions || [];

  const setExpressions = (next: LabelSelectorRequirement[]) => {
    const selector: LabelSelector = { ...(value || {}) };
    if (next.length > 0) selector.matchExpressions = next;
    else delete selector.matchExpressions;
    onChange(selector);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, minHeight: 32 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <HelpTip text={help} />
        <Box sx={{ flexGrow: 1 }} />
        {optional && (
          <FormControlLabel
            sx={{ mr: 0 }}
            control={
              <Switch
                size="small"
                checked={enabled}
                onChange={e => onChange(e.target.checked ? { matchLabels: {} } : undefined)}
              />
            }
            label={<Typography variant="body2">{t('Restrict by labels')}</Typography>}
          />
        )}
      </Box>
      {!enabled ? (
        <Typography variant="body2" color="text.secondary">
          {nilText || t('Not set.')}
        </Typography>
      ) : (
        <>
          <KeyValueEditor
            value={value?.matchLabels}
            keepEmpty
            validateLabels
            keySuggestions={keySuggestions}
            onChange={labels => onChange({ ...(value || {}), matchLabels: labels || {} })}
          />
          {expressions.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              {expressions.map((requirement, index) => (
                <ExpressionRow
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  requirement={requirement}
                  onChange={next =>
                    setExpressions(expressions.map((e, i) => (i === index ? next : e)))
                  }
                  onRemove={() => setExpressions(expressions.filter((_, i) => i !== index))}
                />
              ))}
            </Box>
          )}
          <Button
            size="small"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() =>
              setExpressions([...expressions, { key: '', operator: 'In', values: [] }])
            }
          >
            {t('Add expression')}
          </Button>
          {isSelectorEmpty(value) && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {emptyText || t('An empty selector matches everything.')}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

/** Chip list of CIDRs with inline validation. */
export function CIDRListInput({
  allowIP,
  ...props
}: Omit<React.ComponentProps<typeof StringListInput>, 'validateItem'> & {
  /** Also accept bare IP addresses. */
  allowIP?: boolean;
}) {
  return (
    <StringListInput
      placeholder="10.0.0.0/8"
      {...props}
      validateItem={allowIP ? isValidCIDROrIP : isValidCIDR}
    />
  );
}
