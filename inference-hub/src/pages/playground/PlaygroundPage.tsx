import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Box,
  Button,
  FormControlLabel,
  Grid,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { ChatParams } from '../../api/openai';
import { t } from '../../common/i18n';
import { EmptyState } from '../../common/States';
import { DiscoveryGate } from '../../components/common/DiscoveryGate';
import { SafeSlider } from '../../components/common/SafeSlider';
import { usePlaygroundTargets } from '../../hooks/usePlaygroundTargets';
import { featuresOf, useSettings } from '../../settings/settings';
import { ChatPane, ChatPaneHandle } from './ChatPane';

// Temperature and top P come from the model (generation_config.json) unless the user overrides
// them. Reasoning models often need a few thousand tokens before they start answering.
const DEFAULT_PARAMS: ChatParams = {
  modelDefaults: true,
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  stream: true,
};

function ParamsPanel({
  systemPrompt,
  onSystemPrompt,
  params,
  onParams,
}: {
  systemPrompt: string;
  onSystemPrompt: (v: string) => void;
  params: ChatParams;
  onParams: (p: ChatParams) => void;
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
    </Paper>
  );
}

function Playground() {
  const location = useLocation();
  const history = useHistory();
  const { targets, loading } = usePlaygroundTargets();
  const initial = new URLSearchParams(location.search).get('target');
  const [targetIds, setTargetIds] = React.useState<Array<string | null>>([initial, null]);
  const [compare, setCompare] = React.useState(false);
  const [systemPrompt, setSystemPrompt] = React.useState('');
  const [params, setParams] = React.useState<ChatParams>(DEFAULT_PARAMS);
  const [input, setInput] = React.useState('');
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
    if (!text || anyBusy) return;
    activePanes.forEach(i => panes[i].current?.send(text));
    setInput('');
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
          <FormControlLabel
            key="compare"
            control={<Switch checked={compare} onChange={e => setCompare(e.target.checked)} />}
            label={t('Compare two models')}
          />,
        ],
      }}
    >
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
                  params={params}
                  onBusyChange={busyHandlers[i]}
                  compact={compare}
                />
              </Grid>
            ))}
          </Grid>
          <Box sx={{ display: 'flex', gap: 1, mt: 2, alignItems: 'flex-end' }}>
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
                disabled={!input.trim()}
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
          />
        </Grid>
      </Grid>
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
