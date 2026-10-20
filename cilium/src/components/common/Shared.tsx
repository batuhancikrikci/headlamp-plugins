/**
 * Small presentational building blocks shared by the list and detail views.
 */
import { Icon } from '@iconify/react';
import {
  DateLabel,
  NameValueTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { Condition, Health, LabelSelector } from '../../resources/types';
import { isSelectorEmpty } from '../../utils/selectors';

const HEALTH_TO_STATUS: Record<Health, 'success' | 'warning' | 'error' | ''> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: '',
};

/** Status label colored by health, with an optional explanation on hover. */
export function HealthLabel({
  health,
  label,
  tooltip,
}: {
  health: Health;
  label: React.ReactNode;
  tooltip?: string;
}) {
  const content = <StatusLabel status={HEALTH_TO_STATUS[health]}>{label}</StatusLabel>;
  if (!tooltip) return content;
  return (
    <Tooltip title={tooltip}>
      <span>{content}</span>
    </Tooltip>
  );
}

export type ConditionPolarity = 'positive' | 'problem';

/**
 * Health of a single condition. Most Kubernetes conditions are positive ("Ready=True" is good);
 * the BGP resources report problems ("MissingPeerConfigs=True" is bad).
 */
export function conditionHealth(condition: Condition, polarity: ConditionPolarity): Health {
  if (condition.status === 'Unknown') return 'unknown';
  const isTrue = condition.status === 'True';
  if (polarity === 'problem') return isTrue ? 'error' : 'success';
  return isTrue ? 'success' : 'error';
}

/** Renders a full conditions table for detail pages. */
export function ConditionsTable({
  conditions,
  polarity = 'positive',
}: {
  conditions?: Condition[];
  polarity?: ConditionPolarity;
}) {
  const { t } = useText();
  if (!conditions || conditions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('No conditions reported.')}
      </Typography>
    );
  }
  return (
    <NameValueTable
      rows={conditions.map(c => ({
        name: (
          <HealthLabel
            health={conditionHealth(c, polarity)}
            label={c.status === 'True' ? c.type : `${c.type}: ${c.status}`}
          />
        ),
        value: (
          <Box>
            {c.reason && (
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {c.reason}
              </Typography>
            )}
            {c.message && (
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                {c.message}
              </Typography>
            )}
            {c.lastTransitionTime && <DateLabel date={c.lastTransitionTime} format="mini" />}
          </Box>
        ),
      }))}
    />
  );
}

/** Renders an array of strings as chips (or "-" when empty). */
export function StringArray({
  items,
  max = 8,
  monospace,
}: {
  items?: Array<string | number>;
  /** Number of chips shown before the rest collapses into "+n". */
  max?: number;
  monospace?: boolean;
}) {
  if (!items || items.length === 0) return <>-</>;
  const shown = items.slice(0, max);
  const hidden = items.slice(max);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
      {shown.map((item, i) => (
        <Chip
          // Lists such as CIDRs may legitimately contain duplicates.
          // eslint-disable-next-line react/no-array-index-key
          key={`${item}-${i}`}
          label={String(item)}
          size="small"
          variant="outlined"
          sx={monospace ? { fontFamily: 'monospace' } : undefined}
        />
      ))}
      {hidden.length > 0 && (
        <Tooltip title={hidden.join(', ')}>
          <Typography variant="caption" color="text.secondary">
            +{hidden.length}
          </Typography>
        </Tooltip>
      )}
    </Box>
  );
}

/**
 * Readable label selector: one chip per requirement.
 *
 * @param emptyLabel - shown for an empty selector ({}), which selects everything.
 * @param nilLabel - shown when the selector is missing; defaults to `emptyLabel`.
 */
export function SelectorView({
  selector,
  emptyLabel,
  nilLabel,
}: {
  selector?: LabelSelector | null;
  emptyLabel?: string;
  nilLabel?: string;
}) {
  const { t } = useText();
  if (selector === undefined || selector === null) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        {nilLabel ?? emptyLabel ?? t('All')}
      </Typography>
    );
  }
  if (isSelectorEmpty(selector)) {
    return (
      <Chip
        size="small"
        variant="outlined"
        icon={<Icon icon="mdi:asterisk" width={14} />}
        label={emptyLabel ?? t('All')}
      />
    );
  }
  const chips: string[] = Object.entries(selector.matchLabels || {}).map(([k, v]) =>
    v === '' ? k : `${k}=${v}`
  );
  for (const req of selector.matchExpressions || []) {
    const values = (req.values || []).join(', ');
    if (req.operator === 'Exists') chips.push(req.key);
    else if (req.operator === 'DoesNotExist') chips.push(`!${req.key}`);
    else chips.push(`${req.key} ${req.operator === 'In' ? 'in' : 'not in'} (${values})`);
  }
  return <StringArray items={chips} monospace />;
}

export interface Feature {
  id: string;
  label: string;
  icon: string;
  color?: 'primary' | 'error' | 'warning' | 'default';
}

/** Renders the enabled features of a resource as icon chips. */
export function FeatureChips({ features }: { features: Feature[] }) {
  if (features.length === 0) return <>-</>;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {features.map(f => (
        <Chip
          key={f.id}
          size="small"
          color={f.color || 'primary'}
          variant="outlined"
          icon={<Icon icon={f.icon} width={16} />}
          label={f.label}
        />
      ))}
    </Box>
  );
}

export function DeprecatedChip({ note }: { note?: string }) {
  const { t } = useText();
  return (
    <Tooltip title={note || t('This API is deprecated.')}>
      <Chip
        size="small"
        color="warning"
        variant="outlined"
        icon={<Icon icon="mdi:alert-outline" width={16} />}
        label={t('Deprecated')}
      />
    </Tooltip>
  );
}

/** Translates a boolean to Yes/No, keeping "-" for undefined values. */
export function useYesNo() {
  const { t } = useText();
  return (value?: boolean, undefinedAsNo = false): string => {
    if (value === undefined && !undefinedAsNo) return '-';
    return value ? t('Yes') : t('No');
  };
}

export interface SummaryTile {
  id: string;
  label: string;
  value: React.ReactNode;
  icon: string;
  /** Theme color token, e.g. "success.main". */
  color?: string;
  caption?: React.ReactNode;
  onClick?: () => void;
}

/** Row of KPI tiles that fills the full width. */
export function SummaryTiles({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <Box
      sx={{
        display: 'grid',
        // auto-fit stretches the tiles across the whole row instead of leaving empty tracks.
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 2,
        mb: 2,
      }}
    >
      {tiles.map(tile => (
        <Paper
          key={tile.id}
          variant="outlined"
          component={tile.onClick ? 'button' : 'div'}
          onClick={tile.onClick}
          sx={{
            p: 2,
            minHeight: 88,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            textAlign: 'left',
            cursor: tile.onClick ? 'pointer' : 'default',
            bgcolor: 'background.paper',
            color: 'inherit',
            font: 'inherit',
            '&:hover': tile.onClick ? { borderColor: 'primary.main' } : undefined,
          }}
        >
          <Box sx={{ color: tile.color || 'text.secondary', display: 'flex' }}>
            <Icon icon={tile.icon} width={32} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="div" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
              {tile.value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tile.label}
            </Typography>
            {tile.caption && (
              <Typography variant="caption" color="text.secondary" component="div">
                {tile.caption}
              </Typography>
            )}
          </Box>
        </Paper>
      ))}
    </Box>
  );
}

/** Horizontal usage bar with a "used / total" caption. */
export function UsageBar({ used, total }: { used?: number; total?: number }) {
  if (used === undefined || total === undefined || total <= 0) return <>-</>;
  const ratio = Math.min(1, used / total);
  const color = ratio >= 1 ? 'error.main' : ratio >= 0.8 ? 'warning.main' : 'success.main';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
      <Box
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        sx={{
          flexGrow: 1,
          height: 8,
          borderRadius: 4,
          bgcolor: 'action.hover',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ width: `${ratio * 100}%`, height: '100%', bgcolor: color }} />
      </Box>
      <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
        {used} / {total}
      </Typography>
    </Box>
  );
}
