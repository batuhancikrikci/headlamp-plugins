import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { chatCompletion, isContextLengthError, resolveTarget } from '../../api/openai';
import { t } from '../../common/i18n';
import { Markdown } from '../../components/common/Markdown';
import { EndpointPicker } from '../../components/playground/EndpointPicker';
import { GatewayAccess } from '../../components/playground/GatewayAccess';
import { Diagnosis, LogSample } from '../../diagnostics/diagnose';
import {
  AskTurn,
  conversationMessages,
  DEFAULT_QUESTION,
  diagnosisReport,
} from '../../diagnostics/report';
import { useCurrentCluster } from '../../hooks/useCluster';
import { endpointIdOf, usePlaygroundTargets } from '../../hooks/usePlaygroundTargets';
import { ModelEndpoint } from '../../resources/endpoint';

// Reasoning models (e.g. Qwen3) spend part of the budget on thinking before they answer.
const DEFAULT_MAX_TOKENS = 16384;
const MAX_MAX_TOKENS = 131072;

function maxTokensOf(value: string): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MAX_TOKENS) : DEFAULT_MAX_TOKENS;
}

interface Turn extends AskTurn {
  reasoning: string;
  /** The answer hit the token limit, or was stopped or failed partway; it can be continued. */
  cutOff?: 'length' | 'interrupted';
}

/** A conversation keeps the model and the text it started with. */
interface Conversation<T> {
  target: T;
  report: string;
}

/**
 * Sends the diagnosis to a model that runs in this cluster, through the Kubernetes service or
 * pod proxy like the Playground: the text never leaves the cluster. The user reviews (and may
 * edit) the exact text before it is sent, then can ask follow-up questions; each request sends
 * the whole conversation.
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
    () =>
      targets.filter(target => target.status.health === 'ready' && endpointIdOf(target) !== ownId),
    [targets, ownId]
  );
  type Target = (typeof candidates)[number];
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
  const [followUp, setFollowUp] = React.useState('');
  const [maxTokens, setMaxTokens] = React.useState(String(DEFAULT_MAX_TOKENS));
  const [thinking, setThinking] = React.useState(true);
  const [conversation, setConversation] = React.useState<Conversation<Target> | null>(null);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Answers the last turn of `next`, or continues its answer. When the request fails or is
   * stopped, a partial answer is kept and can be continued, a failed continuation keeps the
   * answer as it was, and a new turn without any answer is removed (its question returned).
   */
  const run = async (conv: Conversation<Target>, next: Turn[], continueLast: boolean) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const last = next[next.length - 1];
    const join = (before: string, after: string) =>
      before && after ? `${before}\n\n${after}` : before || after;
    const setLast = (patch: Partial<Turn>) =>
      setTurns(ts => ts.map((turn, i) => (i === ts.length - 1 ? { ...turn, ...patch } : turn)));
    setTurns(
      next.map((turn, i) => (i === next.length - 1 ? { ...turn, cutOff: undefined } : turn))
    );
    setBusy(true);
    setError(null);
    let answered = false;
    try {
      const resolved = await resolveTarget(cluster, conv.target);
      const model = resolved.models.includes(conv.target.defaultModel)
        ? conv.target.defaultModel
        : resolved.models[0] || conv.target.defaultModel;
      const result = await chatCompletion(
        cluster,
        resolved,
        model,
        conversationMessages(conv.report, next, continueLast),
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
            answered = answered || !!content || !!thought;
            setLast({ answer: last.answer + content, reasoning: join(last.reasoning, thought) });
          },
        }
      );
      setLast({
        answer: last.answer + result.content,
        reasoning: join(last.reasoning, result.reasoning),
        cutOff: result.finishReason === 'length' ? 'length' : undefined,
      });
    } catch (err) {
      setError(controller.signal.aborted ? t('Stopped.') : (err as Error).message);
      if (answered) {
        setLast({ cutOff: 'interrupted' });
      } else if (continueLast) {
        setLast({ cutOff: last.cutOff });
      } else {
        setTurns(ts => ts.slice(0, -1));
        if (next.length > 1) setFollowUp(last.question);
        else setConversation(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const turn = (q: string): Turn => ({ question: q, answer: '', reasoning: '' });

  const ask = () => {
    if (!target) return;
    const conv = { target, report: text };
    setConversation(conv);
    run(conv, [turn(question.trim() || DEFAULT_QUESTION)], false);
  };

  const askFollowUp = () => {
    const q = followUp.trim();
    if (!conversation || !q || busy) return;
    setFollowUp('');
    run(conversation, [...turns, turn(q)], false);
  };

  const continueAnswer = () => {
    if (conversation && turns[turns.length - 1]?.answer) run(conversation, turns, true);
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setConversation(null);
    setTurns([]);
    setFollowUp('');
    setError(null);
  };

  const started = !!conversation;

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
            <EndpointPicker
              targets={started ? [conversation.target] : candidates}
              label={t('Model')}
              value={(started ? conversation.target.id : target?.id) || null}
              onChange={setTargetId}
              disabled={busy || loading || started}
            />
            <TextField
              size="small"
              label={t('Question (optional)')}
              placeholder={t(DEFAULT_QUESTION)}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              sx={{ flexGrow: 1, minWidth: 280 }}
              disabled={busy || started}
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
          <GatewayAccess target={started ? conversation.target : target} disabled={busy} />
          <TextField
            multiline
            minRows={started ? 2 : 6}
            maxRows={started ? 6 : 16}
            label={t('Text that will be sent')}
            value={started ? conversation.report : text}
            onChange={e => {
              setText(e.target.value);
              setEdited(true);
            }}
            disabled={busy || started}
            InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
            helperText={
              started ? (
                t('Start a new conversation to change the model or the text.')
              ) : edited ? (
                <Button size="small" sx={{ p: 0 }} onClick={() => setEdited(false)}>
                  {t('Reset to the generated text')}
                </Button>
              ) : (
                t('{{n}} characters', { n: text.length })
              )
            }
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            {started ? (
              <Button startIcon={<Icon icon="mdi:refresh" />} onClick={newConversation}>
                {t('New conversation')}
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={busy || !target || !text.trim()}
                startIcon={<Icon icon="mdi:send" />}
                onClick={ask}
              >
                {t('Ask')}
              </Button>
            )}
          </Box>

          {started && (
            <Box
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                pt: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {turns.map((item, index) => {
                const last = index === turns.length - 1;
                return (
                  <Box key={index}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1 }}>
                      <Icon icon="mdi:account-outline" width={20} />
                      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>
                        {item.question}
                      </Typography>
                    </Box>
                    <Box sx={{ pl: 3.5 }}>
                      {item.reasoning && (
                        <details open={!item.answer}>
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
                            {item.reasoning}
                          </Typography>
                        </details>
                      )}
                      {item.answer && <Markdown text={item.answer} />}
                      {last && busy && !item.answer && !item.reasoning && (
                        <CircularProgress size={18} />
                      )}
                      {item.cutOff && (
                        <Alert
                          severity="warning"
                          sx={{ my: 1 }}
                          action={
                            last && item.answer ? (
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
                          {!item.answer
                            ? item.cutOff === 'length'
                              ? t(
                                  'Thinking used the whole token limit before the answer. Raise Max tokens or turn off Thinking.'
                                )
                              : t('The answer stopped before it began.')
                            : item.cutOff === 'length'
                            ? t('The answer hit the token limit and is cut off.')
                            : t('The answer is incomplete.')}
                        </Alert>
                      )}
                    </Box>
                  </Box>
                );
              })}
              {error && (
                <Alert severity="error">
                  {error}
                  {isContextLengthError(error) && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {t(
                        "The conversation and the answer do not fit in the model's context length (--max-model-len). Lower Max tokens, shorten the text or start a new conversation."
                      )}
                    </Typography>
                  )}
                </Alert>
              )}
              {turns.some(item => item.answer) && (
                <Typography variant="caption" color="text.secondary">
                  {t('Answers of {{model}}. Check them before acting on them.', {
                    model: conversation.target.defaultModel,
                  })}
                </Typography>
              )}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  multiline
                  maxRows={6}
                  size="small"
                  fullWidth
                  label={t('Follow-up question')}
                  placeholder={t('Enter to send, Shift+Enter for a new line')}
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      askFollowUp();
                    }
                  }}
                />
                {busy ? (
                  <Button onClick={() => abortRef.current?.abort()}>{t('Stop')}</Button>
                ) : (
                  <Button
                    variant="contained"
                    disabled={!followUp.trim()}
                    startIcon={<Icon icon="mdi:send" />}
                    onClick={askFollowUp}
                  >
                    {t('Send')}
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Paper>
  );
}
