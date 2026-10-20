import { Box, Tooltip, Typography } from '@mui/material';
import React from 'react';

/**
 * Horizontal bar for "used of total". The fill turns warning at 90% so saturation stands out;
 * the numbers are always printed, so color is never the only signal.
 */
export function UsageBar({
  used,
  total,
  label,
  tooltip,
  width = 160,
  unit = '',
}: {
  used: number;
  total: number;
  label?: string;
  tooltip?: React.ReactNode;
  /** Bar width, or 'fill' to use the whole row next to the label. */
  width?: number | string;
  unit?: string;
}) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const color = ratio >= 0.9 ? 'warning.main' : 'primary.main';
  const text = label ?? `${formatNumber(used)} / ${formatNumber(total)}${unit}`;
  const bar = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Box
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-label={text}
        sx={{
          // "fill" stretches the bar over the row, leaving room for the label.
          ...(width === 'fill' ? { flex: 1, minWidth: 0 } : { width, flexShrink: 0 }),
          height: 8,
          borderRadius: 4,
          bgcolor: 'action.selected',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ width: `${ratio * 100}%`, height: '100%', bgcolor: color, borderRadius: 4 }} />
      </Box>
      <Typography variant="body2" noWrap>
        {text}
      </Typography>
    </Box>
  );
  return tooltip ? <Tooltip title={tooltip}>{bar}</Tooltip> : bar;
}

export function formatNumber(n: number): string {
  if (!isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
