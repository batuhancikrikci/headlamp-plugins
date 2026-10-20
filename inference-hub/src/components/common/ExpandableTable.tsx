import { Icon } from '@iconify/react';
import {
  Box,
  Collapse,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
} from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';

export interface ExpandableColumn<T> {
  id: string;
  header: string;
  /** Value used for sorting (and shown when there is no `render`). */
  value: (row: T) => string | number | undefined;
  render?: (row: T) => React.ReactNode;
  /** CSS width, e.g. "30%" or 120. */
  width?: string | number;
}

/**
 * Table whose rows expand into a full-width detail panel below them. Headlamp's Table does not
 * render MRT detail panels (and misaligns its grid when the expand column is added), so tables
 * with details use this one.
 */
export function ExpandableTable<T>({
  rows,
  columns,
  getRowId,
  renderDetail,
  emptyMessage,
  defaultSort,
}: {
  rows: T[];
  columns: ExpandableColumn<T>[];
  getRowId: (row: T) => string;
  renderDetail: (row: T) => React.ReactNode;
  emptyMessage?: string;
  defaultSort?: { id: string; desc?: boolean };
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [sort, setSort] = React.useState<{ id: string; desc: boolean }>({
    id: defaultSort?.id || columns[0]?.id || '',
    desc: !!defaultSort?.desc,
  });

  const sorted = React.useMemo(() => {
    const column = columns.find(c => c.id === sort.id);
    if (!column) return rows;
    const dir = sort.desc ? -1 : 1;
    return [...rows].sort((a, b) => {
      const va = column.value(a);
      const vb = column.value(b);
      if (va === vb) return 0;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {emptyMessage || t('No data to be shown.')}
        </Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox" />
            {columns.map(c => (
              <TableCell
                key={c.id}
                sx={{ fontWeight: 600, width: c.width }}
                sortDirection={sort.id === c.id ? (sort.desc ? 'desc' : 'asc') : false}
              >
                <TableSortLabel
                  active={sort.id === c.id}
                  direction={sort.id === c.id && sort.desc ? 'desc' : 'asc'}
                  onClick={() =>
                    setSort(s => ({ id: c.id, desc: s.id === c.id ? !s.desc : false }))
                  }
                >
                  {c.header}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map(row => {
            const id = getRowId(row);
            const open = expanded.has(id);
            const detailId = `ih-detail-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            return (
              <React.Fragment key={id}>
                <TableRow hover sx={{ '& > td': { borderBottom: open ? 'none' : undefined } }}>
                  <TableCell padding="checkbox">
                    <IconButton
                      size="small"
                      aria-label={open ? t('Collapse details') : t('Expand details')}
                      aria-expanded={open}
                      aria-controls={detailId}
                      onClick={() => toggle(id)}
                    >
                      <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
                    </IconButton>
                  </TableCell>
                  {columns.map(c => (
                    <TableCell key={c.id}>
                      {c.render ? c.render(row) : c.value(row) ?? '—'}
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 1}
                    sx={{ py: 0, borderBottom: open ? undefined : 'none' }}
                  >
                    <Collapse in={open} timeout="auto" unmountOnExit>
                      <Box id={detailId} sx={{ py: 1.5 }}>
                        {renderDetail(row)}
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
