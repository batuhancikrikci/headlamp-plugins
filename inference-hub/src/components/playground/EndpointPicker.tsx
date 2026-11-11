/**
 * Picker of the model servers the Playground and "Ask a model" talk to. The field shows the
 * chosen server with its model and health; it opens a panel with a namespace filter, a search
 * over names and models, a filter for the kind of target and "ready only".
 */
import { Icon } from '@iconify/react';
import {
  Box,
  ButtonBase,
  Chip,
  FormControlLabel,
  InputAdornment,
  List,
  ListItemButton,
  ListSubheader,
  MenuItem,
  Popover,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { ModelAvatar } from '../common/ModelAvatar';
import { StatusBadge } from '../common/StatusBadge';

export type TargetGroup = 'endpoint' | 'gateway' | 'engine';

export function groupOf(target: PlaygroundTarget): TargetGroup {
  return target.kind === 'Engine' ? 'engine' : target.kind === 'Gateway' ? 'gateway' : 'endpoint';
}

const GROUP_LABEL: Record<TargetGroup, string> = {
  endpoint: 'Model endpoints',
  gateway: 'Through a gateway',
  engine: 'vLLM engine pods',
};

export interface PickerFilter {
  namespace: string;
  search: string;
  group: TargetGroup | '';
  readyOnly: boolean;
}

/** The targets that pass the filter, in their given order. */
export function filterTargets(targets: PlaygroundTarget[], filter: PickerFilter) {
  const words = filter.search.toLowerCase().split(/\s+/).filter(Boolean);
  return targets.filter(target => {
    if (filter.namespace && target.namespace !== filter.namespace) return false;
    if (filter.group && groupOf(target) !== filter.group) return false;
    if (filter.readyOnly && target.status.health !== 'ready') return false;
    const text = `${target.namespace} ${target.label} ${target.defaultModel}`.toLowerCase();
    return words.every(word => text.includes(word));
  });
}

/** Namespaces with their number of targets, sorted by name. */
export function namespaceCounts(targets: PlaygroundTarget[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const target of targets)
    counts.set(target.namespace, (counts.get(target.namespace) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

// The namespace chosen last is kept for the next picker of the session.
let lastNamespace = '';

function TargetSummary({ target, dense }: { target: PlaygroundTarget; dense?: boolean }) {
  return (
    <>
      <ModelAvatar model={target.model} size={dense ? 24 : 28} />
      <Box sx={{ flexGrow: 1, minWidth: 0, textAlign: 'left' }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
          {target.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {target.namespace} · {target.defaultModel}
        </Typography>
      </Box>
      <StatusBadge summary={target.status} />
    </>
  );
}

export function EndpointPicker({
  targets,
  value,
  onChange,
  label = t('Endpoint'),
  disabled,
  minWidth = 280,
}: {
  targets: PlaygroundTarget[];
  value: string | null | undefined;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  minWidth?: number;
}) {
  const anchor = React.useRef<HTMLButtonElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<PickerFilter>(() => ({
    namespace: targets.some(x => x.namespace === lastNamespace) ? lastNamespace : '',
    search: '',
    group: '',
    readyOnly: false,
  }));
  const set = (patch: Partial<PickerFilter>) => setFilter(f => ({ ...f, ...patch }));
  const selected = targets.find(x => x.id === value);
  const namespaces = namespaceCounts(targets);
  const groups = (['endpoint', 'gateway', 'engine'] as TargetGroup[]).filter(g =>
    targets.some(x => groupOf(x) === g)
  );
  const shown = filterTargets(targets, filter);
  const byNamespace = filter.namespace
    ? [[filter.namespace, shown] as const]
    : groupByNamespace(shown);

  const choose = (target: PlaygroundTarget) => {
    onChange(target.id);
    setOpen(false);
  };

  return (
    <>
      <ButtonBase
        ref={anchor}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth,
          flex: 1,
          px: 1.25,
          py: 0.75,
          minHeight: 48,
          border: 1,
          borderColor: open ? 'primary.main' : 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          opacity: disabled ? 0.6 : 1,
          '&:hover': { borderColor: disabled ? 'divider' : 'text.primary' },
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            position: 'absolute',
            top: -9,
            left: 8,
            px: 0.5,
            bgcolor: 'background.paper',
            lineHeight: 1.4,
          }}
        >
          {label}
        </Typography>
        {selected ? (
          <TargetSummary target={selected} dense />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexGrow: 1, textAlign: 'left' }}
          >
            {targets.length ? t('Choose a model server') : t('No model server')}
          </Typography>
        )}
        <Icon icon="mdi:chevron-down" width={20} />
      </ButtonBase>
      <Popover
        open={open}
        anchorEl={anchor.current}
        onClose={() => setOpen(false)}
        // Typing to search right away: the search field takes the focus once the panel is open.
        TransitionProps={{ onEntered: () => search.current?.focus() }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.5,
              width: Math.max(anchor.current?.offsetWidth ?? 0, 460),
              maxWidth: 'calc(100vw - 32px)',
            },
          },
        }}
      >
        <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              select
              size="small"
              label={t('Namespace')}
              value={filter.namespace}
              onChange={e => {
                lastNamespace = e.target.value;
                set({ namespace: e.target.value });
              }}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="">
                {t('All namespaces')} ({targets.length})
              </MenuItem>
              {namespaces.map(([ns, count]) => (
                <MenuItem key={ns} value={ns}>
                  {ns} ({count})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              inputRef={search}
              fullWidth
              placeholder={t('Search name or model')}
              value={filter.search}
              onChange={e => set({ search: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter' && shown.length > 0) choose(shown[0]);
              }}
              inputProps={{ 'aria-label': t('Search name or model') }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Icon icon="mdi:magnify" width={18} />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
            {groups.length > 1 &&
              [['', t('All')] as const, ...groups.map(g => [g, t(GROUP_LABEL[g])] as const)].map(
                ([g, text]) => (
                  <Chip
                    key={g || 'all'}
                    size="small"
                    label={text}
                    color={filter.group === g ? 'primary' : 'default'}
                    variant={filter.group === g ? 'filled' : 'outlined'}
                    onClick={() => set({ group: g })}
                  />
                )
              )}
            <Box sx={{ flexGrow: 1 }} />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={filter.readyOnly}
                  onChange={e => set({ readyOnly: e.target.checked })}
                />
              }
              label={<Typography variant="body2">{t('Ready only')}</Typography>}
            />
          </Box>
        </Box>
        <List dense disablePadding sx={{ maxHeight: 380, overflowY: 'auto', pb: 1 }}>
          {shown.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2 }}>
              {t('No model server matches the filter.')}
            </Typography>
          )}
          {byNamespace.map(([ns, items]) => (
            <li key={ns}>
              <ul style={{ padding: 0 }}>
                <ListSubheader sx={{ lineHeight: '32px' }}>{ns}</ListSubheader>
                {items.map(target => (
                  <ListItemButton
                    key={target.id}
                    selected={target.id === value}
                    onClick={() => choose(target)}
                    sx={{ gap: 1.25, py: 0.75 }}
                  >
                    <TargetSummary target={target} />
                    {groupOf(target) !== 'endpoint' && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t(groupOf(target) === 'engine' ? 'vLLM pod' : 'Gateway')}
                      />
                    )}
                  </ListItemButton>
                ))}
              </ul>
            </li>
          ))}
        </List>
      </Popover>
    </>
  );
}

function groupByNamespace(targets: PlaygroundTarget[]) {
  const groups = new Map<string, PlaygroundTarget[]>();
  for (const target of targets) {
    groups.set(target.namespace, [...(groups.get(target.namespace) ?? []), target]);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}
