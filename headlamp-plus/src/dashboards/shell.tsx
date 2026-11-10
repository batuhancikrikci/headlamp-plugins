/**
 * Frame of the dashboards: header with the overall status, notes on lists that could not be
 * read, the "needs attention" panel and a compact table.
 */
import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import React from 'react';
import { DashboardHeader, IssueList, Panel, ScrollArea } from '../overview/blocks';
import { Issue, sortIssues } from '../overview/clusterHealth';

export function DashboardShell({
  icon,
  title,
  subtitle,
  issues,
  pending,
  forbidden,
  failed,
  inset = false,
  children,
}: React.PropsWithChildren<{
  icon: string;
  title: string;
  subtitle: string;
  issues: Issue[];
  pending: string[];
  forbidden: string[];
  failed: string[];
  /** Inside a details page: no page padding, the inset of Headlamp's sections instead. */
  inset?: boolean;
}>) {
  return (
    <Box
      sx={
        inset
          ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2, mb: 2, px: 2 }
          : {
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 2,
              px: { xs: 1, md: 2 },
              pt: 2,
              pb: 8,
            }
      }
    >
      <DashboardHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        issues={issues}
        loading={pending.length > 0 && issues.length === 0}
      />
      {forbidden.length > 0 && (
        <Alert severity="warning" icon={<Icon icon="mdi:shield-lock-outline" />}>
          Your user is not allowed to list some resources ({forbidden.join(', ')}), so parts of this
          dashboard are incomplete.
        </Alert>
      )}
      {failed.length > 0 && (
        <Alert severity="warning">
          Could not read {failed.join(', ')}; parts of this dashboard are incomplete.
        </Alert>
      )}
      {children}
    </Box>
  );
}

export function AttentionPanel({
  issues,
  pending,
  emptyText,
}: {
  issues: Issue[];
  pending: string[];
  emptyText: string;
}) {
  const sorted = sortIssues(issues);
  const errors = issues.filter(issue => issue.level === 'error').length;
  return (
    <Panel
      title="Needs attention"
      icon="mdi:bell-alert-outline"
      action={
        issues.length > 0 && (
          <Chip size="small" color={errors > 0 ? 'error' : 'warning'} label={issues.length} />
        )
      }
    >
      <IssueList issues={sorted} objects={new Map()} pending={pending} emptyText={emptyText} />
    </Panel>
  );
}

export interface Column<T> {
  label: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
}

/** Compact table; long tables scroll inside the panel. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  maxHeight = 420,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
  maxHeight?: number;
}) {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    );
  }
  return (
    <ScrollArea maxHeight={maxHeight}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map(column => (
              <TableCell key={column.label} align={column.align} sx={{ whiteSpace: 'nowrap' }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
            <TableRow key={rowKey(row)}>
              {columns.map(column => (
                <TableCell
                  key={column.label}
                  align={column.align}
                  sx={column.align === 'right' ? { fontVariantNumeric: 'tabular-nums' } : undefined}
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
