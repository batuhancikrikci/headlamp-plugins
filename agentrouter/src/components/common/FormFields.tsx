import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  Paper,
  TextField,
  TextFieldProps,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';

/** Grid of form fields with consistent spacing (2 columns on wide screens). */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2,
        alignItems: 'start',
      }}
    >
      {children}
    </Box>
  );
}

/** A full-width row inside a FieldGrid. */
export function FullRow({ children }: { children: React.ReactNode }) {
  return <Box sx={{ gridColumn: '1 / -1' }}>{children}</Box>;
}

export function TextInput(props: TextFieldProps) {
  return <TextField size="small" fullWidth variant="outlined" {...props} />;
}

/** Free-text autocomplete: suggests options but accepts any value. */
export function SuggestInput({
  label,
  value,
  onChange,
  options,
  helperText,
  required,
  loading,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; description?: string }>;
  helperText?: React.ReactNode;
  required?: boolean;
  loading?: boolean;
  placeholder?: string;
}) {
  return (
    <Autocomplete
      freeSolo
      size="small"
      loading={loading}
      options={options}
      value={value}
      inputValue={value}
      onInputChange={(_, v) => onChange(v)}
      onChange={(_, v) => onChange(typeof v === 'string' ? v : v?.value || '')}
      getOptionLabel={o => (typeof o === 'string' ? o : o.value)}
      renderOption={(props, o) => (
        <li {...props} key={o.value}>
          <Box>
            <Typography variant="body2">{o.value}</Typography>
            {o.description && (
              <Typography variant="caption" color="text.secondary">
                {o.description}
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
          helperText={helperText}
          placeholder={placeholder}
        />
      )}
    />
  );
}

/** Namespace picker backed by the cluster's namespaces (free text still allowed). */
export function NamespaceInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [namespaces] = K8s.ResourceClasses.Namespace.useList();
  return (
    <SuggestInput
      label="Namespace"
      required
      value={value}
      onChange={onChange}
      loading={namespaces === null}
      options={(namespaces || []).map(ns => ({ value: ns.metadata.name }))}
    />
  );
}

/**
 * Repeated block editor: renders one bordered card per item with a remove button and
 * an "Add" button below. `render` receives the item and an updater for it.
 */
export function RepeatedField<T>({
  items,
  onChange,
  render,
  createItem,
  addLabel,
  itemTitle,
  minItems = 0,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode;
  createItem: () => T;
  addLabel: string;
  itemTitle: (index: number) => string;
  minItems?: number;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((item, i) => (
        <Paper key={i} variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {itemTitle(i)}
            </Typography>
            {items.length > minItems && (
              <Tooltip title="Remove">
                <IconButton
                  size="small"
                  aria-label={`Remove ${itemTitle(i)}`}
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                >
                  <Icon icon="mdi:close" width={18} height={18} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          {render(
            item,
            patch => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it))),
            i
          )}
        </Paper>
      ))}
      <Box>
        <Button variant="outlined" size="small" onClick={() => onChange([...items, createItem()])}>
          + {addLabel}
        </Button>
      </Box>
    </Box>
  );
}
