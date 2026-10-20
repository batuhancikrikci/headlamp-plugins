/**
 * Form building blocks. Every input is bound to a path inside the edited resource, shows the
 * validation issue reported for that path and removes the field from the resource when cleared.
 */
import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  FormControlLabel,
  FormHelperText,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { asArray, asString, asStringMap, deepEqual, moveItem } from '../../../utils/objects';
import { issuesUnder } from '../../../utils/validation';
import { useErrorCount, useFieldIssue, useForm } from './FormContext';

export interface Option {
  value: string;
  label?: string;
  /** Secondary text shown in the dropdown. */
  description?: string;
}

interface BaseFieldProps {
  path: string;
  label: string;
  required?: boolean;
  help?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
}

function helperText(help: React.ReactNode, error?: string, warning?: string): React.ReactNode {
  if (error) return error;
  if (warning) {
    return (
      <Box component="span" sx={{ color: 'warning.main' }}>
        {warning}
      </Box>
    );
  }
  return help;
}

/** Titled group of fields with an optional explanation. */
export function FormSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Box component="section" sx={{ mb: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="h6" component="h3" sx={{ fontSize: '1.05rem', flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {description}
        </Typography>
      )}
      <Stack spacing={2} sx={{ mt: description ? 0 : 1.5 }}>
        {children}
      </Stack>
    </Box>
  );
}

/** Responsive grid that lays fields out side by side when there is room. */
export function FieldGrid({
  children,
  minWidth = 220,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
        gap: 2,
        alignItems: 'start',
      }}
    >
      {children}
    </Box>
  );
}

export function TextInput({
  path,
  label,
  required,
  help,
  disabled,
  placeholder,
  mono,
  multiline,
}: BaseFieldProps & { mono?: boolean; multiline?: boolean }) {
  const { get, set } = useForm();
  const { error, warning, onBlur } = useFieldIssue(path);
  return (
    <TextField
      label={label}
      value={asString(get(path))}
      onChange={event => set(path, event.target.value === '' ? undefined : event.target.value)}
      onBlur={onBlur}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      error={!!error}
      helperText={helperText(help, error, warning)}
      size="small"
      fullWidth
      multiline={multiline}
      minRows={multiline ? 2 : undefined}
      InputProps={mono ? { sx: { fontFamily: 'monospace' } } : undefined}
    />
  );
}

export function NumberInput({
  path,
  label,
  required,
  help,
  disabled,
  placeholder,
  min,
  max,
}: BaseFieldProps & { min?: number; max?: number }) {
  const { get, set } = useForm();
  const { error, warning, onBlur } = useFieldIssue(path);
  const raw = get(path);
  return (
    <TextField
      label={label}
      type="number"
      value={raw === undefined || raw === null ? '' : asString(raw)}
      onChange={event => {
        const text = event.target.value;
        set(path, text === '' ? undefined : Number(text));
      }}
      onBlur={onBlur}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      error={!!error}
      helperText={helperText(help, error, warning)}
      size="small"
      fullWidth
      inputProps={{ min, max }}
    />
  );
}

export function SelectInput({
  path,
  label,
  required,
  help,
  disabled,
  options,
  emptyLabel,
  onSelect,
  numeric,
}: BaseFieldProps & {
  options: Option[];
  /** When set, an empty choice with this label is offered and clears the field. */
  emptyLabel?: string;
  /** Store the selected value as a number (the option values are numeric strings). */
  numeric?: boolean;
  /** Called after the value changed, for side effects on other fields. */
  onSelect?: (value: string | undefined, previous: string) => void;
}) {
  const { get, set } = useForm();
  const { error, warning, onBlur } = useFieldIssue(path);
  const current = asString(get(path));
  // A value written in the YAML editor that is not among the options must stay selectable.
  const known = options.some(option => option.value === current);
  const all = known || current === '' ? options : [...options, { value: current, label: current }];

  return (
    <TextField
      select
      label={label}
      value={current}
      onChange={event => {
        const next = event.target.value === '' ? undefined : event.target.value;
        set(path, numeric && next !== undefined ? Number(next) : next);
        onSelect?.(next, current);
      }}
      onBlur={onBlur}
      required={required}
      disabled={disabled}
      error={!!error}
      helperText={helperText(help, error, warning)}
      size="small"
      fullWidth
      SelectProps={{ displayEmpty: emptyLabel !== undefined }}
      InputLabelProps={emptyLabel !== undefined ? { shrink: true } : undefined}
    >
      {emptyLabel !== undefined && (
        <MenuItem value="">
          <em>{emptyLabel}</em>
        </MenuItem>
      )}
      {all.map(option => (
        <MenuItem key={option.value} value={option.value}>
          <Box>
            {option.label ?? option.value}
            {option.description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {option.description}
              </Typography>
            )}
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}

export function SwitchInput({
  path,
  label,
  help,
  disabled,
}: Omit<BaseFieldProps, 'required' | 'placeholder'>) {
  const { get, set } = useForm();
  return (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={get(path) === true}
            onChange={event => set(path, event.target.checked ? true : undefined)}
            disabled={disabled}
          />
        }
        label={label}
      />
      {help && <FormHelperText sx={{ mt: -0.5 }}>{help}</FormHelperText>}
    </Box>
  );
}

/**
 * Free-text input with suggestions, not bound to the form: the building block of the pickers,
 * which need to react to a selection (e.g. also set the namespace).
 */
export function Combo({
  label,
  value,
  onChange,
  options,
  required,
  disabled,
  placeholder,
  error,
  helper,
  onBlur,
  loading,
}: {
  label: string;
  value: string;
  onChange: (value: string, option?: Option) => void;
  options: Option[];
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  error?: boolean;
  helper?: React.ReactNode;
  onBlur?: () => void;
  loading?: boolean;
}) {
  return (
    <Autocomplete<Option, false, false, true>
      freeSolo
      options={options}
      value={value}
      inputValue={value}
      disabled={disabled}
      loading={loading}
      getOptionLabel={option => (typeof option === 'string' ? option : option.value)}
      isOptionEqualToValue={(option, selected) =>
        option.value === (typeof selected === 'string' ? selected : selected.value)
      }
      onInputChange={(_event, text, reason) => {
        // "reset" fires when the value is set programmatically; it is not a user edit.
        if (reason !== 'reset') onChange(text);
      }}
      onChange={(_event, selected) => {
        if (selected === null) onChange('');
        else if (typeof selected === 'string') onChange(selected);
        else onChange(selected.value, selected);
      }}
      renderOption={(props, option) => (
        <li {...props} key={option.value}>
          <Box>
            {option.label ?? option.value}
            {option.description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {option.description}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          required={required}
          placeholder={placeholder}
          error={error}
          helperText={helper}
          onBlur={onBlur}
          size="small"
          fullWidth
        />
      )}
    />
  );
}

/** Free-text input with suggestions, bound to a path. */
export function ComboInput({
  path,
  label,
  required,
  help,
  disabled,
  placeholder,
  options,
  loading,
  onSelect,
}: BaseFieldProps & {
  options: Option[];
  loading?: boolean;
  onSelect?: (value: string, option?: Option) => void;
}) {
  const { get, set } = useForm();
  const { error, warning, onBlur } = useFieldIssue(path);
  return (
    <Combo
      label={label}
      value={asString(get(path))}
      onChange={(next, option) => {
        set(path, next === '' ? undefined : next);
        onSelect?.(next, option);
      }}
      options={options}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      error={!!error}
      helper={helperText(help, error, warning)}
      onBlur={onBlur}
      loading={loading}
    />
  );
}

/** List of short strings (hostnames, header names, HTTP methods) edited as chips. */
export function StringListInput({
  path,
  label,
  required,
  help,
  disabled,
  placeholder,
  options = [],
  keepEmpty,
}: BaseFieldProps & {
  /** Suggestions; any other text can still be entered. */
  options?: string[];
  /** Keep an empty list in the resource instead of removing the field. */
  keepEmpty?: boolean;
}) {
  const { get, set, issues, showAllErrors } = useForm();
  const [touched, setTouched] = React.useState(false);
  const values = asArray<unknown>(get(path))
    .map(asString)
    .filter(v => v !== '');
  const errors = issuesUnder(issues, path).filter(issue => issue.severity === 'error');
  const visibleError = touched || showAllErrors ? errors[0] : undefined;
  const invalidIndexes = new Set(
    errors
      .map(issue => issue.path.slice(path.length + 1))
      .filter(rest => /^\d+$/.test(rest))
      .map(Number)
  );

  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      autoSelect
      options={options.filter(option => !values.includes(option))}
      value={values}
      disabled={disabled}
      onChange={(_event, next) => {
        const cleaned = [...new Set(next.map(v => v.trim()).filter(v => v !== ''))];
        set(path, cleaned.length === 0 && !keepEmpty ? undefined : cleaned);
      }}
      onBlur={() => setTouched(true)}
      renderTags={(tags, getTagProps) =>
        tags.map((tag, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              key={key}
              size="small"
              label={tag}
              color={invalidIndexes.has(index) && (touched || showAllErrors) ? 'error' : 'default'}
              sx={{ fontFamily: 'monospace' }}
              {...tagProps}
            />
          );
        })
      }
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          required={required}
          placeholder={values.length === 0 ? placeholder : undefined}
          error={!!visibleError}
          helperText={visibleError ? visibleError.message : help}
          size="small"
          fullWidth
        />
      )}
    />
  );
}

interface Row {
  key: string;
  value: string;
}

function rowsToMap(rows: Row[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.key !== '') map[row.key] = row.value;
  }
  return map;
}

/** String map (labels, annotations, options) edited as key / value rows. */
export function KeyValueInput({
  path,
  label,
  help,
  keyLabel = 'Key',
  valueLabel = 'Value',
  addLabel = 'Add entry',
}: {
  path: string;
  label: string;
  help?: React.ReactNode;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
}) {
  const { get, set } = useForm();
  const map = asStringMap(get(path));
  const [rows, setRows] = React.useState<Row[]>(() =>
    Object.entries(map).map(([key, value]) => ({ key, value }))
  );
  const signature = JSON.stringify(map);

  // Rows are kept locally so a row can exist while its key is still empty. When the resource
  // changes from elsewhere (YAML editor), the rows follow.
  React.useEffect(() => {
    setRows(current =>
      deepEqual(rowsToMap(current), map)
        ? current
        : Object.entries(map).map(([key, value]) => ({ key, value }))
    );
    // `signature` captures the content of `map`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const commit = (next: Row[]) => {
    setRows(next);
    const nextMap = rowsToMap(next);
    set(path, Object.keys(nextMap).length === 0 ? undefined : nextMap);
  };

  return (
    <Box>
      <Typography variant="subtitle2">{label}</Typography>
      {help && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {help}
        </Typography>
      )}
      <Stack spacing={1} sx={{ mt: 1 }}>
        {rows.map((row, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label={keyLabel}
              value={row.key}
              onChange={event =>
                commit(rows.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)))
              }
              size="small"
              fullWidth
            />
            <TextField
              label={valueLabel}
              value={row.value}
              onChange={event =>
                commit(rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
              }
              size="small"
              fullWidth
            />
            <Tooltip title="Remove">
              <IconButton
                aria-label={`Remove ${row.key || 'entry'}`}
                onClick={() => commit(rows.filter((_, i) => i !== index))}
              >
                <Icon icon="mdi:close" />
              </IconButton>
            </Tooltip>
          </Stack>
        ))}
      </Stack>
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => setRows([...rows, { key: '', value: '' }])}
        sx={{ mt: 1 }}
      >
        {addLabel}
      </Button>
    </Box>
  );
}

function ItemErrorBadge({ path }: { path: string }) {
  const count = useErrorCount(path);
  const { showAllErrors } = useForm();
  if (count === 0 || !showAllErrors) return null;
  return (
    <Tooltip title={`${count} problem${count === 1 ? '' : 's'}`}>
      <Badge badgeContent={count} color="error" sx={{ mx: 1.5 }} />
    </Tooltip>
  );
}

export interface ArrayInputProps<T> {
  /** Path of the list inside the resource. */
  path: string;
  /** Singular name of an item, e.g. `listener`. */
  itemLabel: string;
  /** Title of one item card. */
  itemTitle: (item: T, index: number) => React.ReactNode;
  newItem: () => unknown;
  renderItem: (itemPath: string, index: number, item: T) => React.ReactNode;
  /** Keep the list in the resource when it becomes empty (for required lists). */
  keepEmpty?: boolean;
  min?: number;
  max?: number;
  emptyText?: string;
  /** Render items as plain rows instead of cards (for small items). */
  dense?: boolean;
  /** Start with every item except the first collapsed. */
  collapsible?: boolean;
}

/** Editable list of objects with add, remove and reorder. */
export function ArrayInput<T = Record<string, unknown>>({
  path,
  itemLabel,
  itemTitle,
  newItem,
  renderItem,
  keepEmpty,
  min = 0,
  max,
  emptyText,
  dense,
  collapsible,
}: ArrayInputProps<T>) {
  const { get, set, issues, showAllErrors } = useForm();
  const items = asArray<T>(get(path));
  const [collapsed, setCollapsed] = React.useState<Set<number>>(new Set());
  const listIssue = issues.find(issue => issue.path === path);

  const write = (next: T[]) => set(path, next.length === 0 && !keepEmpty ? undefined : next);
  const remove = (index: number) => {
    write(items.filter((_, i) => i !== index));
    setCollapsed(new Set());
  };
  const move = (from: number, to: number) => {
    write(moveItem(items, from, to));
    setCollapsed(new Set());
  };
  const toggle = (index: number) =>
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const controls = (index: number) => (
    <Stack direction="row" alignItems="center">
      <Tooltip title="Move up">
        <span>
          <IconButton
            size="small"
            aria-label={`Move ${itemLabel} ${index + 1} up`}
            disabled={index === 0}
            onClick={() => move(index, index - 1)}
          >
            <Icon icon="mdi:arrow-up" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Move down">
        <span>
          <IconButton
            size="small"
            aria-label={`Move ${itemLabel} ${index + 1} down`}
            disabled={index === items.length - 1}
            onClick={() => move(index, index + 1)}
          >
            <Icon icon="mdi:arrow-down" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={items.length <= min ? `At least ${min} required` : 'Remove'}>
        <span>
          <IconButton
            size="small"
            aria-label={`Remove ${itemLabel} ${index + 1}`}
            disabled={items.length <= min}
            onClick={() => remove(index)}
          >
            <Icon icon="mdi:delete-outline" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );

  return (
    <Box>
      {items.length === 0 && emptyText && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {emptyText}
        </Typography>
      )}
      <Stack spacing={dense ? 1 : 1.5}>
        {items.map((item, index) => {
          const itemPath = `${path}.${index}`;
          if (dense) {
            return (
              <Stack key={index} direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>{renderItem(itemPath, index, item)}</Box>
                <Tooltip title="Remove">
                  <span>
                    <IconButton
                      aria-label={`Remove ${itemLabel} ${index + 1}`}
                      disabled={items.length <= min}
                      onClick={() => remove(index)}
                    >
                      <Icon icon="mdi:close" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            );
          }
          const isCollapsed = collapsible && collapsed.has(index);
          return (
            <Paper key={index} variant="outlined" sx={{ overflow: 'hidden' }}>
              <Stack
                direction="row"
                alignItems="center"
                sx={{ px: 1.5, py: 0.5, bgcolor: 'action.hover' }}
              >
                {collapsible && (
                  <IconButton
                    size="small"
                    aria-label={isCollapsed ? `Expand ${itemLabel}` : `Collapse ${itemLabel}`}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggle(index)}
                    sx={{ mr: 0.5 }}
                  >
                    <Icon icon={isCollapsed ? 'mdi:chevron-right' : 'mdi:chevron-down'} />
                  </IconButton>
                )}
                <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                  {itemTitle(item, index)}
                </Typography>
                <ItemErrorBadge path={itemPath} />
                {controls(index)}
              </Stack>
              <Collapse in={!isCollapsed} unmountOnExit>
                <Box sx={{ p: 2 }}>{renderItem(itemPath, index, item)}</Box>
              </Collapse>
            </Paper>
          );
        })}
      </Stack>
      {listIssue && (showAllErrors || listIssue.severity === 'warning') && (
        <FormHelperText error={listIssue.severity === 'error'} sx={{ mt: 1 }}>
          {listIssue.severity === 'warning' ? (
            <Box component="span" sx={{ color: 'warning.main' }}>
              {listIssue.message}
            </Box>
          ) : (
            listIssue.message
          )}
        </FormHelperText>
      )}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        disabled={max !== undefined && items.length >= max}
        onClick={() => write([...items, newItem() as T])}
        sx={{ mt: 1 }}
      >
        Add {itemLabel}
      </Button>
    </Box>
  );
}

/** A checkbox-like switch that adds or removes an optional block of the resource. */
export function OptionalBlock({
  path,
  label,
  help,
  initial,
  children,
}: {
  path: string;
  label: string;
  help?: React.ReactNode;
  /** Value written when the block is switched on. */
  initial: () => unknown;
  children: React.ReactNode;
}) {
  const { get, set } = useForm();
  const present = get(path) !== undefined && get(path) !== null;
  return (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={present}
            onChange={event => set(path, event.target.checked ? initial() : undefined)}
          />
        }
        label={label}
      />
      {help && <FormHelperText sx={{ mt: -0.5, mb: present ? 1.5 : 0 }}>{help}</FormHelperText>}
      <Collapse in={present} unmountOnExit>
        <Box sx={{ pl: 2, borderLeft: 2, borderColor: 'divider', mt: help ? 0 : 1 }}>
          <Stack spacing={2}>{children}</Stack>
        </Box>
      </Collapse>
    </Box>
  );
}
