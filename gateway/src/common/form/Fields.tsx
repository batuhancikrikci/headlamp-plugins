/**
 * Form field primitives. Every field writes `undefined` for an empty value so the generated YAML
 * only contains what the user set.
 */
import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useText } from '../i18n';
import { getIn, isValidDuration, Path, setIn } from '../objects';

/** Help icon with a tooltip, used next to field labels. */
export function HelpTip({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <Tooltip title={text}>
      <Box
        component="span"
        sx={{ display: 'inline-flex', ml: 0.5, color: 'text.secondary', cursor: 'help' }}
      >
        <Icon icon="mdi:help-circle-outline" width={16} />
      </Box>
    </Tooltip>
  );
}

interface BaseFieldProps<V> {
  label: string;
  value: V | undefined;
  onChange: (value: V | undefined) => void;
  helperText?: React.ReactNode;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
}

function adornment(help?: string) {
  return help
    ? {
        endAdornment: (
          <InputAdornment position="end">
            <HelpTip text={help} />
          </InputAdornment>
        ),
      }
    : undefined;
}

export function TextInput({
  label,
  value,
  onChange,
  helperText,
  help,
  required,
  disabled,
  placeholder,
  error,
  multiline,
  minRows,
  monospace,
}: BaseFieldProps<string> & { multiline?: boolean; minRows?: number; monospace?: boolean }) {
  return (
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      helperText={error || helperText}
      error={!!error}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      multiline={multiline}
      minRows={minRows}
      InputProps={{
        ...adornment(help),
        sx: monospace ? { fontFamily: 'monospace', fontSize: '0.85rem' } : undefined,
      }}
    />
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  helperText,
  help,
  required,
  disabled,
  placeholder,
  min,
  max,
  error,
}: BaseFieldProps<number> & { min?: number; max?: number }) {
  const { t } = useText();
  let rangeError: string | undefined;
  if (value !== undefined && min !== undefined && value < min) {
    rangeError = t('Must be at least {{min}}', { min });
  } else if (value !== undefined && max !== undefined && value > max) {
    rangeError = t('Must be at most {{max}}', { max });
  }
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={label}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      helperText={error || rangeError || helperText}
      error={!!error || !!rangeError}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      inputProps={{ min, max }}
      InputProps={adornment(help)}
    />
  );
}

/** Text field for Gateway API durations ("10s", "1m30s", "500ms"). */
export function DurationInput(props: BaseFieldProps<string>) {
  const { t } = useText();
  const invalid = !isValidDuration(props.value);
  return (
    <TextInput
      {...props}
      placeholder={props.placeholder || '10s'}
      error={
        props.error || (invalid ? t('Invalid duration, use e.g. 500ms, 10s, 1m30s') : undefined)
      }
    />
  );
}

export interface SelectOption {
  value: string;
  label?: string;
  description?: string;
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
  helperText,
  help,
  required,
  disabled,
  allowEmpty = true,
  emptyLabel,
  error,
}: BaseFieldProps<string> & {
  options: Array<string | SelectOption>;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { t } = useText();
  const opts = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  // Keep an unknown current value selectable instead of silently dropping it.
  if (value && !opts.some(o => o.value === value)) opts.push({ value, label: value });
  return (
    <TextField
      select
      fullWidth
      size="small"
      label={label}
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
      helperText={error || helperText}
      error={!!error}
      required={required}
      disabled={disabled}
      InputProps={adornment(help)}
    >
      {allowEmpty && (
        <MenuItem value="">
          <em>{emptyLabel || t('Default')}</em>
        </MenuItem>
      )}
      {opts.map(o => (
        <MenuItem key={o.value} value={o.value}>
          <Box>
            <Typography variant="body2">{o.label || o.value}</Typography>
            {o.description && (
              <Typography variant="caption" color="text.secondary" component="div">
                {o.description}
              </Typography>
            )}
          </Box>
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Free text with suggestions (e.g. existing namespaces or cluster sets). */
export function ComboInput({
  label,
  value,
  onChange,
  options,
  helperText,
  help,
  required,
  disabled,
  placeholder,
  error,
}: BaseFieldProps<string> & { options: string[] }) {
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={options}
      value={value ?? ''}
      disabled={disabled}
      onChange={(_, next) => onChange(next ? String(next) : undefined)}
      onInputChange={(_, next, reason) => {
        if (reason === 'input') onChange(next === '' ? undefined : next);
      }}
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          required={required}
          placeholder={placeholder}
          helperText={error || helperText}
          error={!!error}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {params.InputProps.endAdornment}
                <HelpTip text={help} />
              </>
            ),
          }}
        />
      )}
    />
  );
}

/**
 * Boolean switch. By default "off" removes the field (Kubernetes default); use `keepFalse` to
 * write an explicit `false`.
 */
export function SwitchInput({
  label,
  value,
  onChange,
  help,
  disabled,
  keepFalse,
  helperText,
}: BaseFieldProps<boolean> & { keepFalse?: boolean }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 40 }}>
        <FormControlLabel
          control={
            <Switch
              checked={!!value}
              disabled={disabled}
              onChange={e => onChange(e.target.checked ? true : keepFalse ? false : undefined)}
            />
          }
          label={label}
        />
        <HelpTip text={help} />
      </Box>
      {helperText && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="div"
          sx={{ mt: -0.5, ml: 6 }}
        >
          {helperText}
        </Typography>
      )}
    </Box>
  );
}

/** List of strings edited as chips; Enter adds a value. */
export function StringListInput({
  label,
  value,
  onChange,
  suggestions = [],
  helperText,
  help,
  placeholder,
  disabled,
  error,
  validateItem,
}: BaseFieldProps<string[]> & {
  suggestions?: string[];
  validateItem?: (item: string) => boolean;
}) {
  const { t } = useText();
  const items = value || [];
  const invalid = validateItem ? items.filter(i => !validateItem(i)) : [];
  return (
    <Autocomplete
      multiple
      freeSolo
      size="small"
      options={suggestions.filter(s => !items.includes(s))}
      value={items}
      disabled={disabled}
      onChange={(_, next) => {
        const list = (next as string[]).map(s => s.trim()).filter(Boolean);
        onChange(list.length > 0 ? Array.from(new Set(list)) : undefined);
      }}
      renderTags={(tags, getTagProps) =>
        tags.map((tag, index) => {
          const { key, ...rest } = getTagProps({ index });
          return (
            <Chip
              key={key}
              {...rest}
              size="small"
              label={tag}
              color={validateItem && !validateItem(tag) ? 'error' : 'default'}
            />
          );
        })
      }
      renderInput={params => (
        <TextField
          {...params}
          label={label}
          placeholder={items.length === 0 ? placeholder || t('Type and press Enter') : undefined}
          helperText={
            error ||
            (invalid.length > 0
              ? t('Invalid values: {{values}}', { values: invalid.join(', ') })
              : helperText)
          }
          error={!!error || invalid.length > 0}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {params.InputProps.endAdornment}
                <HelpTip text={help} />
              </>
            ),
          }}
        />
      )}
    />
  );
}

/** List of integers (e.g. HTTP status codes) edited as chips. */
export function NumberListInput(
  props: Omit<BaseFieldProps<number[]>, 'onChange'> & {
    onChange: (value: number[] | undefined) => void;
    suggestions?: number[];
  }
) {
  return (
    <StringListInput
      {...props}
      value={props.value?.map(String)}
      suggestions={props.suggestions?.map(String)}
      validateItem={i => /^\d+$/.test(i)}
      onChange={v => {
        const nums = (v || []).filter(i => /^\d+$/.test(i)).map(Number);
        props.onChange(nums.length > 0 ? nums : undefined);
      }}
    />
  );
}

/** Responsive grid for form fields. */
export function FieldGrid({
  children,
  columns = 2,
}: React.PropsWithChildren<{ columns?: 1 | 2 | 3 }>) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', md: `repeat(${columns}, minmax(0, 1fr))` },
        alignItems: 'start',
      }}
    >
      {children}
    </Box>
  );
}

/** Titled group of fields, optionally with a link to the upstream documentation. */
export function FormSection({
  title,
  description,
  icon,
  action,
  docsUrl,
  children,
}: React.PropsWithChildren<{
  title: string;
  description?: React.ReactNode;
  icon?: string;
  action?: React.ReactNode;
  docsUrl?: string;
}>) {
  const { t } = useText();
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: children ? 2 : 0 }}>
        {icon && (
          <Box sx={{ color: 'primary.main', mt: '2px' }}>
            <Icon icon={icon} width={20} />
          </Box>
        )}
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.4 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" component="div">
              {description}{' '}
              {docsUrl && (
                <Link href={docsUrl} target="_blank" rel="noopener noreferrer">
                  {t('Learn more')}
                </Link>
              )}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  );
}

/** A form section that can be switched on/off. */
export function ToggleSection({
  title,
  description,
  icon,
  enabled,
  onToggle,
  children,
}: React.PropsWithChildren<{
  title: string;
  description?: string;
  icon?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}>) {
  return (
    <FormSection
      title={title}
      description={description}
      icon={icon}
      action={
        <Switch
          checked={enabled}
          onChange={e => onToggle(e.target.checked)}
          inputProps={{ 'aria-label': title }}
        />
      }
    >
      <Collapse in={enabled} unmountOnExit>
        <Box>{children}</Box>
      </Collapse>
    </FormSection>
  );
}

/** Editor for arrays of objects, rendered as removable cards. */
export function ArrayEditor<T>({
  items,
  onChange,
  renderItem,
  newItem,
  addLabel,
  itemTitle,
  emptyText,
  minItems = 0,
  max,
}: {
  items: T[] | undefined;
  onChange: (items: T[] | undefined) => void;
  renderItem: (item: T, update: (next: T) => void, index: number) => React.ReactNode;
  newItem: () => T;
  addLabel: string;
  itemTitle: (item: T, index: number) => string;
  emptyText?: string;
  /** Items that cannot be removed below this count. */
  minItems?: number;
  max?: number;
}) {
  const { t } = useText();
  const list = items || [];
  const update = (index: number, next: T) => {
    const copy = [...list];
    copy[index] = next;
    onChange(copy);
  };
  const remove = (index: number) => {
    const copy = list.filter((_, i) => i !== index);
    onChange(copy.length > 0 ? copy : undefined);
  };
  return (
    <Box>
      {list.length === 0 && emptyText && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {emptyText}
        </Typography>
      )}
      {list.map((item, index) => (
        // Items have no stable identity of their own while being edited.
        // eslint-disable-next-line react/no-array-index-key
        <Paper
          key={index}
          variant="outlined"
          sx={{ p: 1.5, mb: 1.5, bgcolor: 'background.default' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {itemTitle(item, index)}
            </Typography>
            <Tooltip title={t('Remove')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => remove(index)}
                  disabled={list.length <= minItems}
                  aria-label={t('Remove')}
                >
                  <Icon icon="mdi:delete-outline" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          {renderItem(item, next => update(index, next), index)}
        </Paper>
      ))}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        disabled={max !== undefined && list.length >= max}
        onClick={() => onChange([...list, newItem()])}
      >
        {addLabel}
      </Button>
    </Box>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObject = Record<string, any>;

/**
 * Returns a binder that connects a field to a path of the edited object:
 * `<TextInput {...bind(['spec', 'foo'])} />`.
 */
export function useBinder<T extends AnyObject>(value: T, onChange: (next: T) => void) {
  return React.useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <V = any,>(path: Path) => ({
      value: getIn<V>(value, path),
      onChange: (v: V | undefined) => onChange(setIn(value, path, v)),
    }),
    [value, onChange]
  );
}

/** Tabs that split a long form into topics; every tab keeps editing the same object. */
export function FormTabs({
  tabs,
}: {
  tabs: Array<{ id: string; label: string; content: React.ReactNode }>;
}) {
  const [active, setActive] = React.useState(tabs[0]?.id);
  const current = tabs.find(tab => tab.id === active) || tabs[0];
  return (
    <Box>
      <Tabs
        value={current?.id}
        onChange={(_, v) => setActive(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map(tab => (
          <Tab key={tab.id} value={tab.id} label={tab.label} />
        ))}
      </Tabs>
      {current?.content}
    </Box>
  );
}
