import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  chatCompletion,
  ChatError,
  ChatMessage,
  ChatParams,
  ChatResult,
  isImageInputError,
  isToolSetupError,
  ResolvedTarget,
  resolveTarget,
  ToolCall,
  toolCallMessage,
} from '../../api/openai';
import { t } from '../../common/i18n';
import { Markdown } from '../../components/common/Markdown';
import { EndpointPicker } from '../../components/playground/EndpointPicker';
import { GatewayAccess } from '../../components/playground/GatewayAccess';
import { useCan } from '../../hooks/useCan';
import { useCurrentCluster } from '../../hooks/useCluster';
import { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { splitThinking } from '../../utils/markdown';
import { CurlDialog } from './CurlDialog';

export interface PaneMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** User: attached images as data URLs. */
  images?: string[];
  reasoning?: string;
  /** Assistant: functions the model asked to call. */
  toolCalls?: ToolCall[];
  /** Tool: the call this result answers. */
  toolCallId?: string;
  toolName?: string;
  pending?: boolean;
  error?: string;
  result?: Omit<ChatResult, 'content' | 'reasoning' | 'toolCalls'>;
}

export interface ChatPaneHandle {
  send: (text: string, images?: string[]) => void;
  reset: () => void;
  stop: () => void;
}

interface ChatPaneProps {
  targets: PlaygroundTarget[];
  targetId: string | null;
  onTargetChange: (id: string | null) => void;
  systemPrompt: string;
  params: ChatParams;
  onBusyChange: (busy: boolean) => void;
  compact?: boolean;
}

type ResolveState =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'ready'; resolved: ResolvedTarget }
  | { status: 'error'; message: string };

let nextId = 1;

function Stats({ result }: { result: NonNullable<PaneMessage['result']> }) {
  const tokens = result.usage.completionTokens;
  const genMs = result.totalMs - (result.ttftMs ?? 0);
  const tps = tokens && genMs > 0 ? (tokens / genMs) * 1000 : undefined;
  const parts = [
    result.ttftMs !== undefined ? t('TTFT {{v}} ms', { v: Math.round(result.ttftMs) }) : null,
    t('total {{v}} s', { v: (result.totalMs / 1000).toFixed(2) }),
    result.usage.promptTokens !== undefined
      ? t('{{v}} prompt tokens', { v: result.usage.promptTokens })
      : null,
    tokens !== undefined ? t('{{v}} completion tokens', { v: tokens }) : null,
    tps !== undefined ? t('{{v}} tok/s', { v: tps.toFixed(1) }) : null,
    result.finishReason ? t('finish: {{v}}', { v: result.finishReason }) : null,
  ].filter(Boolean);
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
      {parts.join(' · ')}
      {result.buffered && (
        <Tooltip
          title={t(
            'The answer arrived in one piece although streaming was requested: a proxy between Headlamp and the model buffered the stream.'
          )}
        >
          <Box component="span" sx={{ ml: 1, color: 'warning.main' }}>
            {t('(stream buffered)')}
          </Box>
        </Tooltip>
      )}
    </Typography>
  );
}

function Reasoning({ text, pending }: { text: string; pending?: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Box sx={{ mb: 1 }}>
      <Button
        size="small"
        onClick={() => setOpen(o => !o)}
        startIcon={<Icon icon={pending ? 'mdi:thought-bubble-outline' : 'mdi:lightbulb-outline'} />}
        endIcon={<Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} />}
        sx={{ textTransform: 'none', color: 'text.secondary' }}
      >
        {pending ? t('Thinking…') : t('Reasoning')}
      </Button>
      <Collapse in={open}>
        <Box
          sx={{
            borderLeft: 2,
            borderColor: 'divider',
            pl: 1.5,
            color: 'text.secondary',
            whiteSpace: 'pre-wrap',
            fontSize: '0.85rem',
          }}
        >
          {text}
        </Box>
      </Collapse>
    </Box>
  );
}

/** Warning for a reply that hit the token limit before the model finished reasoning. */
export function reasoningCutoffNotice(
  message: PaneMessage,
  answer: string,
  reasoning: string
): string | null {
  if (message.pending || answer || !reasoning || message.result?.finishReason !== 'length') {
    return null;
  }
  const n = message.result.usage.completionTokens;
  return n
    ? t(
        'The model spent all {{n}} tokens on reasoning and was cut off before it could answer. Increase Max tokens and try again.',
        { n }
      )
    : t(
        'The model reached the Max tokens limit while reasoning and was cut off before it could answer. Increase Max tokens and try again.'
      );
}

/** The conversation in the OpenAI request format: images as parts, tool calls and results. */
export function paneHistory(systemPrompt: string, list: PaneMessage[]): ChatMessage[] {
  const out: ChatMessage[] = systemPrompt.trim()
    ? [{ role: 'system', content: systemPrompt.trim() }]
    : [];
  for (const m of list) {
    if (m.error || m.pending) continue;
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId || '', content: m.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push(toolCallMessage(splitThinking(m.content).answer, m.toolCalls));
    } else if (m.role === 'user' && m.images?.length) {
      out.push({
        role: 'user',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...m.images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
        ],
      });
    } else if (m.content) {
      out.push({ role: m.role, content: splitThinking(m.content).answer || m.content });
    }
  }
  return out;
}

function prettyArguments(text: string): { text: string; valid: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(text || '{}'), null, 2), valid: true };
  } catch {
    return { text, valid: false };
  }
}

/** The function calls of an answer, with inputs for their results while they are open. */
function ToolCalls({
  calls,
  onResults,
}: {
  calls: ToolCall[];
  onResults?: (results: string[]) => void;
}) {
  const [results, setResults] = React.useState<string[]>(() => calls.map(() => ''));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 0.5 }}>
      {calls.map((call, i) => {
        const args = prettyArguments(call.arguments);
        return (
          <Paper key={call.id || i} variant="outlined" sx={{ p: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Icon icon="mdi:function-variant" width={18} />
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                {call.name || t('(no name)')}
              </Typography>
              {!args.valid && (
                <Chip size="small" color="warning" label={t('arguments are not valid JSON')} />
              )}
            </Box>
            <Box
              component="pre"
              sx={{ m: 0, fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {args.text}
            </Box>
            {onResults && (
              <TextField
                fullWidth
                multiline
                size="small"
                maxRows={6}
                sx={{ mt: 1 }}
                label={t('Result')}
                placeholder={t('What the function returned, e.g. {"temperature": 21}')}
                value={results[i]}
                onChange={e =>
                  setResults(list => list.map((r, j) => (j === i ? e.target.value : r)))
                }
              />
            )}
          </Paper>
        );
      })}
      {onResults && (
        <Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Icon icon="mdi:keyboard-return" />}
            disabled={results.some(r => !r.trim())}
            onClick={() => onResults(results.map(r => r.trim()))}
          >
            {t('Send results to the model')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function MessageBubble({
  message,
  onToolResults,
}: {
  message: PaneMessage;
  onToolResults?: (results: string[]) => void;
}) {
  if (message.role === 'tool') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <Paper variant="outlined" sx={{ px: 1.5, py: 1, maxWidth: '88%', minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {t('Result of {{name}}', { name: message.toolName || t('the function') })}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace' }}
          >
            {message.content}
          </Typography>
        </Paper>
      </Box>
    );
  }
  const isUser = message.role === 'user';
  const split = splitThinking(message.content);
  const reasoning = [message.reasoning, split.reasoning].filter(Boolean).join('\n');
  const cutoff = reasoningCutoffNotice(message, split.answer, reasoning);
  return (
    <Box sx={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', mb: 1.5 }}>
      <Paper
        variant="outlined"
        sx={{
          px: 1.5,
          py: 1,
          maxWidth: '88%',
          minWidth: 0,
          bgcolor: isUser ? 'action.selected' : 'background.paper',
          borderColor: message.error ? 'error.main' : 'divider',
        }}
      >
        {isUser ? (
          <>
            {message.images && message.images.length > 0 && (
              <Box
                sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: message.content ? 1 : 0 }}
              >
                {message.images.map((url, i) => (
                  <Box
                    key={i}
                    component="img"
                    src={url}
                    alt={t('Attached image {{n}}', { n: i + 1 })}
                    sx={{ maxHeight: 120, maxWidth: 200, borderRadius: 1, objectFit: 'cover' }}
                  />
                ))}
              </Box>
            )}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message.content}
            </Typography>
          </>
        ) : (
          <>
            {reasoning && <Reasoning text={reasoning} pending={message.pending && !split.answer} />}
            {split.answer ? (
              <Markdown text={split.answer} />
            ) : message.pending && !reasoning ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
                <CircularProgress size={14} />
                <Typography variant="body2">{t('Waiting for the first token…')}</Typography>
              </Box>
            ) : null}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCalls calls={message.toolCalls} onResults={onToolResults} />
            )}
            {cutoff && <Alert severity="warning">{cutoff}</Alert>}
            {message.error && (
              <Alert severity="error" sx={{ mt: split.answer ? 1 : 0 }}>
                {message.error}
              </Alert>
            )}
            {message.result && <Stats result={message.result} />}
          </>
        )}
      </Paper>
    </Box>
  );
}

function proxyCheck(target: PlaygroundTarget | undefined) {
  // A gateway target goes through the gateway's Service, whose namespace is found later.
  if (!target || target.kind === 'Gateway') return null;
  return {
    verb: 'create' as const,
    group: '',
    resource: target.kind === 'Engine' ? 'pods' : 'services',
    subresource: 'proxy',
    namespace: target.namespace,
  };
}

export const ChatPane = React.forwardRef<ChatPaneHandle, ChatPaneProps>(function ChatPane(
  { targets, targetId, onTargetChange, systemPrompt, params, onBusyChange, compact },
  ref
) {
  const cluster = useCurrentCluster();
  // A refresh can drop the chosen target from the list for a moment: keep it until the list
  // has it again or another one is chosen, so the conversation and the model stay.
  const lastTarget = React.useRef<PlaygroundTarget | undefined>(undefined);
  const found = targets.find(x => x.id === targetId);
  const target = found ?? (lastTarget.current?.id === targetId ? lastTarget.current : undefined);
  lastTarget.current = target;
  const [resolveState, setResolveState] = React.useState<ResolveState>({ status: 'idle' });
  const [attempt, setAttempt] = React.useState(0);
  const [model, setModel] = React.useState('');
  const [messages, setMessages] = React.useState<PaneMessage[]>([]);
  const [curlOpen, setCurlOpen] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const can = useCan(proxyCheck(target));
  const busy = messages.some(m => m.pending);

  React.useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // Resolve the proxy path and models when the target changes.
  const targetKey = target ? `${target.id}|${target.pod?.port || ''}` : '';
  React.useEffect(() => {
    if (!target) {
      setResolveState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setResolveState({ status: 'resolving' });
    resolveTarget(cluster, target)
      .then(resolved => {
        if (cancelled) return;
        setResolveState({ status: 'ready', resolved });
        setModel(current =>
          resolved.models.includes(current)
            ? current
            : resolved.models.includes(target.defaultModel)
            ? target.defaultModel
            : resolved.models[0] || target.defaultModel
        );
      })
      .catch((err: ChatError) => {
        if (!cancelled) setResolveState({ status: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, targetKey, attempt]);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const history = React.useCallback(
    (list: PaneMessage[]): ChatMessage[] => paneHistory(systemPrompt, list),
    [systemPrompt]
  );

  /** Adds messages to the conversation and asks the model for the next answer. */
  const run = (added: PaneMessage[]) => {
    if (resolveState.status !== 'ready' || busy) return;
    const resolved = resolveState.resolved;
    const assistant: PaneMessage = {
      id: nextId++,
      role: 'assistant',
      content: '',
      pending: true,
    };
    const conversation = history([...messages, ...added]);
    const withImages = added.some(m => m.images?.length);
    setMessages(list => [...list, ...added, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    const update = (patch: Partial<PaneMessage>) =>
      setMessages(list => list.map(m => (m.id === assistant.id ? { ...m, ...patch } : m)));
    const explain = (message: string) => {
      if (params.tools?.length && isToolSetupError(message)) {
        return `${message} ${t(
          'Tool calling needs vLLM started with --enable-auto-tool-choice and a --tool-call-parser that matches the model (for example hermes for Qwen).'
        )}`;
      }
      if (withImages && isImageInputError(message)) {
        return `${message} ${t(
          'The model may not accept images: use a vision-language model (for example Qwen2.5-VL).'
        )}`;
      }
      return message;
    };
    chatCompletion(cluster, resolved, model, conversation, params, controller.signal, {
      onDelta: (content, reasoning) => update({ content, reasoning }),
    })
      .then(({ content, reasoning, toolCalls, ...result }) =>
        update({
          content,
          reasoning,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          result,
          pending: false,
        })
      )
      .catch((err: Error) =>
        // Headlamp reports an aborted fetch as a 408, so check the signal itself.
        update({
          pending: false,
          error: controller.signal.aborted ? t('Stopped.') : explain(err.message),
        })
      );
  };

  const sendToolResults = (calls: ToolCall[], results: string[]) =>
    run(
      calls.map((call, i) => ({
        id: nextId++,
        role: 'tool' as const,
        content: results[i],
        toolCallId: call.id,
        toolName: call.name,
      }))
    );

  React.useImperativeHandle(
    ref,
    () => ({
      send: (text: string, images?: string[]) =>
        run([
          {
            id: nextId++,
            role: 'user',
            content: text,
            ...(images?.length ? { images } : {}),
          },
        ]),
      reset: () => {
        abortRef.current?.abort();
        setMessages([]);
      },
      stop: () => abortRef.current?.abort(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveState, busy, messages, history, cluster, model, params]
  );

  const resolved = resolveState.status === 'ready' ? resolveState.resolved : null;

  return (
    <Paper
      variant="outlined"
      sx={{ display: 'flex', flexDirection: 'column', height: compact ? 560 : 620, minWidth: 0 }}
    >
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          gap: 1,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <EndpointPicker
          targets={targets}
          value={target?.id ?? null}
          onChange={id => {
            if (id === target?.id) return;
            abortRef.current?.abort();
            setMessages([]);
            onTargetChange(id);
          }}
          minWidth={240}
        />
        <TextField
          select
          size="small"
          label={t('Model')}
          value={resolved?.models.includes(model) ? model : ''}
          onChange={e => setModel(e.target.value)}
          disabled={!resolved || resolved.models.length === 0}
          sx={{ minWidth: 200, flex: 1 }}
        >
          {(resolved?.models || []).map(m => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title={t('Copy as curl')}>
          <span>
            <IconButton
              aria-label={t('Copy as curl')}
              disabled={!resolved || !target}
              onClick={() => setCurlOpen(true)}
            >
              <Icon icon="mdi:console" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box ref={listRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5 }}>
        {!target && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 8 }}>
            <Icon icon="mdi:chat-processing-outline" width={48} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {targets.length
                ? t('Pick an endpoint to start chatting.')
                : t('No endpoints yet. Deploy a model first.')}
            </Typography>
          </Box>
        )}
        {target && target.status.health !== 'ready' && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('This endpoint is not ready ({{s}}); requests may fail.', {
              s: target.status.reason || target.status.health,
            })}
          </Alert>
        )}
        {target?.gateway && (
          <Box sx={{ mb: 1 }}>
            <GatewayAccess target={target} disabled={busy} />
          </Box>
        )}
        {can.allowed === false && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {t(
              'You are not allowed to use the {{r}} proxy in namespace {{ns}}, which the Playground needs to reach the model.',
              {
                r: target?.kind === 'Engine' ? 'pods' : 'services',
                ns: target?.namespace,
              }
            )}
          </Alert>
        )}
        {resolveState.status === 'resolving' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
            <CircularProgress size={16} />
            <Typography variant="body2">{t('Connecting to the model server…')}</Typography>
          </Box>
        )}
        {resolveState.status === 'error' && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => setAttempt(a => a + 1)}>
                {t('Retry')}
              </Button>
            }
          >
            {resolveState.message}
          </Alert>
        )}
        {resolved && messages.length === 0 && (
          <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
            <Chip
              size="small"
              variant="outlined"
              icon={<Icon icon="mdi:check-network-outline" />}
              label={t('Connected')}
            />
            <Typography variant="caption" component="div" sx={{ mt: 1, fontFamily: 'monospace' }}>
              {resolved.proxyBase}
              {resolved.apiPrefix}
            </Typography>
          </Box>
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            onToolResults={
              // Results are asked for the open calls of the last answer only.
              i === messages.length - 1 && !busy && m.toolCalls?.length
                ? results => sendToolResults(m.toolCalls!, results)
                : undefined
            }
          />
        ))}
      </Box>

      {curlOpen && resolved && target && (
        <CurlDialog
          open
          onClose={() => setCurlOpen(false)}
          target={target}
          resolved={resolved}
          model={model}
          messages={history(messages)}
          params={params}
        />
      )}
    </Paper>
  );
});
