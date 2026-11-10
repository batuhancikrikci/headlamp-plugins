import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { ChatParams, ToolChoice } from '../../api/openai';
import { t } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { SafeSlider } from '../../components/common/SafeSlider';
import { usePlaygroundTargets } from '../../hooks/usePlaygroundTargets';
import { featuresOf, useSettings } from '../../settings/settings';
import { ACCEPTED_TYPES, MAX_IMAGES, readImage } from '../../utils/images';
import { EXAMPLE_TOOLS, parseTools } from '../../utils/tools';
import { BenchmarkPanel } from './BenchmarkPanel';
import { ChatPane, ChatPaneHandle } from './ChatPane';
import { EmbeddingsPanel } from './EmbeddingsPanel';

// Temperature and top P come from the model (generation_config.json) unless the user overrides
// them. Reasoning models often need a few thousand tokens before they start answering.
const DEFAULT_PARAMS: ChatParams = {
  modelDefaults: true,
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  stream: true,
};

interface ToolsState {
  on: boolean;
  text: string;
  choice: ToolChoice;
}

/** Function definitions sent with every request while switched on. */
function ToolsSection({ tools, onTools }: { tools: ToolsState; onTools: (t: ToolsState) => void }) {
  const parsed = parseTools(tools.text);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Tooltip
        title={t(
          'Send function definitions with each message. When the model calls a function, enter what it returned and the model continues with it.'
        )}
      >
        <FormControlLabel
          control={
            <Switch
              checked={tools.on}
              onChange={e => onTools({ ...tools, on: e.target.checked })}
            />
          }
          label={t('Tools (function calling)')}
        />
      </Tooltip>
      {tools.on && (
        <>
          <TextField
            label={t('Functions (JSON)')}
            multiline
            minRows={6}
            maxRows={16}
            value={tools.text}
            onChange={e => onTools({ ...tools, text: e.target.value })}
            error={!!parsed.error}
            helperText={
              parsed.error
                ? t(parsed.error)
                : t('{{n}} function(s): {{names}}', {
                    n: parsed.names.length,
                    names: parsed.names.join(', '),
                  })
            }
            inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              select
              size="small"
              label={t('Tool choice')}
              value={tools.choice}
              onChange={e => onTools({ ...tools, choice: e.target.value as ToolChoice })}
              sx={{ flexGrow: 1 }}
            >
              <MenuItem value="auto">{t('auto: the model decides')}</MenuItem>
              <MenuItem value="required">{t('required: always call a function')}</MenuItem>
              <MenuItem value="none">{t('none: never call')}</MenuItem>
            </TextField>
            <Button size="small" onClick={() => onTools({ ...tools, text: EXAMPLE_TOOLS })}>
              {t('Example')}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}

function ParamsPanel({
  systemPrompt,
  onSystemPrompt,
  params,
  onParams,
  tools,
  onTools,
}: {
  systemPrompt: string;
  onSystemPrompt: (v: string) => void;
  params: ChatParams;
  onParams: (p: ChatParams) => void;
  tools: ToolsState;
  onTools: (t: ToolsState) => void;
}) {
  const set = (patch: Partial<ChatParams>) => onParams({ ...params, ...patch });
  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label={t('System prompt')}
        multiline
        minRows={3}
        maxRows={10}
        value={systemPrompt}
        onChange={e => onSystemPrompt(e.target.value)}
        placeholder={t('You are a helpful assistant.')}
      />
      <Tooltip
        title={t(
          'Let the model server use the sampling settings recommended for the model (its generation_config.json). Turn off to set temperature and top P here.'
        )}
      >
        <FormControlLabel
          control={
            <Switch
              checked={params.modelDefaults}
              onChange={e => set({ modelDefaults: e.target.checked })}
            />
          }
          label={t('Use model defaults')}
        />
      </Tooltip>
      <Box>
        <Typography
          variant="body2"
          id="ih-temp"
          color={params.modelDefaults ? 'text.secondary' : undefined}
        >
          {params.modelDefaults
            ? t('Temperature: model default')
            : t('Temperature: {{v}}', { v: params.temperature.toFixed(2) })}
        </Typography>
        <SafeSlider
          aria-labelledby="ih-temp"
          disabled={params.modelDefaults}
          min={0}
          max={2}
          step={0.05}
          value={params.temperature}
          onChange={(_, v) => set({ temperature: v as number })}
        />
      </Box>
      <Box>
        <Typography
          variant="body2"
          id="ih-topp"
          color={params.modelDefaults ? 'text.secondary' : undefined}
        >
          {params.modelDefaults
            ? t('Top P: model default')
            : t('Top P: {{v}}', { v: params.topP.toFixed(2) })}
        </Typography>
        <SafeSlider
          aria-labelledby="ih-topp"
          disabled={params.modelDefaults}
          min={0.05}
          max={1}
          step={0.05}
          value={params.topP}
          onChange={(_, v) => set({ topP: v as number })}
        />
      </Box>
      <TextField
        type="number"
        size="small"
        label={t('Max tokens')}
        value={params.maxTokens}
        inputProps={{ min: 1, max: 131072 }}
        onChange={e =>
          set({ maxTokens: Math.max(1, Math.min(131072, Number(e.target.value) || 1)) })
        }
      />
      <Tooltip title={t('Stream tokens as they are generated (Server-Sent Events).')}>
        <FormControlLabel
          control={
            <Switch checked={params.stream} onChange={e => set({ stream: e.target.checked })} />
          }
          label={t('Stream response')}
        />
      </Tooltip>
      <ToolsSection tools={tools} onTools={onTools} />
    </Paper>
  );
}

/** Thumbnails of the images that go with the next message. */
function Attachments({ images, onRemove }: { images: string[]; onRemove: (i: number) => void }) {
  if (images.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
      {images.map((url, i) => (
        <Box key={i} sx={{ position: 'relative' }}>
          <Box
            component="img"
            src={url}
            alt={t('Attachment {{n}}', { n: i + 1 })}
            sx={{
              height: 64,
              width: 64,
              objectFit: 'cover',
              borderRadius: 1,
              border: 1,
              borderColor: 'divider',
            }}
          />
          <IconButton
            size="small"
            aria-label={t('Remove attachment {{n}}', { n: i + 1 })}
            onClick={() => onRemove(i)}
            sx={{ position: 'absolute', top: -10, right: -10, bgcolor: 'background.paper' }}
          >
            <Icon icon="mdi:close-circle" width={18} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

function Playground() {
  const location = useLocation();
  const history = useHistory();
  const { targets, loading } = usePlaygroundTargets();
  const initial = new URLSearchParams(location.search).get('target');
  const [targetIds, setTargetIds] = React.useState<Array<string | null>>([initial, null]);
  const [compare, setCompare] = React.useState(false);
  const [mode, setMode] = React.useState<'chat' | 'benchmark' | 'embed'>(() => {
    const requested = new URLSearchParams(location.search).get('mode');
    return requested === 'benchmark' || requested === 'embed' ? requested : 'chat';
  });
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [params, setParams] = React.useState<ChatParams>(DEFAULT_PARAMS);
  const [input, setInput] = React.useState('');
  const [images, setImages] = React.useState<string[]>([]);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [tools, setTools] = React.useState<ToolsState>({
    on: false,
    text: EXAMPLE_TOOLS,
    choice: 'auto',
  });
  const parsedTools = React.useMemo(() => parseTools(tools.text), [tools.text]);
  const chatParams = React.useMemo<ChatParams>(
    () =>
      tools.on && parsedTools.tools
        ? { ...params, tools: parsedTools.tools, toolChoice: tools.choice }
        : params,
    [params, tools.on, tools.choice, parsedTools]
  );
  const [busy, setBusy] = React.useState([false, false]);
  const panes = [React.useRef<ChatPaneHandle>(null), React.useRef<ChatPaneHandle>(null)];
  const busyHandlers = React.useMemo(
    () =>
      [0, 1].map(
        i => (b: boolean) =>
          setBusy(prev => (prev[i] === b ? prev : prev.map((x, j) => (j === i ? b : x))))
      ),
    []
  );

  // Pick the first ready endpoint when nothing is selected yet.
  React.useEffect(() => {
    if (!targetIds[0] && targets.length > 0 && targets[0].status.health === 'ready') {
      setTargetIds(ids => [targets[0].id, ids[1]]);
    }
  }, [targets, targetIds]);

  const setTarget = (index: number, id: string | null) => {
    setTargetIds(ids => ids.map((x, i) => (i === index ? id : x)));
    if (index === 0) {
      const params = new URLSearchParams(location.search);
      if (id) params.set('target', id);
      else params.delete('target');
      history.replace({ ...location, search: params.toString() });
    }
  };

  const activePanes = compare ? [0, 1] : [0];
  const anyBusy = activePanes.some(i => busy[i]);
  const send = () => {
    const text = input.trim();
    if ((!text && images.length === 0) || anyBusy) return;
    activePanes.forEach(i => panes[i].current?.send(text, images));
    setInput('');
    setImages([]);
    setImageError(null);
  };

  const attach = async (files: FileList | null) => {
    setImageError(null);
    const list = Array.from(files || []).slice(0, MAX_IMAGES - images.length);
    for (const file of list) {
      try {
        const url = await readImage(file);
        setImages(current => (current.length < MAX_IMAGES ? [...current, url] : current));
      } catch (err) {
        setImageError((err as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!loading && targets.length === 0) {
    return (
      <SectionBox title={t('Playground')}>
        <EmptyState
          icon="mdi:chat-remove-outline"
          title={t('Nothing to chat with yet')}
          description={t(
            'The Playground talks to LLMInferenceServices, InferenceServices with an OpenAI-compatible runtime and vLLM pods. Deploy a model endpoint first.'
          )}
        />
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={t('Playground')}
      headerProps={{
        titleSideActions: [
          <Box key="actions" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {mode === 'chat' && (
              <FormControlLabel
                control={<Switch checked={compare} onChange={e => setCompare(e.target.checked)} />}
                label={t('Compare two models')}
              />
            )}
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_, v) => v && setMode(v)}
              aria-label={t('Playground mode')}
            >
              <ToggleButton value="chat">
                <Icon icon="mdi:chat-processing-outline" style={{ marginRight: 6 }} />
                {t('Chat')}
              </ToggleButton>
              <ToggleButton value="benchmark">
                <Icon icon="mdi:speedometer" style={{ marginRight: 6 }} />
                {t('Benchmark')}
              </ToggleButton>
              <ToggleButton value="embed">
                <Icon icon="mdi:vector-triangle" style={{ marginRight: 6 }} />
                {t('Embed & rerank')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>,
        ],
      }}
    >
      {mode === 'benchmark' ? (
        <BenchmarkPanel targets={targets} initialTargetId={targetIds[0]} />
      ) : mode === 'embed' ? (
        <EmbeddingsPanel targets={targets} initialTargetId={targetIds[0]} />
      ) : (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={9}>
            <Grid container spacing={2}>
              {activePanes.map(i => (
                <Grid item xs={12} md={compare ? 6 : 12} key={i}>
                  <ChatPane
                    ref={panes[i]}
                    targets={targets}
                    targetId={targetIds[i]}
                    onTargetChange={id => setTarget(i, id)}
                    systemPrompt={systemPrompt}
                    params={chatParams}
                    onBusyChange={busyHandlers[i]}
                    compact={compare}
                  />
                </Grid>
              ))}
            </Grid>
            <Attachments
              images={images}
              onRemove={i => setImages(list => list.filter((_, j) => j !== i))}
            />
            {imageError && (
              <Alert severity="error" sx={{ mt: 1 }} onClose={() => setImageError(null)}>
                {imageError}
              </Alert>
            )}
            <Box sx={{ display: 'flex', gap: 1, mt: 2, alignItems: 'flex-end' }}>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                multiple
                hidden
                onChange={e => attach(e.target.files)}
                data-testid="image-input"
              />
              <Tooltip
                title={t('Attach images (up to {{n}}) for vision-language models', {
                  n: MAX_IMAGES,
                })}
              >
                <span>
                  <IconButton
                    aria-label={t('Attach images')}
                    disabled={images.length >= MAX_IMAGES || anyBusy}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Icon icon="mdi:image-plus" />
                  </IconButton>
                </span>
              </Tooltip>
              <TextField
                fullWidth
                multiline
                maxRows={8}
                placeholder={t('Send a message (Enter to send, Shift+Enter for a new line)')}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                inputProps={{ 'aria-label': t('Message') }}
              />
              {anyBusy ? (
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => activePanes.forEach(i => panes[i].current?.stop())}
                  startIcon={<Icon icon="mdi:stop" />}
                >
                  {t('Stop')}
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={send}
                  disabled={!input.trim() && images.length === 0}
                  startIcon={<Icon icon="mdi:send" />}
                >
                  {t('Send')}
                </Button>
              )}
              <Tooltip title={t('Clear the conversation')}>
                <span>
                  <Button
                    onClick={() => activePanes.forEach(i => panes[i].current?.reset())}
                    startIcon={<Icon icon="mdi:broom" />}
                  >
                    {t('Reset')}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          </Grid>
          <Grid item xs={12} lg={3}>
            <ParamsPanel
              systemPrompt={systemPrompt}
              onSystemPrompt={setSystemPrompt}
              params={params}
              onParams={setParams}
              tools={tools}
              onTools={setTools}
            />
          </Grid>
        </Grid>
      )}
    </SectionBox>
  );
}

export function PlaygroundPage() {
  const settings = useSettings();
  if (!featuresOf(settings).playground) {
    return (
      <SectionBox title={t('Playground')}>
        <EmptyState
          icon="mdi:chat-remove-outline"
          title={t('The Playground is turned off')}
          description={t('Enable it under Inference Hub > Settings > Features.')}
        />
      </SectionBox>
    );
  }
  return (
    <DiscoveryGate title={t('Playground')}>
      <Playground />
    </DiscoveryGate>
  );
}
