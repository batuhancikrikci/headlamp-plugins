import { Icon } from '@iconify/react';
import { Box, IconButton, Tooltip } from '@mui/material';
import React from 'react';

/** Read-only, monospaced block with a copy button; used for commands and YAML snippets. */
export function CodeBlock({ code, maxHeight }: { code: string; maxHeight?: number | string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <Box
      sx={theme => ({
        position: 'relative',
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
      })}
    >
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          pr: 6,
          overflow: 'auto',
          maxHeight,
          fontFamily: 'monospace',
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          whiteSpace: 'pre',
        }}
      >
        {code}
      </Box>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton
          size="small"
          aria-label="Copy to clipboard"
          onClick={copy}
          sx={{ position: 'absolute', top: 4, right: 4 }}
        >
          <Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
