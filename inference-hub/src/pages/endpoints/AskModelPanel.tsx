import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  chatCompletion,
  ChatMessage,
  isContextLengthError,
  resolveTarget,
} from '../../api/openai';
import { t } from '../../common/i18n';
import { Markdown } from '../../components/common/Markdown';
import { Diagnosis, LogSample } from '../../diagnostics/diagnose';
import { askMessages, continueMessages, diagnosisReport } from '../../diagnostics/report';
import { useCurrentCluster } from '../../hooks/useCluster';
import { usePlaygroundTargets } from '../../hooks/usePlaygroundTargets';
import { ModelEndpoint } from '../../resources/endpoint';

// Reasoning models (e.g. Qwen3) spend part of the budget on thinking before they answer.
const DEFAULT_MAX_TOKENS = 16384;
const MAX_MAX_TOKENS = 131072;

function maxTokensOf(value: string): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MAX_TOKENS) : DEFAULT_MAX_TOKENS;
}

/** The question that was sent, so that a cut-off answer can be continued with the same model. */
interface Asked<T> {
  target: T;
  messages: ChatMessage[];
}

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
  const [maxTokens, setMaxTokens] = React.useState(String(DEFAULT_MAX_TOKENS));
  const [thinking, setThinking] = React.useState(true);
  const [asked, setAsked] = React.useState<Asked<NonNullable<typeof target>> | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [reasoning, setReasoning] = React.useState('');
  const [truncated, setTruncated] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Sends `messages`; the answer is added to `prefix` (the answer so far when continuing). */
  const send = async (
    to: NonNullable<typeof target>,
    messages: ChatMessage[],
    prefix: { answer: string; reasoning: string }
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const join = (before: string, after: string) =>
      before && after ? `${before}\n\n${after}` : before || after;
    setBusy(true);
    setError(null);
    setTruncated(false);
    try {
      const resolved = await resolveTarget(cluster, to);
      const model = resolved.models.includes(to.defaultModel)
        ? to.defaultModel
        : resolved.models[0] || to.defaultModel;
      const result = await chatCompletion(
        cluster,
        resolved,
        model,
        messages,
        {
          modelDefaults: false,
          temperature: 0.2,
          topP: 1,
          maxTokens: maxTokensOf(maxTokens),
          stream: true,
          thinking,
        },
        controller.signal,
        {
          onDelta: (content, thought) => {
            setAnswer(prefix.answer + content);
            setReasoning(join(prefix.reasoning, thought));
          },
        }
      );
      setAnswer(prefix.answer + result.content);
      setReasoning(join(prefix.reasoning, result.reasoning));
      setTruncated(result.finishReason === 'length');
    } catch (err) {
      setError(controller.signal.aborted ? t('Stopped.') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ask = () => {
    if (!target) return;
    const messages = askMessages(text, question);
    setAsked({ target, messages });
    setAnswer('');
    setReasoning('');
    send(target, messages, { answer: '', reasoning: '' });
  };

  const continueAnswer = () => {
    if (!asked || !answer) return;
    send(asked.target, continueMessages(asked.messages, answer), { answer, reasoning });
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
            <TextField
              size="small"
              type="number"
              label={t('Max tokens')}
              value={maxTokens}
              onChange={e => setMaxTokens(e.target.value)}
              onBlur={() => setMaxTokens(String(maxTokensOf(maxTokens)))}
              inputProps={{ min: 1, max: MAX_MAX_TOKENS }}
              sx={{ width: 140 }}
              disabled={busy}
            />
            <Tooltip
              title={t(
                'When off, the chat template is told not to think (enable_thinking: false), so the whole token budget goes to the answer. Works with Qwen3 and other models whose template reads it.'
              )}
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={thinking}
                    onChange={e => setThinking(e.target.checked)}
                    disabled={busy}
                  />
                }
                label={t('Thinking')}
              />
            </Tooltip>
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
          {error && (
            <Alert severity="error">
              {error}
              {isContextLengthError(error) && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {t(
                    "The text and the answer do not fit in the model's context length (--max-model-len). Lower Max tokens or shorten the text."
                  )}
                </Typography>
              )}
            </Alert>
          )}
          {(answer || reasoning) && (
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
              {reasoning && (
                <details open={!answer}>
                  <summary>
                    <Typography variant="caption" color="text.secondary">
                      {t('Reasoning')}
                    </Typography>
                  </summary>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ whiteSpace: 'pre-wrap', mb: 1 }}
                  >
                    {reasoning}
                  </Typography>
                </details>
              )}
              {answer && <Markdown text={answer} />}
              {truncated && (
                <Alert
                  severity="warning"
                  sx={{ my: 1 }}
                  action={
                    answer ? (
                      <Button
                        color="inherit"
                        size="small"
                        disabled={busy}
                        startIcon={<Icon icon="mdi:play-outline" />}
                        onClick={continueAnswer}
                      >
                        {t('Continue')}
                      </Button>
                    ) : undefined
                  }
                >
                  {answer
                    ? t('The answer hit the token limit and is cut off.')
                    : t(
                        'Thinking used the whole token limit before the answer. Raise Max tokens or turn off Thinking.'
                      )}
                </Alert>
              )}
              <Typography variant="caption" color="text.secondary">
                {t('Answer of {{model}}. Check it before acting on it.', {
                  model: asked?.target.defaultModel || '',
                })}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
}
