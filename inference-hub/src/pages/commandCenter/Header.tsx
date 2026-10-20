import { Icon } from '@iconify/react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import React from 'react';
import { t } from '../../common/i18n';
import { INFERENCE_HUB_ICON } from '../../icons';
import { PlatformStatus } from './overview';

/**
 * Banner of the Command Center: product identity, a one-line summary, the overall status and the
 * page actions.
 */
export function Header({
  summary,
  status,
  actions,
}: {
  summary: string;
  status: PlatformStatus;
  actions?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        mb: 2,
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
      <Box
        sx={{
          width: 56,
          height: 56,
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'primary.main',
          bgcolor: theme => alpha(theme.palette.primary.main, 0.14),
        }}
      >
        <Icon icon={INFERENCE_HUB_ICON} width={31} height={31} />
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Inference Hub
          </Typography>
          <Chip label={t('Command Center')} size="small" color="primary" />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {summary}
        </Typography>
      </Box>
      <Chip
        icon={
          <Icon
            icon={status.tone === 'success' ? 'mdi:check-circle' : 'mdi:alert-circle'}
            width={18}
          />
        }
        label={status.label}
        color={status.tone}
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
      {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{actions}</Box>}
    </Paper>
  );
}
