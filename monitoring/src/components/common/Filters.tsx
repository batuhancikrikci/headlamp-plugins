import { Icon } from '@iconify/react';
import { Box, Chip, InputAdornment, TextField } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

/** Toggleable chip group; an empty selection means "all". */
export function ChipFilter({
  options,
  selected,
  onChange,
  ariaLabel,
}: {
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
}) {
  return (
    <Box role="group" aria-label={ariaLabel} sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = selected.includes(o.value);
        return (
          <Chip
            key={o.value}
            size="small"
            clickable
            color={active ? 'primary' : 'default'}
            variant={active ? 'filled' : 'outlined'}
            label={o.count !== undefined ? `${o.label} (${o.count})` : o.label}
            onClick={() =>
              onChange(active ? selected.filter(v => v !== o.value) : [...selected, o.value])
            }
            aria-pressed={active}
          />
        );
      })}
    </Box>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useText();
  return (
    <TextField
      size="small"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || t('Search')}
      inputProps={{ 'aria-label': placeholder || t('Search') }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <Icon icon="mdi:magnify" />
          </InputAdornment>
        ),
      }}
      sx={{ minWidth: 260 }}
    />
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mb: 2 }}>
      {children}
    </Box>
  );
}

/** Case-insensitive "any field contains" helper for client-side search. */
export function textMatches(query: string, ...fields: Array<string | undefined | null>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some(f => (f || '').toLowerCase().includes(q));
}
