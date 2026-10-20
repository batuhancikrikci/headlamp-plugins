import { Icon } from '@iconify/react';
import {
  Alert,
  Autocomplete,
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
  ResolvedTarget,
  resolveTarget,
} from '../../api/openai';
import { t } from '../../common/i18n';
import { Markdown } from '../../components/common/Markdown';
import { ModelAvatar } from '../../components/common/ModelAvatar';
import { StatusBadge } from '../../components/common/StatusBadge';
import { useCan } from '../../hooks/useCan';
import { useCurrentCluster } from '../../hooks/useCluster';
import { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { splitThinking } from '../../utils/markdown';
import { CurlDialog } from './CurlDialog';

export interface PaneMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  pending?: boolean;
  error?: string;
  result?: Omit<ChatResult, 'content' | 'reasoning'>;
}

export interface ChatPaneHandle {
  send: (text: string) => void;
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

function MessageBubble({ message }: { message: PaneMessage }) {
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
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
          </Typography>
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
  if (!target) return null;
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
  const target = targets.find(x => x.id === targetId);
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
    (list: PaneMessage[]): ChatMessage[] => [
      ...(systemPrompt.trim() ? [{ role: 'system' as const, content: systemPrompt.trim() }] : []),
      ...list
        .filter(m => !m.error && !m.pending && m.content)
        .map(m => ({ role: m.role, content: splitThinking(m.content).answer || m.content })),
    ],
    [systemPrompt]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      send: (text: string) => {
        if (resolveState.status !== 'ready' || busy) return;
        const resolved = resolveState.resolved;
        const user: PaneMessage = { id: nextId++, role: 'user', content: text };
        const assistant: PaneMessage = {
          id: nextId++,
          role: 'assistant',
          content: '',
          pending: true,
        };
        const conversation = history([...messages, user]);
        setMessages(list => [...list, user, assistant]);
        const controller = new AbortController();
        abortRef.current = controller;
        const update = (patch: Partial<PaneMessage>) =>
          setMessages(list => list.map(m => (m.id === assistant.id ? { ...m, ...patch } : m)));
        chatCompletion(cluster, resolved, model, conversation, params, controller.signal, {
          onDelta: (content, reasoning) => update({ content, reasoning }),
        })
          .then(({ content, reasoning, ...result }) =>
            update({ content, reasoning, result, pending: false })
          )
          .catch((err: Error) =>
            // Headlamp reports an aborted fetch as a 408, so check the signal itself.
            update({
              pending: false,
              error: controller.signal.aborted ? t('Stopped.') : err.message,
            })
          );
      },
      reset: () => {
        abortRef.current?.abort();
        setMessages([]);
      },
      stop: () => abortRef.current?.abort(),
    }),
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
        <Autocomplete
          size="small"
          sx={{ minWidth: 240, flex: 1 }}
          options={targets}
          value={target || null}
          onChange={(_, v) => {
            abortRef.current?.abort();
            setMessages([]);
            onTargetChange(v?.id || null);
          }}
          getOptionLabel={o => `${o.namespace}/${o.label}`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          groupBy={o => (o.kind === 'Engine' ? t('vLLM engine pods') : t('Model endpoints'))}
          renderOption={(props, o) => (
            <Box
              component="li"
              {...props}
              key={o.id}
              sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
            >
              <ModelAvatar model={o.model} size={22} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {o.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {o.namespace} · {o.defaultModel}
                </Typography>
              </Box>
              <StatusBadge summary={o.status} />
            </Box>
          )}
          renderInput={p => <TextField {...p} label={t('Endpoint')} />}
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
        {messages.map(m => (
          <MessageBubble key={m.id} message={m} />
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
