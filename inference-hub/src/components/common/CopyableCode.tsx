import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip } from '@mui/material';
import React from 'react';
import { t } from '../../common/i18n';

/** Monospace block with a copy button. */
export function CopyableCode({ code, maxHeight }: { code: string; maxHeight?: number }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <Box
      sx={{
        position: 'relative',
        bgcolor: 'action.hover',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        my: 1,
      }}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          pr: 5,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          overflow: 'auto',
          maxHeight,
        }}
      >
        {code}
      </Box>
      <Tooltip title={copied ? t('Copied') : t('Copy')}>
        <IconButton
          size="small"
          aria-label={t('Copy')}
          onClick={copy}
          sx={{ position: 'absolute', top: 4, right: 4 }}
        >
          <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={16} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
