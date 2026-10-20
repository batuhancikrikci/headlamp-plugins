import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import React, { useMemo, useState } from 'react';
import { useText } from '../../common/i18n';
import { AMAlert, AMMatcher, AMSilence, Labels } from '../../types';
import { toDatetimeLocal } from '../../utils/duration';
import { matcherOperator, matchersMatch, MatchOperator, parseMatcher } from '../../utils/matchers';
import { amCreateSilence } from '../../utils/monitoringApi';

const CREATOR_KEY = 'monitoring.silenceCreator';

function loadCreator(): string {
  try {
    return window.localStorage.getItem(CREATOR_KEY) || '';
  } catch {
    return '';
  }
}

function saveCreator(value: string) {
  try {
    window.localStorage.setItem(CREATOR_KEY, value);
  } catch {
    // Storage unavailable (private mode): the field just won't be remembered.
  }
}

interface MatcherRow {
  name: string;
  op: MatchOperator;
  value: string;
}

const OPERATORS: MatchOperator[] = ['=', '!=', '=~', '!~'];

function toRow(m: AMMatcher): MatcherRow {
  return { name: m.name, op: matcherOperator(m), value: m.value };
}

function rowToMatcher(r: MatcherRow): AMMatcher {
  return {
    name: r.name.trim(),
    value: r.value,
    isRegex: r.op === '=~' || r.op === '!~',
    isEqual: r.op === '=' || r.op === '=~',
  };
}

function validateRow(r: MatcherRow): string | null {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(r.name.trim())) return 'name';
  if (r.op === '=~' || r.op === '!~') {
    try {
      // eslint-disable-next-line no-new
      new RegExp(`^(?:${r.value})$`);
    } catch {
      return 'regex';
    }
  }
  return null;
}

const DURATION_PRESETS = [
  { label: '1h', ms: 3_600_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '4h', ms: 14_400_000 },
  { label: '12h', ms: 43_200_000 },
  { label: '1d', ms: 86_400_000 },
  { label: '7d', ms: 604_800_000 },
];

export interface SilenceDialogProps {
  open: boolean;
  onClose: () => void;
  baseUrl: string;
  /** Existing silence to edit (id kept) or recreate (id dropped when recreate=true). */
  silence?: AMSilence | null;
  recreate?: boolean;
  /** Pre-fill matchers from an alert's labels. */
  initialLabels?: Labels;
  /** Current Alertmanager alerts, used to preview what the silence affects. */
  alerts?: AMAlert[];
  onSaved?: (id: string) => void;
}

/** Create / edit / recreate an Alertmanager silence with a live preview of affected alerts. */
export default function SilenceDialog(props: SilenceDialogProps) {
  // Mount the form only while open so every opening starts from fresh state
  // (fresh "now" for the start time, cleared fields).
  if (!props.open) return null;
  return <SilenceForm {...props} />;
}

function SilenceForm({
  onClose,
  baseUrl,
  silence,
  recreate,
  initialLabels,
  alerts,
  onSaved,
}: SilenceDialogProps) {
  const { t } = useText();
  const { enqueueSnackbar } = useSnackbar();
  const editing = !!silence && !recreate;

  const [rows, setRows] = useState<MatcherRow[]>(() => {
    if (silence) return silence.matchers.map(toRow);
    if (initialLabels) {
      const preferred = ['alertname', 'namespace', 'severity', 'job', 'service', 'pod'];
      const entries = Object.entries(initialLabels).filter(([k]) => preferred.includes(k));
      const fromLabels = (entries.length ? entries : Object.entries(initialLabels)).map(
        ([name, value]) => ({
          name,
          op: '=' as MatchOperator,
          value,
        })
      );
      if (fromLabels.length) return fromLabels;
    }
    return [{ name: '', op: '=', value: '' }];
  });
  const [quick, setQuick] = useState('');
  const [startsAt, setStartsAt] = useState(() => {
    if (editing && silence && new Date(silence.startsAt).getTime() > Date.now()) {
      return toDatetimeLocal(new Date(silence.startsAt));
    }
    return toDatetimeLocal(new Date());
  });
  const [endsAt, setEndsAt] = useState(() => {
    if (editing && silence) return toDatetimeLocal(new Date(silence.endsAt));
    return toDatetimeLocal(new Date(Date.now() + 2 * 3_600_000));
  });
  const [creator, setCreator] = useState(() => silence?.createdBy || loadCreator());
  const [comment, setComment] = useState(() => silence?.comment || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const timeError =
    Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      ? t('Enter a valid start and end time.')
      : end.getTime() <= start.getTime()
      ? t('The end time must be after the start time.')
      : end.getTime() <= Date.now()
      ? t('The end time must be in the future.')
      : null;

  const rowErrors = rows.map(validateRow);
  const validRows = rows.filter((r, i) => !rowErrors[i]);
  const matchers = validRows.map(rowToMatcher);
  const allNegative = matchers.length > 0 && matchers.every(m => m.isEqual === false);
  const formError =
    matchers.length === 0
      ? t('Add at least one matcher.')
      : rowErrors.some(Boolean)
      ? t('Fix the invalid matchers.')
      : allNegative
      ? t('At least one matcher must be positive (= or =~).')
      : timeError
      ? timeError
      : !creator.trim()
      ? t('Creator is required.')
      : !comment.trim()
      ? t('Comment is required.')
      : null;

  const affected = useMemo(
    () =>
      matchers.length && !rowErrors.some(Boolean)
        ? (alerts || []).filter(a => matchersMatch(matchers, a.labels))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(matchers), alerts]
  );

  const updateRow = (i: number, patch: Partial<MatcherRow>) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addQuick = () => {
    const text = quick.trim();
    if (!text) return;
    try {
      const parsed = text
        .replace(/^\{|\}$/g, '')
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(parseMatcher)
        .map(toRow);
      setRows(prev => [...prev.filter(r => r.name || r.value), ...parsed]);
      setQuick('');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setDuration = (ms: number) => {
    const s = Number.isNaN(start.getTime()) ? new Date() : start;
    setEndsAt(toDatetimeLocal(new Date(s.getTime() + ms)));
  };

  const submit = async () => {
    setShowErrors(true);
    if (formError) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await amCreateSilence(baseUrl, {
        id: editing ? silence!.id : undefined,
        matchers,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        createdBy: creator.trim(),
        comment: comment.trim(),
      });
      saveCreator(creator.trim());
      enqueueSnackbar(editing ? t('Silence updated') : t('Silence created'), {
        variant: 'success',
      });
      onSaved?.(id);
      onClose();
    } catch (e) {
      setError((e as Error).message || t('Failed to save the silence'));
      setSubmitting(false);
    }
  };

  const title = editing
    ? t('Edit silence')
    : recreate
    ? t('Recreate silence')
    : t('Create silence');

  return (
    <Dialog
      open
      onClose={submitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="silence-dialog-title"
    >
      <DialogTitle id="silence-dialog-title">{title}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {editing && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t(
              'Alertmanager replaces the silence: the current one expires and a new one with a new ID is created.'
            )}
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('Duration')}
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label={t('Start')}
              type="datetime-local"
              fullWidth
              size="small"
              value={startsAt}
              onChange={e => setStartsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label={t('End')}
              type="datetime-local"
              fullWidth
              size="small"
              value={endsAt}
              onChange={e => setEndsAt(e.target.value)}
              InputLabelProps={{ shrink: true }}
              error={showErrors && !!timeError}
              helperText={showErrors && timeError ? timeError : ' '}
            />
          </Grid>
        </Grid>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          {DURATION_PRESETS.map(p => (
            <Button key={p.label} size="small" variant="outlined" onClick={() => setDuration(p.ms)}>
              +{p.label}
            </Button>
          ))}
        </Box>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('Matchers')}
        </Typography>
        {rows.map((row, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
            <TextField
              size="small"
              label={t('Label')}
              value={row.name}
              onChange={e => updateRow(i, { name: e.target.value })}
              error={showErrors && rowErrors[i] === 'name'}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              size="small"
              label={t('Operator')}
              value={row.op}
              onChange={e => updateRow(i, { op: e.target.value as MatchOperator })}
              sx={{ width: 110 }}
            >
              {OPERATORS.map(op => (
                <MenuItem key={op} value={op}>
                  {op}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('Value')}
              value={row.value}
              onChange={e => updateRow(i, { value: e.target.value })}
              error={showErrors && rowErrors[i] === 'regex'}
              helperText={
                showErrors && rowErrors[i] === 'regex' ? t('Invalid regular expression') : undefined
              }
              sx={{ flex: 2 }}
            />
            <Tooltip title={t('Remove matcher')}>
              <span>
                <IconButton
                  aria-label={t('Remove matcher')}
                  onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))}
                  disabled={rows.length === 1}
                >
                  <Icon icon="mdi:minus-circle-outline" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ))}
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <Button
            size="small"
            startIcon={<Icon icon="mdi:plus-circle-outline" />}
            onClick={() => setRows(prev => [...prev, { name: '', op: '=', value: '' }])}
          >
            {t('Add matcher')}
          </Button>
          <TextField
            size="small"
            fullWidth
            placeholder={t('Paste matchers, e.g. {alertname="HighCPU", namespace=~"prod.*"}')}
            value={quick}
            onChange={e => setQuick(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addQuick();
              }
            }}
            inputProps={{ 'aria-label': t('Paste matchers') }}
          />
          <Button size="small" onClick={addQuick} disabled={!quick.trim()}>
            {t('Parse')}
          </Button>
        </Box>

        <Alert severity={affected.length ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {alerts
            ? t('{{count}} currently active alert(s) match these matchers.', {
                count: affected.length,
              })
            : t('Alert preview is not available.')}
          {affected.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2, maxHeight: 120, overflow: 'auto' }}>
              {affected.slice(0, 20).map(a => (
                <li key={a.fingerprint}>
                  <Typography variant="caption">
                    {a.labels.alertname}
                    {a.labels.namespace ? ` (${a.labels.namespace})` : ''}
                    {a.labels.severity ? ` · ${a.labels.severity}` : ''}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
        </Alert>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            <TextField
              label={t('Creator')}
              fullWidth
              size="small"
              required
              value={creator}
              onChange={e => setCreator(e.target.value)}
              error={showErrors && !creator.trim()}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField
              label={t('Comment')}
              fullWidth
              size="small"
              required
              multiline
              minRows={2}
              value={comment}
              onChange={e => setComment(e.target.value)}
              error={showErrors && !comment.trim()}
            />
          </Grid>
        </Grid>
        {showErrors && formError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {formError}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {t('Cancel')}
        </Button>
        <Button variant="contained" onClick={submit} disabled={submitting}>
          {editing ? t('Update') : t('Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
