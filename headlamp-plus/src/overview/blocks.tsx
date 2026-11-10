/**
 * Building blocks shared by the overview dashboards (cluster, workloads): icon badges, panels,
 * KPI tiles, bars, the header and the "needs attention" list. They follow the card layout the
 * other plugins of this repository use for their overview pages.
 */
import { Icon } from '@iconify/react';
import { Link } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/K8s/cluster';
import { Box, ButtonBase, Chip, Paper, Tooltip, Typography } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Issue } from './clusterHealth';

export type Tone = 'primary' | 'success' | 'warning' | 'error' | 'info';

/** Most issues shown in the panel; the header still reports the full count. */
export const MAX_ISSUES = 50;

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** Soft background and matching foreground for an icon badge. */
export function toneSx(tone: Tone | 'neutral') {
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
  icon: string;
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
      <Icon icon={icon} width={size * 0.55} height={size * 0.55} aria-hidden />
    </Box>
  );
}

/** Card with a titled header; the building block of the dashboard. */
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
          <Icon icon={icon} width={20} aria-hidden />
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

export const cardGrid = (min: number) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  gap: 2,
});

export const twoColumns = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' },
  gap: 2,
  alignItems: 'stretch',
};

export const rowSx = {
  py: 1.25,
  borderBottom: '1px solid',
  borderColor: 'divider',
  '&:last-child': { borderBottom: 'none' },
};

/** Page container: one column that may shrink below its content, so wide rows wrap instead of
 * overflowing; bottom padding keeps the last table clear of the window edge. */
export const pageSx = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 2,
  px: { xs: 1, md: 2 },
  pt: 2,
  pb: 8,
};

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function isForbidden(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 403;
}

// ---------------------------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------------------------

/** Page header: icon, title with optional chips, a summary line and the overall status. */
export function DashboardHeader({
  icon,
  title,
  chips,
  subtitle,
  issues,
  loading,
  children,
}: React.PropsWithChildren<{
  icon: string;
  title: string;
  chips?: React.ReactNode;
  subtitle: string;
  issues: Issue[];
  loading: boolean;
}>) {
  const errors = issues.filter(issue => issue.level === 'error').length;
  const warnings = issues.length - errors;
  const tone: Tone = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'success';
  const status = loading
    ? 'Loading…'
    : issues.length === 0
    ? 'Healthy'
    : [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : '']
        .filter(Boolean)
        .join(' · ');

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        background: theme =>
          `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(
            theme.palette.primary.main,
            0
          )} 60%)`,
      }}
    >
      <IconBadge icon={icon} tone="primary" size={56} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }} noWrap>
            {title}
          </Typography>
          {chips}
        </Box>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
      {children}
      <Chip
        icon={
          <Icon
            icon={
              loading
                ? 'mdi:progress-clock'
                : issues.length === 0
                ? 'mdi:check-circle'
                : 'mdi:alert-circle'
            }
            width={18}
          />
        }
        label={status}
        color={loading ? 'default' : tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    </Paper>
  );
}

// ---------------------------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------------------------

export interface Stat {
  id: string;
  label: string;
  value: React.ReactNode;
  caption: string;
  icon: string;
  tone: Tone;
  to?: string;
}

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
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
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
    boxSizing: 'border-box' as const,
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

export function percent(used: number, total: number): string {
  return total > 0 ? `${Math.round((used / total) * 100)}%` : '—';
}

// ---------------------------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------------------------

export function IssueList({
  issues,
  objects,
  pending,
  emptyText,
}: {
  issues: Issue[];
  objects: Map<string, KubeObject>;
  /** Labels of the lists that are still loading; issues found so far are shown meanwhile. */
  pending: string[];
  emptyText: string;
}) {
  if (issues.length === 0 && pending.length > 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading {pending.join(', ')}…
      </Typography>
    );
  }
  if (issues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
        <IconBadge icon="mdi:check-circle-outline" tone="success" />
        <Box>
          <Typography variant="subtitle2">Nothing needs attention</Typography>
          <Typography variant="body2" color="text.secondary">
            {emptyText}
          </Typography>
        </Box>
      </Box>
    );
  }
  return (
    <ScrollArea maxHeight={360}>
      {issues.slice(0, MAX_ISSUES).map((issue, index) => {
        const error = issue.level === 'error';
        const object = issue.uid ? objects.get(issue.uid) : undefined;
        return (
          <Box key={index} sx={{ display: 'flex', gap: 1.5, ...rowSx }}>
            <Tooltip title={error ? 'Error' : 'Warning'}>
              <Box
                sx={{ color: error ? 'error.main' : 'warning.main', display: 'flex', mt: '2px' }}
              >
                <Icon icon={error ? 'mdi:alert-circle' : 'mdi:alert'} width={20} />
              </Box>
            </Tooltip>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                  {issue.kind}
                </Typography>
                {object ? (
                  <Link kubeObject={object} />
                ) : (
                  <Typography variant="body2">{issue.name}</Typography>
                )}
                {issue.namespace && (
                  <Typography variant="caption" color="text.secondary">
                    {issue.namespace}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {issue.title}
                </Typography>
              </Box>
              {issue.detail && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
                  {issue.detail}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
      {pending.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ pt: 1 }}>
          Still loading {pending.join(', ')}…
        </Typography>
      )}
      {issues.length > MAX_ISSUES && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ pt: 1 }}>
          Showing the first {MAX_ISSUES} of {issues.length}.
        </Typography>
      )}
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------------------------
// Health of one kind
// ---------------------------------------------------------------------------------------------

/** Clickable row: how many objects of a kind are healthy, with a bar. */
export function HealthRow({
  label,
  icon,
  to,
  loaded,
  healthy,
  total,
  caption,
  unit = 'ready',
}: {
  label: string;
  icon: string;
  to: string;
  /** False while the list is loading or unavailable. */
  loaded: boolean;
  healthy: number;
  total: number;
  /** Extra detail after the count, e.g. "2 suspended". */
  caption?: string;
  /** Word after the count: "3/4 ready". */
  unit?: string;
}) {
  const history = useHistory();
  const tone: Tone | 'neutral' =
    !loaded || total === 0 ? 'neutral' : healthy === total ? 'success' : 'warning';
  return (
    <ButtonBase
      onClick={() => history.push(to)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        textAlign: 'left',
        borderRadius: 1,
        px: 1,
        mx: -1,
        py: 1,
        '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
      }}
    >
      <IconBadge icon={icon} tone={tone} size={36} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {label}
          </Typography>
          {caption && (
            <Typography variant="caption" color="text.secondary">
              {caption}
            </Typography>
          )}
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {!loaded ? '—' : total === 0 ? 'None' : `${healthy}/${total} ${unit}`}
          </Typography>
        </Box>
        <Bar value={healthy} total={total} tone={tone} />
      </Box>
      <Icon icon="mdi:chevron-right" width={20} aria-hidden />
    </ButtonBase>
  );
}
