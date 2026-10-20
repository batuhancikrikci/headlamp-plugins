import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import React, { useState } from 'react';
import { useText } from '../../common/i18n';

/** Monospace block (PromQL, YAML snippets) with a copy button; follows the theme. */
export function CodeBlock({ code, maxHeight = 240 }: { code: string; maxHeight?: number }) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Box
      sx={theme => ({
        position: 'relative',
        bgcolor: alpha(theme.palette.text.primary, 0.05),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
      })}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          pr: 5,
          maxHeight,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.8125rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
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

/** Inline monospace text for table cells. */
export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="code"
      sx={{ fontFamily: 'monospace', fontSize: '0.8125rem', wordBreak: 'break-word' }}
    >
      {children}
    </Box>
  );
}
