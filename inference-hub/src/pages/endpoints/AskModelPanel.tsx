import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { chatCompletion, resolveTarget } from '../../api/openai';
import { t } from '../../common/i18n';
import { Markdown } from '../../components/common/Markdown';
import { Diagnosis, LogSample } from '../../diagnostics/diagnose';
import { askMessages, diagnosisReport } from '../../diagnostics/report';
import { useCurrentCluster } from '../../hooks/useCluster';
import { usePlaygroundTargets } from '../../hooks/usePlaygroundTargets';
import { ModelEndpoint } from '../../resources/endpoint';

const ASK_PARAMS = {
  modelDefaults: false,
  temperature: 0.2,
  topP: 1,
  maxTokens: 1500,
  stream: true,
};

/**
 * Sends the diagnosis to a model that runs in this cluster, through the Kubernetes service or
 * pod proxy like the Playground: the text never leaves the cluster. The user reviews (and may
 * edit) the exact text before it is sent.
 */
export function AskModelPanel({
  endpoint,
  diagnosis,
  logs,
}: {
  endpoint: ModelEndpoint;
  diagnosis: Diagnosis;
  logs?: LogSample[];
}) {
  const cluster = useCurrentCluster();
  const { targets, loading } = usePlaygroundTargets();
  const ownId = `${endpoint.slug}/${endpoint.namespace}/${endpoint.name}`;
  const candidates = React.useMemo(
    () => targets.filter(target => target.status.health === 'ready' && target.id !== ownId),
    [targets, ownId]
  );
  const [targetId, setTargetId] = React.useState('');
  const target = candidates.find(c => c.id === targetId) || candidates[0];

  const report = React.useMemo(
    () => diagnosisReport({ endpoint, logs }, diagnosis),
    [endpoint, logs, diagnosis]
  );
  const [text, setText] = React.useState(report);
  const [edited, setEdited] = React.useState(false);
  React.useEffect(() => {
    if (!edited) setText(report);
  }, [report, edited]);
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const ask = async () => {
    if (!target) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setAnswer('');
    try {
      const resolved = await resolveTarget(cluster, target);
      const model = resolved.models.includes(target.defaultModel)
        ? target.defaultModel
        : resolved.models[0] || target.defaultModel;
      const result = await chatCompletion(
        cluster,
        resolved,
        model,
        askMessages(text, question),
        ASK_PARAMS,
        controller.signal,
        { onDelta: content => setAnswer(content) }
      );
      setAnswer(result.content);
    } catch (err) {
      setError(controller.signal.aborted ? t('Stopped.') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Icon icon="mdi:robot-outline" width={22} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('Ask a model')}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'Sends the findings, the endpoint spec (env values and secrets masked) and the scanned log lines to a model running in this cluster, through the Kubernetes API proxy. Nothing leaves the cluster. Review the text before sending it.'
        )}
      </Typography>

      {!loading && candidates.length === 0 ? (
        <Alert severity="info">
          {t('No other ready model endpoint or vLLM server runs in this cluster to ask.')}
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label={t('Model')}
              value={target?.id || ''}
              onChange={e => setTargetId(e.target.value)}
              sx={{ minWidth: 280 }}
              disabled={busy || loading}
            >
              {candidates.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  {c.namespace}/{c.label} · {c.defaultModel}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label={t('Question (optional)')}
              placeholder={t('Why is this endpoint not working, and how do I fix it?')}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              sx={{ flexGrow: 1, minWidth: 280 }}
              disabled={busy}
            />
          </Box>
          <TextField
            multiline
            minRows={6}
            maxRows={16}
            label={t('Text that will be sent')}
            value={text}
            onChange={e => {
              setText(e.target.value);
              setEdited(true);
            }}
            disabled={busy}
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
            helperText={
              edited ? (
                <Button size="small" sx={{ p: 0 }} onClick={() => setEdited(false)}>
                  {t('Reset to the generated text')}
                </Button>
              ) : (
                t('{{n}} characters', { n: text.length })
              )
            }
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              disabled={busy || !target || !text.trim()}
              startIcon={busy ? <CircularProgress size={14} /> : <Icon icon="mdi:send" />}
              onClick={ask}
            >
              {t('Ask')}
            </Button>
            {busy && <Button onClick={() => abortRef.current?.abort()}>{t('Stop')}</Button>}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {answer && (
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
              <Markdown text={answer} />
              <Typography variant="caption" color="text.secondary">
                {t('Answer of {{model}}. Check it before acting on it.', {
                  model: target?.defaultModel || '',
                })}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
}
