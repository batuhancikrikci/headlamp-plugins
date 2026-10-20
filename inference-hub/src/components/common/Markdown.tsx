import { Box, Divider, Link, Typography } from '@mui/material';
import React from 'react';
import { Block, Inline, parseMarkdown } from '../../utils/markdown';
import { CopyableCode } from './CopyableCode';

function renderInline(parts: Inline[]): React.ReactNode[] {
  return parts.map((part, i) => {
    switch (part.type) {
      case 'code':
        return (
          <Box
            key={i}
            component="code"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.85em',
              bgcolor: 'action.hover',
              px: 0.5,
              borderRadius: 0.5,
            }}
          >
            {part.text}
          </Box>
        );
      case 'bold':
        return <strong key={i}>{renderInline(part.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(part.children)}</em>;
      case 'link':
        return (
          <Link key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </Link>
        );
      default:
        return <React.Fragment key={i}>{part.text}</React.Fragment>;
    }
  });
}

function renderBlock(block: Block, i: number): React.ReactNode {
  switch (block.type) {
    case 'code':
      return <CopyableCode key={i} code={block.code} maxHeight={480} />;
    case 'heading':
      return (
        <Typography
          key={i}
          variant={block.level <= 2 ? 'subtitle1' : 'subtitle2'}
          sx={{ fontWeight: 600, mt: 1.5 }}
        >
          {renderInline(block.inline)}
        </Typography>
      );
    case 'list':
      return (
        <Box key={i} component={block.ordered ? 'ol' : 'ul'} sx={{ my: 0.5, pl: 3 }}>
          {block.items.map((item, j) => (
            <li key={j}>
              <Typography variant="body2" component="span">
                {renderInline(item)}
              </Typography>
            </li>
          ))}
        </Box>
      );
    case 'quote':
      return (
        <Box
          key={i}
          sx={{ borderLeft: 3, borderColor: 'divider', pl: 1.5, my: 1, color: 'text.secondary' }}
        >
          <Typography variant="body2">{renderInline(block.inline)}</Typography>
        </Box>
      );
    case 'table':
      return (
        <Box key={i} sx={{ overflowX: 'auto', my: 1 }}>
          <Box
            component="table"
            sx={{
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
              '& td, & th': {
                border: 1,
                borderColor: 'divider',
                px: 1,
                py: 0.5,
                textAlign: 'left',
              },
            }}
          >
            <thead>
              <tr>
                {block.header.map((cell, j) => (
                  <th key={j}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, j) => (
                    <td key={j}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      );
    case 'hr':
      return <Divider key={i} sx={{ my: 1 }} />;
    default:
      return (
        <Typography
          key={i}
          variant="body2"
          sx={{ my: 0.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {renderInline(block.inline)}
        </Typography>
      );
  }
}

/** Renders Markdown with React elements only (no HTML from the model reaches the DOM). */
export function Markdown({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseMarkdown(text), [text]);
  return <Box sx={{ '& > :first-of-type': { mt: 0 } }}>{blocks.map(renderBlock)}</Box>;
}
