/**
 * Presentational building blocks shared by the list, detail and overview pages.
 */
import { Icon } from '@iconify/react';
import {
  DateLabel,
  NameValueTable,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { Box, ButtonBase, Chip, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { useText } from '../../common/i18n';
import {
  ClaimSelector,
  Condition,
  conditionHealth,
  conditionPolarity,
  Health,
  LabelSelector,
} from '../../resources/models/common';
import { isSelectorEmpty, requirementText, selectorTexts } from '../../utils/selectors';

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

/** Full conditions table for detail pages; colors follow each condition type's polarity. */
export function ConditionsTable({ conditions }: { conditions?: Condition[] }) {
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
            health={conditionHealth(c, conditionPolarity(c.type))}
            label={`${c.type}: ${c.status}`}
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

/** Compact list of the conditions that are not in their healthy state (for list columns). */
export function ConditionSummary({ conditions }: { conditions?: Condition[] }) {
  const { t } = useText();
  const list = conditions || [];
  if (list.length === 0) return <>-</>;
  const bad = list.filter(c => conditionHealth(c, conditionPolarity(c.type)) === 'error');
  if (bad.length === 0) {
    return <HealthLabel health="success" label={t('{{count}} OK', { count: list.length })} />;
  }
  return (
    <HealthLabel
      health="error"
      label={bad.map(c => c.type).join(', ')}
      tooltip={bad.map(c => c.message || c.reason || c.type).join('\n')}
    />
  );
}

/** Renders strings as chips (or "-" when empty). */
export function StringArray({
  items,
  max = 8,
  monospace,
}: {
  items?: Array<string | number>;
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

/** Labels as "key=value" chips. */
export function LabelChips({ labels, max }: { labels?: Record<string, string>; max?: number }) {
  const items = Object.entries(labels || {}).map(([k, v]) => (v === '' ? k : `${k}=${v}`));
  return <StringArray items={items} max={max} monospace />;
}

/**
 * Readable label selector. An empty selector ({}) selects everything; a missing one shows
 * `nilLabel` (defaults to the empty label).
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
  return <StringArray items={selectorTexts(selector)} monospace />;
}

export function ClaimSelectorView({ selector }: { selector?: ClaimSelector | null }) {
  const items = (selector?.matchExpressions || []).map(requirementText);
  return <StringArray items={items} monospace />;
}

export function useYesNo() {
  const { t } = useText();
  return (value?: boolean, undefinedAsNo = false): string => {
    if (value === undefined && !undefinedAsNo) return '-';
    return value ? t('Yes') : t('No');
  };
}

export type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info';

export const HEALTH_TONE: Record<Health, Tone | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  unknown: 'neutral',
};

function toneSx(tone: Tone | 'neutral') {
  return (theme: Theme) =>
    tone === 'neutral'
      ? { bgcolor: theme.palette.action.hover, color: theme.palette.text.secondary }
      : { bgcolor: alpha(theme.palette[tone].main, 0.14), color: theme.palette[tone].main };
}

export function IconBadge({
  icon,
  tone,
  size = 44,
}: {
  icon: React.ComponentProps<typeof Icon>['icon'];
  tone: Tone | 'neutral';
  size?: number;
}) {
  return (
    <Box
      sx={[
        {
          width: size,
          height: size,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        toneSx(tone),
      ]}
    >
      <Icon icon={icon} width={size * 0.55} height={size * 0.55} />
    </Box>
  );
}

/** Card with a titled header; the building block of the dashboard and summaries. */
export function Panel({
  title,
  icon,
  action,
  children,
}: React.PropsWithChildren<{ title: string; icon: string; action?: React.ReactNode }>) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2.5, borderRadius: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ color: 'text.secondary', display: 'flex' }}>
          <Icon icon={icon} width={20} />
        </Box>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>{children}</Box>
    </Paper>
  );
}

/** Thin progress bar; `tone` colors the filled part. */
export function Bar({
  value,
  total,
  tone,
}: {
  value: number;
  total: number;
  tone: Tone | 'neutral';
}) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <Box
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}
    >
      <Box
        sx={{
          width: `${ratio * 100}%`,
          height: '100%',
          borderRadius: 3,
          bgcolor: tone === 'neutral' ? 'text.disabled' : `${tone}.main`,
        }}
      />
    </Box>
  );
}

export interface Segment {
  id: string;
  label: string;
  value: number;
  /** Theme color token, e.g. "success.main". */
  color: string;
}

/** Stacked horizontal bar with a legend: distribution of a total over states. */
export function StackedBar({ segments, height = 10 }: { segments: Segment[]; height?: number }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  return (
    <Box>
      <Box
        role="img"
        aria-label={segments.map(s => `${s.label}: ${s.value}`).join(', ')}
        sx={{
          display: 'flex',
          height,
          borderRadius: height / 2,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        {total > 0 &&
          segments
            .filter(s => s.value > 0)
            .map(s => (
              <Tooltip key={s.id} title={`${s.label}: ${s.value}`}>
                <Box sx={{ width: `${(s.value / total) * 100}%`, bgcolor: s.color }} />
              </Tooltip>
            ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1.25 }}>
        {segments.map(s => (
          <LegendDot key={s.id} color={s.color} label={s.label} value={s.value} />
        ))}
      </Box>
    </Box>
  );
}

export function LegendDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
      <Typography variant="body2" color="text.secondary">
        {label}{' '}
        <Box component="strong" sx={{ color: 'text.primary' }}>
          {value}
        </Box>
      </Typography>
    </Box>
  );
}

export interface Stat {
  id: string;
  label: string;
  value: React.ReactNode;
  caption: React.ReactNode;
  icon: string;
  tone: Tone;
  to?: string;
}

/** KPI card; clickable when `to` is set. */
export function StatCard({ stat }: { stat: Stat }) {
  const history = useHistory();
  const content = (
    <>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {stat.label}
        </Typography>
        <Typography variant="h4" component="div" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
          {stat.value}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {stat.caption}
        </Typography>
      </Box>
      <IconBadge icon={stat.icon} tone={stat.tone} />
    </>
  );
  const sx = {
    p: 2,
    borderRadius: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    width: '100%',
    textAlign: 'left' as const,
    border: '1px solid',
    borderColor: 'divider',
    bgcolor: 'background.paper',
  };
  if (!stat.to) return <Box sx={sx}>{content}</Box>;
  const to = stat.to;
  return (
    <ButtonBase
      onClick={() => history.push(to)}
      sx={{
        ...sx,
        transition: 'border-color 120ms',
        '&:hover, &:focus-visible': { borderColor: 'primary.main' },
      }}
    >
      {content}
    </ButtonBase>
  );
}

/** Scrollable region for long lists inside a panel. */
export function ScrollArea({
  maxHeight,
  children,
}: React.PropsWithChildren<{ maxHeight: number }>) {
  return (
    <Box
      // Keyboard users must be able to scroll the region.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      sx={{ maxHeight, overflowY: 'auto', pr: 1, mr: -1 }}
    >
      {children}
    </Box>
  );
}

/** Two-column responsive grid. */
export function TwoColumns({ children }: React.PropsWithChildren<unknown>) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
        gap: 2,
        alignItems: 'stretch',
      }}
    >
      {children}
    </Box>
  );
}
