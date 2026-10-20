/**
 * Editors for key/value maps, label selectors and cluster claim selectors.
 */
import { Icon } from '@iconify/react';
import { Box, Button, IconButton, MenuItem, TextField, Tooltip, Typography } from '@mui/material';
import React from 'react';
import { useText } from '../../../common/i18n';
import {
  ClaimSelector,
  Labels,
  LabelSelector,
  SelectorRequirement,
} from '../../../resources/models/common';
import { isValidLabelKey, isValidLabelValue } from '../../../utils/selectors';

/**
 * Key/value editor for labels, node selectors and matchLabels. Rows are kept locally so that a
 * row with an empty key can exist while typing; only complete rows are emitted.
 */
export function KeyValueEditor({
  value,
  onChange,
  addLabel,
  keyLabel,
  valueLabel,
  keySuggestions = [],
  validateLabels = true,
}: {
  value: Labels | undefined;
  onChange: (value: Labels | undefined) => void;
  addLabel?: string;
  keyLabel?: string;
  valueLabel?: string;
  keySuggestions?: string[];
  /** Validate keys and values as Kubernetes label keys / values. */
  validateLabels?: boolean;
}) {
  const { t } = useText();
  const toRows = (v: Labels | undefined) =>
    Object.entries(v || {}).map(([k, val]) => ({ k, v: val }));
  const [rows, setRows] = React.useState(() => toRows(value));
  const lastEmitted = React.useRef(JSON.stringify(value || {}));

  // Re-sync when the value changed from outside (e.g. the YAML tab).
  React.useEffect(() => {
    const incoming = JSON.stringify(value || {});
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setRows(toRows(value));
    }
  }, [value]);

  const emit = (next: Array<{ k: string; v: string }>) => {
    setRows(next);
    const out: Labels = {};
    for (const row of next) if (row.k.trim()) out[row.k.trim()] = row.v;
    lastEmitted.current = JSON.stringify(out);
    onChange(Object.keys(out).length > 0 ? out : undefined);
  };

  const listId = React.useId();
  return (
    <Box>
      {keySuggestions.length > 0 && (
        <datalist id={listId}>
          {keySuggestions.map(k => (
            <option key={k} value={k} />
          ))}
        </datalist>
      )}
      {rows.map((row, i) => {
        const keyError = validateLabels && row.k !== '' && !isValidLabelKey(row.k);
        const valueError = validateLabels && !isValidLabelValue(row.v);
        return (
          // eslint-disable-next-line react/no-array-index-key
          <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label={keyLabel || t('Key')}
              value={row.k}
              error={keyError}
              helperText={keyError ? t('Invalid key') : undefined}
              onChange={e => emit(rows.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
              inputProps={{ list: keySuggestions.length > 0 ? listId : undefined }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              label={valueLabel || t('Value')}
              value={row.v}
              error={valueError}
              helperText={valueError ? t('Invalid value') : undefined}
              onChange={e => emit(rows.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
              sx={{ flex: 1 }}
            />
            <Tooltip title={t('Remove')}>
              <IconButton
                aria-label={t('Remove')}
                onClick={() => emit(rows.filter((_, j) => j !== i))}
              >
                <Icon icon="mdi:close" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => setRows([...rows, { k: '', v: '' }])}
      >
        {addLabel || t('Add')}
      </Button>
    </Box>
  );
}

const OPERATORS = ['In', 'NotIn', 'Exists', 'DoesNotExist'];

/** Editor for a list of selector requirements (matchExpressions). */
export function ExpressionsEditor({
  value,
  onChange,
  keyLabel,
  keySuggestions = [],
}: {
  value: SelectorRequirement[] | undefined;
  onChange: (value: SelectorRequirement[] | undefined) => void;
  keyLabel?: string;
  keySuggestions?: string[];
}) {
  const { t } = useText();
  const list = value || [];
  const listId = React.useId();
  const update = (i: number, next: SelectorRequirement) =>
    onChange(list.map((r, j) => (j === i ? next : r)));
  return (
    <Box>
      {keySuggestions.length > 0 && (
        <datalist id={listId}>
          {keySuggestions.map(k => (
            <option key={k} value={k} />
          ))}
        </datalist>
      )}
      {list.map((req, i) => {
        const needsValues = req.operator === 'In' || req.operator === 'NotIn';
        return (
          // eslint-disable-next-line react/no-array-index-key
          <Box
            key={i}
            sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}
          >
            <TextField
              size="small"
              label={keyLabel || t('Key')}
              value={req.key}
              onChange={e => update(i, { ...req, key: e.target.value })}
              inputProps={{ list: keySuggestions.length > 0 ? listId : undefined }}
              sx={{ flex: '1 1 180px' }}
            />
            <TextField
              select
              size="small"
              label={t('Operator')}
              value={req.operator}
              onChange={e => {
                const operator = e.target.value;
                const keepValues = operator === 'In' || operator === 'NotIn';
                update(i, {
                  key: req.key,
                  operator,
                  ...(keepValues ? { values: req.values || [] } : {}),
                });
              }}
              sx={{ width: 150 }}
            >
              {OPERATORS.map(op => (
                <MenuItem key={op} value={op}>
                  {op}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('Values (comma separated)')}
              value={(req.values || []).join(', ')}
              disabled={!needsValues}
              error={needsValues && (req.values || []).length === 0}
              onChange={e =>
                update(i, {
                  ...req,
                  values: e.target.value
                    .split(',')
                    .map(v => v.trim())
                    .filter(Boolean),
                })
              }
              sx={{ flex: '2 1 220px' }}
            />
            <Tooltip title={t('Remove')}>
              <IconButton
                aria-label={t('Remove')}
                onClick={() => {
                  const next = list.filter((_, j) => j !== i);
                  onChange(next.length > 0 ? next : undefined);
                }}
              >
                <Icon icon="mdi:close" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      })}
      <Button
        size="small"
        startIcon={<Icon icon="mdi:plus" />}
        onClick={() => onChange([...list, { key: '', operator: 'In', values: [] }])}
      >
        {t('Add expression')}
      </Button>
    </Box>
  );
}

/** Label selector: matchLabels plus matchExpressions. */
export function LabelSelectorEditor({
  value,
  onChange,
  keySuggestions,
  description,
}: {
  value: LabelSelector | undefined;
  onChange: (value: LabelSelector | undefined) => void;
  keySuggestions?: string[];
  description?: string;
}) {
  const { t } = useText();
  const selector = value || {};
  const set = (patch: Partial<LabelSelector>) => {
    const next: LabelSelector = { ...selector, ...patch };
    if (!next.matchLabels) delete next.matchLabels;
    if (!next.matchExpressions) delete next.matchExpressions;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <Box>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {t('Match labels')}
      </Typography>
      <KeyValueEditor
        value={selector.matchLabels}
        onChange={matchLabels => set({ matchLabels })}
        addLabel={t('Add label')}
        keySuggestions={keySuggestions}
      />
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 1.5, mb: 0.5 }}
      >
        {t('Match expressions')}
      </Typography>
      <ExpressionsEditor
        value={selector.matchExpressions}
        onChange={matchExpressions => set({ matchExpressions })}
        keySuggestions={keySuggestions}
      />
    </Box>
  );
}

/** Claim selector: expressions over the cluster claims reported in ManagedCluster status. */
export function ClaimSelectorEditor({
  value,
  onChange,
  claimSuggestions,
}: {
  value: ClaimSelector | undefined;
  onChange: (value: ClaimSelector | undefined) => void;
  claimSuggestions?: string[];
}) {
  const { t } = useText();
  return (
    <ExpressionsEditor
      value={value?.matchExpressions}
      onChange={matchExpressions => onChange(matchExpressions ? { matchExpressions } : undefined)}
      keyLabel={t('Claim')}
      keySuggestions={claimSuggestions}
    />
  );
}
