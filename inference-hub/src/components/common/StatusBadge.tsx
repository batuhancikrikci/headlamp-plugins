import { Icon } from '@iconify/react';
import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';
import { HEALTH_META, HealthSummary } from '../../utils/health';

/** Colored status chip; the reason and message are shown in a tooltip. */
export function StatusBadge({
  summary,
  label,
  size = 'small',
}: {
  summary: HealthSummary;
  /** Overrides the default label of the health state. */
  label?: string;
  size?: 'small' | 'medium';
}) {
  const meta = HEALTH_META[summary.health];
  const tooltip = [summary.reason, summary.message].filter(Boolean).join(': ');
  const chip = (
    <Chip
      size={size}
      color={meta.color}
      variant={summary.health === 'ready' ? 'filled' : 'outlined'}
      icon={<Icon icon={meta.icon} width={16} />}
      label={label || t(meta.label)}
    />
  );
  return tooltip ? (
    <Tooltip title={tooltip}>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        {chip}
      </Box>
    </Tooltip>
  ) : (
    chip
  );
}

/** Health label with the reason printed next to it (detail headers). */
export function StatusLine({ summary }: { summary: HealthSummary }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <StatusBadge summary={summary} />
      {summary.health !== 'ready' && (summary.message || summary.reason) && (
        <Typography variant="body2" color="text.secondary">
          {summary.message || summary.reason}
        </Typography>
      )}
    </Box>
  );
}
