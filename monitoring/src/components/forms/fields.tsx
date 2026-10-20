import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  TextFieldProps,
  Tooltip,
  Typography,
} from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useText } from '../../common/i18n';
import { Labels, LabelSelector, LabelSelectorRequirement } from '../../types';
import { isValidPromDuration } from '../../utils/duration';

export const DNS1123_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
export const LABEL_KEY_RE =
  /^([a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
export const PROM_LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidName(name?: string) {
  return !!name && name.length <= 253 && DNS1123_RE.test(name);
}

/** Titled block used to group form fields (same look as the envoy-gateway plugin). */
export function FormSection({
  title,
  description,
  icon,
  children,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
        {icon && (
          <Box sx={{ color: 'primary.main', mt: '2px', display: 'flex' }}>
            <Icon icon={icon} width={20} />
          </Box>
        )}
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
        {actions}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
    </Paper>
  );
}

export function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', '& > *': { flex: '1 1 220px' } }}>
      {children}
    </Box>
  );
}

export function DurationField({
  value,
  onChange,
  required,
  showErrors,
  ...rest
}: Omit<TextFieldProps, 'onChange' | 'value'> & {
  value?: string;
  onChange: (v: string | undefined) => void;
  showErrors?: boolean;
}) {
  const { t } = useText();
  const invalid = !!value && !isValidPromDuration(value);
  const missing = required && !value;
  return (
    <TextField
      size="small"
      value={value || ''}
      onChange={e => onChange(e.target.value.trim() || undefined)}
      error={invalid || (!!showErrors && !!missing)}
      helperText={
        invalid ? t('Use a Prometheus duration such as 30s, 5m or 1h30m') : rest.helperText
      }
      required={required}
      {...rest}
    />
  );
}

export function NamespaceField({
  value,
  onChange,
  disabled,
  showErrors,
}: {
  value?: string;
  onChange: (ns: string) => void;
  disabled?: boolean;
  showErrors?: boolean;
}) {
  const { t } = useText();
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  const options = (namespaces || []).map(n => n.metadata.name).sort();
  return (
    <Autocomplete
      freeSolo
      disabled={disabled}
      options={options}
      value={value || ''}
      onInputChange={(_, v) => v !== (value || '') && onChange(v)}
      renderInput={params => (
        <TextField
          {...params}
          size="small"
          label={t('Namespace')}
          required
          error={!!showErrors && !value}
        />
      )}
    />
  );
}

/** Editable key/value list (labels, annotations, externalLabels). */
export function KeyValueEditor({
  value,
  onChange,
  keyLabel,
  valueLabel,
  keyPattern = LABEL_KEY_RE,
  addLabel,
  multilineValues,
  suggestions,
}: {
  value?: Labels;
  onChange: (next: Labels | undefined) => void;
  keyLabel?: string;
  valueLabel?: string;
  keyPattern?: RegExp;
  addLabel?: string;
  multilineValues?: boolean;
  /** Suggested keys for quick add (e.g. summary/description). */
  suggestions?: string[];
}) {
  const { t } = useText();
  // Rows live in local state so empty or temporarily duplicated keys don't
  // collapse while the user is typing; only complete rows are emitted.
  const [entries, setEntries] = useState<Array<[string, string]>>(() =>
    Object.entries(value || {})
  );
  const lastEmitted = useRef(JSON.stringify(value || {}));
  useEffect(() => {
    const incoming = JSON.stringify(value || {});
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setEntries(Object.entries(value || {}));
    }
  }, [value]);
  const set = (list: Array<[string, string]>) => {
    setEntries(list);
    const next = Object.fromEntries(list.filter(([k]) => k));
    lastEmitted.current = JSON.stringify(next);
    onChange(Object.keys(next).length ? next : undefined);
  };
  const missingSuggestions = (suggestions || []).filter(s => !(value && s in value));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {entries.map(([k, v], i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label={keyLabel || t('Key')}
            value={k}
            error={!!k && !keyPattern.test(k)}
            onChange={e => {
              const list = [...entries];
              list[i] = [e.target.value, v];
              set(list);
            }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label={valueLabel || t('Value')}
            value={v}
            multiline={multilineValues}
            maxRows={6}
            onChange={e => {
              const list = [...entries];
              list[i] = [k, e.target.value];
              set(list);
            }}
            sx={{ flex: 2 }}
          />
          <Tooltip title={t('Remove')}>
            <IconButton
              aria-label={t('Remove')}
              onClick={() => set(entries.filter((_, idx) => idx !== i))}
            >
              <Icon icon="mdi:minus-circle-outline" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={<Icon icon="mdi:plus-circle-outline" />}
          onClick={() => set([...entries, ['', '']])}
        >
          {addLabel || t('Add')}
        </Button>
        {missingSuggestions.map(s => (
          <Button key={s} size="small" variant="text" onClick={() => set([...entries, [s, '']])}>
            + {s}
          </Button>
        ))}
      </Box>
    </Box>
  );
}

/** Label selector editor: matchLabels + matchExpressions. */
export function SelectorEditor({
  value,
  onChange,
}: {
  value?: LabelSelector;
  onChange: (next: LabelSelector) => void;
}) {
  const { t } = useText();
  const exprs = value?.matchExpressions || [];
  const setExprs = (list: LabelSelectorRequirement[]) =>
    onChange({ ...value, matchExpressions: list.length ? list : undefined });
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {t('matchLabels')}
      </Typography>
      <KeyValueEditor
        value={value?.matchLabels}
        onChange={m => onChange({ ...value, matchLabels: m })}
        addLabel={t('Add label')}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
        {t('matchExpressions')}
      </Typography>
      {exprs.map((ex, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label={t('Key')}
            value={ex.key}
            onChange={e =>
              setExprs(exprs.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x)))
            }
            sx={{ flex: 1 }}
          />
          <TextField
            select
            size="small"
            label={t('Operator')}
            value={ex.operator}
            onChange={e =>
              setExprs(
                exprs.map((x, idx) =>
                  idx === i
                    ? {
                        ...x,
                        operator: e.target.value,
                        values: ['Exists', 'DoesNotExist'].includes(e.target.value)
                          ? undefined
                          : x.values || [],
                      }
                    : x
                )
              )
            }
            sx={{ width: 150 }}
          >
            {['In', 'NotIn', 'Exists', 'DoesNotExist'].map(op => (
              <MenuItem key={op} value={op}>
                {op}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t('Values (comma separated)')}
            disabled={['Exists', 'DoesNotExist'].includes(ex.operator)}
            value={(ex.values || []).join(',')}
            onChange={e =>
              setExprs(
                exprs.map((x, idx) =>
                  idx === i
                    ? {
                        ...x,
                        values: e.target.value
                          .split(',')
                          .map(s => s.trim())
                          .filter(Boolean),
                      }
                    : x
                )
              )
            }
            sx={{ flex: 2 }}
          />
          <Tooltip title={t('Remove')}>
            <IconButton
              aria-label={t('Remove')}
              onClick={() => setExprs(exprs.filter((_, idx) => idx !== i))}
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
          onClick={() => setExprs([...exprs, { key: '', operator: 'In', values: [] }])}
        >
          {t('Add expression')}
        </Button>
      </Box>
    </Box>
  );
}

/** Free-form list of strings rendered as a chips input. */
export function StringListField({
  value,
  onChange,
  label,
  options = [],
  helperText,
}: {
  value?: string[];
  onChange: (next: string[] | undefined) => void;
  label: string;
  options?: string[];
  helperText?: string;
}) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value || []}
      onChange={(_, v) => onChange(v.length ? (v as string[]) : undefined)}
      renderInput={params => (
        <TextField {...params} size="small" label={label} helperText={helperText} />
      )}
    />
  );
}

/** Removes keys whose value is undefined/empty string/empty object recursively (keeps false/0). */
export function prune<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(prune) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pv = prune(v);
      if (pv === undefined || pv === '') continue;
      if (pv && typeof pv === 'object' && !Array.isArray(pv) && Object.keys(pv).length === 0)
        continue;
      out[k] = pv;
    }
    return out as T;
  }
  return obj;
}
