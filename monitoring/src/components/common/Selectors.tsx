import { Box, Chip, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../common/i18n';
import { Labels, LabelSelector, MonitorNamespaceSelector } from '../../types';
import { isSelectorEmpty, NilSelectorMeaning, selectorToString } from '../../utils/selectors';

const wrapSx = {
  height: 'auto',
  maxWidth: '100%',
  '& .MuiChip-label': { display: 'block', whiteSpace: 'normal', wordBreak: 'break-word' },
};

/** A list of plain strings rendered as chips (e.g. groupBy, targetLabels). */
export function TagList({
  items,
  emptyText = '-',
}: {
  items?: string[] | null;
  emptyText?: string;
}) {
  if (!items || items.length === 0) {
    return <Typography variant="body2">{emptyText}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {items.map(item => (
        <Chip key={item} label={item} size="small" variant="outlined" sx={wrapSx} />
      ))}
    </Box>
  );
}

export function LabelChips({
  labels,
  emptyText = '-',
  highlight,
}: {
  labels?: Labels | null;
  emptyText?: string;
  /** Keys rendered with the primary color (e.g. labels required by a selector). */
  highlight?: string[];
}) {
  const entries = Object.entries(labels || {});
  if (entries.length === 0) {
    return <Typography variant="body2">{emptyText}</Typography>;
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {entries.map(([k, v]) => (
        <Chip
          key={k}
          label={`${k}=${v}`}
          size="small"
          variant="outlined"
          color={highlight?.includes(k) ? 'primary' : 'default'}
          sx={wrapSx}
        />
      ))}
    </Box>
  );
}

/**
 * Renders a Kubernetes label selector. The meaning of a missing selector depends
 * on the field, so callers must say what nil means ('all' or 'none').
 */
export function SelectorDisplay({
  selector,
  nilMeaning,
}: {
  selector?: LabelSelector | null;
  nilMeaning: NilSelectorMeaning;
}) {
  const { t } = useText();
  if (selector === null || selector === undefined) {
    return (
      <Typography variant="body2" color="text.secondary">
        {nilMeaning === 'all' ? t('Not set (matches everything)') : t('Not set (matches nothing)')}
      </Typography>
    );
  }
  if (isSelectorEmpty(selector)) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('Empty selector (matches everything)')}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {Object.entries(selector.matchLabels || {}).map(([k, v]) => (
        <Chip key={`l-${k}`} label={`${k}=${v}`} size="small" variant="outlined" sx={wrapSx} />
      ))}
      {(selector.matchExpressions || []).map((expr, i) => (
        <Chip
          key={`e-${i}`}
          label={selectorToString({ matchExpressions: [expr] })}
          size="small"
          variant="outlined"
          color="primary"
          sx={wrapSx}
        />
      ))}
    </Box>
  );
}

/** Compact selector for table cells: first chips + tooltip with the full selector. */
export function SelectorSummary({ selector }: { selector?: LabelSelector | null }) {
  const { t } = useText();
  const text = selectorToString(selector);
  if (!text) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('All')}
      </Typography>
    );
  }
  const parts = text.split(', ');
  const shown = parts.slice(0, 2);
  return (
    <Tooltip title={text}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxWidth: 320 }}>
        {shown.map(p => (
          <Chip key={p} label={p} size="small" variant="outlined" sx={wrapSx} />
        ))}
        {parts.length > shown.length && (
          <Chip size="small" label={`+${parts.length - shown.length}`} />
        )}
      </Box>
    </Tooltip>
  );
}

/** ServiceMonitor/PodMonitor/Probe namespaceSelector. */
export function MonitorNamespaceSelectorDisplay({
  selector,
  ownNamespace,
}: {
  selector?: MonitorNamespaceSelector;
  ownNamespace?: string;
}) {
  const { t } = useText();
  if (selector?.any) {
    return <Typography variant="body2">{t('All namespaces')}</Typography>;
  }
  if (selector?.matchNames && selector.matchNames.length > 0) {
    return <TagList items={selector.matchNames} />;
  }
  return (
    <Typography variant="body2">
      {t('Only its own namespace ({{nsName}})', { nsName: ownNamespace || '-' })}
    </Typography>
  );
}

/** Prometheus-style namespace selector (LabelSelector) where nil means "own namespace". */
export function WorkloadNamespaceSelectorDisplay({
  selector,
  ownNamespace,
}: {
  selector?: LabelSelector | null;
  ownNamespace?: string;
}) {
  const { t } = useText();
  if (selector === null || selector === undefined) {
    return (
      <Typography variant="body2">
        {t('Only its own namespace ({{nsName}})', { nsName: ownNamespace || '-' })}
      </Typography>
    );
  }
  if (isSelectorEmpty(selector)) {
    return <Typography variant="body2">{t('All namespaces')}</Typography>;
  }
  return <SelectorDisplay selector={selector} nilMeaning="all" />;
}
