import { Icon } from '@iconify/react';
import { Box, Paper, Typography } from '@mui/material';
import React from 'react';

export interface SummaryTile {
  id: string;
  label: string;
  value: React.ReactNode;
  icon: string;
  color?: string;
  onClick?: () => void;
  active?: boolean;
}

/** Row of KPI tiles that fills the full width; tiles with onClick act as filters. */
export function SummaryTiles({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <Box
      sx={{
        display: 'grid',
        // auto-fit stretches the tiles across the whole row instead of leaving empty tracks.
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
          aria-pressed={tile.onClick ? !!tile.active : undefined}
          sx={{
            p: 2,
            minHeight: 88,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            textAlign: 'left',
            cursor: tile.onClick ? 'pointer' : 'default',
            borderColor: tile.active ? 'primary.main' : 'divider',
            borderWidth: tile.active ? 2 : 1,
            bgcolor: 'background.paper',
            color: 'inherit',
            font: 'inherit',
          }}
        >
          <Box sx={{ color: tile.color || 'text.secondary', display: 'flex' }}>
            <Icon icon={tile.icon} width={32} />
          </Box>
          <Box>
            <Typography variant="h5" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
              {tile.value}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tile.label}
            </Typography>
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
