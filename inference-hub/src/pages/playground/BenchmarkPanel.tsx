import { Icon } from '@iconify/react';
import { SimpleTable } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import { chatCompletion, resolveTarget } from '../../api/openai';
import { promQuery } from '../../api/prometheus';
import { t } from '../../common/i18n';
import { EndpointPicker } from '../../components/playground/EndpointPicker';
import { GatewayAccess } from '../../components/playground/GatewayAccess';
import { useCurrentCluster } from '../../hooks/useCluster';
import { endpointIdOf, PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { usePrometheus } from '../../hooks/usePrometheus';
import { useVllmEngines } from '../../hooks/useVllmEngines';
import { VllmEngine } from '../../resources/engine';
import {
  BenchmarkConfig,
  BenchmarkSummary,
  BROWSER_CONNECTIONS,
  clampConfig,
  histogram,
  MAX_CONCURRENCY,
  MAX_REQUESTS,
  PROMPT_PRESETS,
  RequestResult,
  runPool,
  summarize,
  toCsv,
} from '../../utils/benchmark';
import { meetsGoal, SweepLevel, sweepLevels } from '../../utils/sweep';
import { podMatcher } from '../../utils/vllmMetrics';
import { SweepResults } from './SweepResults';

/** Earlier versions kept the last runs in the browser; the stored runs are removed. */
const OLD_HISTORY_KEY = 'inference-hub.benchmarks';

interface ServerPeak {
  maxWaiting?: number;
  maxKvPercent?: number;
}

interface RunRecord {
  /** The test was stopped before all requests were sent. */
  stopped?: boolean;
  id: string;
  target: string;
  model: string;
  config: BenchmarkConfig;
  startedAt: string;
  summary: BenchmarkSummary;
  results: RequestResult[];
  server?: ServerPeak;
}

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const ms = (v?: number) =>
  v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
const num = (v?: number, digits = 1) => (v === undefined ? '—' : v.toFixed(digits));

/** vLLM pods behind a Playground target. */
function enginesOf(target: PlaygroundTarget, engines: VllmEngine[]): VllmEngine[] {
  if (target.kind === 'Engine')
    return engines.filter(e => e.pod === target.name && e.namespace === target.namespace);
  const slug = endpointIdOf(target).split('/')[0];
  return engines.filter(
    e =>
      e.namespace === target.namespace &&
      e.endpoint?.slug === slug &&
      e.endpoint?.name === target.name
  );
}

function Histogram({ results }: { results: RequestResult[] }) {
  const buckets = histogram(
    results.filter(r => r.ok).map(r => r.totalMs),
    10
  );
  const max = Math.max(1, ...buckets.map(b => b.count));
  if (buckets.length === 0) return null;
  return (
    <Box
      aria-label={t('Latency distribution')}
      sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 80, mt: 1 }}
    >
      {buckets.map(b => (
        <Box
          key={b.upTo}
          title={`≤ ${ms(b.upTo)}: ${b.count}`}
          sx={{
            flex: 1,
            bgcolor: 'primary.main',
            opacity: 0.8,
            height: `${(b.count / max) * 100}%`,
            minHeight: b.count ? 2 : 0,
          }}
        />
      ))}
    </Box>
  );
}

/**
 * Benchmark mode of the Playground: sends a number of chat requests with a fixed concurrency to
 * one or two endpoints and compares latency and throughput.
 */
export function BenchmarkPanel({
  targets,
  initialTargetId,
}: {
  targets: PlaygroundTarget[];
  initialTargetId: string | null;
}) {
  const cluster = useCurrentCluster();
  const prometheus = usePrometheus();
  const { engines } = useVllmEngines();
  const ready = targets.filter(target => target.status.health === 'ready');
  const [targetIds, setTargetIds] = React.useState<string[]>(
    [initialTargetId || ready[0]?.id || ''].filter(Boolean)
  );
  const [compare, setCompare] = React.useState(false);
  // Sweep mode: the same test at concurrency 1, 2, 4, … up to the configured concurrency.
  const [sweep, setSweep] = React.useState(false);
  const [goalMs, setGoalMs] = React.useState(2000);
  const [expectedPeak, setExpectedPeak] = React.useState('');
  const [levels, setLevels] = React.useState<SweepLevel[]>([]);
  const [sweepTarget, setSweepTarget] = React.useState<PlaygroundTarget | null>(null);
  const [sweepStopped, setSweepStopped] = React.useState(false);
  const goal = { ttftP95Ms: Math.max(1, goalMs || 0), maxErrorRate: 0.01 };
  // The endpoint list may arrive after the first render: preselect the first ready one.
  React.useEffect(() => {
    if (targetIds.length === 0 && ready.length > 0) setTargetIds([ready[0].id]);
  }, [targetIds.length, ready]);
  const [preset, setPreset] = React.useState<string>(PROMPT_PRESETS[0].id);
  const [config, setConfig] = React.useState<BenchmarkConfig>({
    concurrency: 4,
    requests: 40,
    maxTokens: PROMPT_PRESETS[0].maxTokens,
    prompt: PROMPT_PRESETS[0].prompt,
  });
  const [confirmed, setConfirmed] = React.useState(false);
  const [progress, setProgress] = React.useState<{
    done: number;
    total: number;
    target: string;
  } | null>(null);
  const [runs, setRuns] = React.useState<RunRecord[]>([]);
  React.useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_HISTORY_KEY);
    } catch {
      // Storage may be disabled; nothing to remove then.
    }
  }, []);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  const selected = (compare ? targetIds.slice(0, 2) : targetIds.slice(0, 1))
    .map(id => ready.find(target => target.id === id))
    .filter((x): x is PlaygroundTarget => !!x);
  const effective = clampConfig(config);

  const runOne = async (
    target: PlaygroundTarget,
    signal: AbortSignal,
    concurrency = effective.concurrency
  ): Promise<RunRecord> => {
    const config = { ...effective, concurrency };
    const resolved = await resolveTarget(cluster, target);
    const model = resolved.models.includes(target.defaultModel)
      ? target.defaultModel
      : resolved.models[0] || target.defaultModel;
    const label = `${target.namespace}/${target.label}`;
    let done = 0;
    const progressLabel =
      concurrency !== effective.concurrency || sweep ? `${label} · ${concurrency}×` : label;
    setProgress({ done: 0, total: effective.requests, target: progressLabel });
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const results = await runPool<RequestResult>(
      config.requests,
      config.concurrency,
      async () => {
        const t0 = performance.now();
        try {
          const r = await chatCompletion(
            cluster,
            resolved,
            model,
            [{ role: 'user', content: effective.prompt }],
            {
              modelDefaults: true,
              temperature: 0,
              topP: 1,
              maxTokens: effective.maxTokens,
              stream: true,
            },
            signal
          );
          return {
            ok: true,
            ttftMs: r.ttftMs,
            totalMs: r.totalMs,
            outputTokens: r.usage.completionTokens,
          };
        } catch (err) {
          return {
            ok: false,
            totalMs: performance.now() - t0,
            error: (err as Error).message || String(err),
            aborted: signal.aborted,
          };
        }
      },
      signal,
      () => setProgress({ done: ++done, total: config.requests, target: progressLabel })
    );
    const wallMs = performance.now() - start;
    let server: ServerPeak | undefined;
    const pods = enginesOf(target, engines);
    if (prometheus.status === 'ready' && pods.length > 0) {
      const matcher = podMatcher(
        target.namespace,
        pods.map(p => p.pod)
      );
      const range = `${Math.max(30, Math.ceil(wallMs / 1000) + 15)}s`;
      const value = (samples: Array<{ value: [number, string] }>) => {
        const v = Number(samples[0]?.value[1]);
        return isFinite(v) ? v : undefined;
      };
      const [waiting, kv] = await Promise.all([
        promQuery(
          prometheus.endpoint,
          `max(max_over_time(vllm:num_requests_waiting{${matcher}}[${range}]))`,
          cluster
        ).catch(() => []),
        promQuery(
          prometheus.endpoint,
          `100 * max(max_over_time(vllm:kv_cache_usage_perc{${matcher}}[${range}]) or max_over_time(vllm:gpu_cache_usage_perc{${matcher}}[${range}]))`,
          cluster
        ).catch(() => []),
      ]);
      server = { maxWaiting: value(waiting), maxKvPercent: value(kv) };
    }
    return {
      id: `${startedAt}-${target.id}`,
      target: label,
      model,
      config,
      startedAt,
      summary: summarize(results, wallMs),
      stopped: signal.aborted,
      results,
      server,
    };
  };

  const start = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setRuns([]);
    setLevels([]);
    const done: RunRecord[] = [];
    try {
      if (sweep && selected[0]) {
        const target = selected[0];
        setSweepTarget(target);
        setSweepStopped(false);
        const measured: SweepLevel[] = [];
        for (const concurrency of sweepLevels(effective.concurrency)) {
          if (controller.signal.aborted) break;
          const run = await runOne(target, controller.signal, concurrency);
          if (run.stopped) break;
          const level = { concurrency, summary: run.summary };
          measured.push(level);
          setLevels([...measured]);
          // Past the goal more load only hurts the endpoint; stop there.
          if (!meetsGoal(level, goal)) break;
        }
        setSweepStopped(controller.signal.aborted);
        return;
      }
      // One target after the other, so they do not compete for the same GPUs or connections.
      for (const target of selected) {
        if (controller.signal.aborted) break;
        done.push(await runOne(target, controller.signal));
        setRuns([...done]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const running = progress !== null;
  const rows: Array<{ label: string; value: (r: RunRecord) => string }> = [
    { label: 'Completed / failed', value: r => `${r.summary.completed} / ${r.summary.failed}` },
    {
      label: 'TTFT p50 / p95 / p99',
      value: r =>
        `${ms(r.summary.ttftMs.p50)} / ${ms(r.summary.ttftMs.p95)} / ${ms(r.summary.ttftMs.p99)}`,
    },
    {
      label: 'Latency p50 / p95 / p99',
      value: r =>
        `${ms(r.summary.e2eMs.p50)} / ${ms(r.summary.e2eMs.p95)} / ${ms(r.summary.e2eMs.p99)}`,
    },
    { label: 'Tokens/s per request', value: r => num(r.summary.perRequestTps) },
    { label: 'Tokens/s in total', value: r => num(r.summary.totalTps) },
    { label: 'Requests/s', value: r => num(r.summary.requestsPerSecond, 2) },
    { label: 'Duration', value: r => ms(r.summary.wallMs) },
    { label: 'Server: most queued requests', value: r => num(r.server?.maxWaiting, 0) },
    {
      label: 'Server: highest KV cache use',
      value: r =>
        r.server?.maxKvPercent === undefined ? '—' : `${num(r.server.maxKvPercent, 0)}%`,
    },
  ];

  if (ready.length === 0) {
    return <Alert severity="info">{t('No ready endpoint or vLLM server to benchmark.')}</Alert>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Grid container spacing={2}>
          {[0, ...(compare ? [1] : [])].map(i => (
            <Grid item xs={12} md={compare ? 6 : 12} key={i}>
              <Box sx={{ display: 'flex' }}>
                <EndpointPicker
                  targets={ready}
                  label={compare ? t('Endpoint {{n}}', { n: i + 1 }) : t('Endpoint')}
                  value={targetIds[i]}
                  disabled={running}
                  onChange={id => setTargetIds(ids => Object.assign([...ids], { [i]: id }))}
                />
              </Box>
              <Box sx={{ mt: 1 }}>
                <GatewayAccess
                  target={ready.find(target => target.id === targetIds[i])}
                  disabled={running}
                />
              </Box>
            </Grid>
          ))}
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={compare}
                  disabled={running}
                  onChange={e => {
                    setCompare(e.target.checked);
                    if (e.target.checked) setSweep(false);
                  }}
                />
              }
              label={t('Compare two endpoints (run one after the other)')}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={sweep}
                  disabled={running}
                  onChange={e => {
                    setSweep(e.target.checked);
                    if (e.target.checked) setCompare(false);
                  }}
                />
              }
              label={t(
                'Sweep the concurrency (1, 2, 4, … up to the highest) and suggest autoscaling'
              )}
            />
          </Grid>
          {sweep && (
            <>
              <Grid item xs={6} md={4}>
                <TextField
                  type="number"
                  fullWidth
                  size="small"
                  label={t('Goal: TTFT p95 (ms)')}
                  value={goalMs}
                  disabled={running}
                  inputProps={{ min: 1 }}
                  onChange={e => setGoalMs(Number(e.target.value))}
                  helperText={t('and at most 1% failed requests')}
                />
              </Grid>
              <Grid item xs={6} md={4}>
                <TextField
                  type="number"
                  fullWidth
                  size="small"
                  label={t('Expected peak concurrent requests')}
                  value={expectedPeak}
                  disabled={running}
                  inputProps={{ min: 1 }}
                  onChange={e => setExpectedPeak(e.target.value)}
                  helperText={t('optional, to size the replicas')}
                />
              </Grid>
            </>
          )}
          <Grid item xs={12} md={4}>
            <TextField
              select
              fullWidth
              size="small"
              label={t('Prompt')}
              value={preset}
              disabled={running}
              onChange={e => {
                const p = PROMPT_PRESETS.find(x => x.id === e.target.value);
                setPreset(e.target.value);
                if (p) setConfig(c => ({ ...c, prompt: p.prompt, maxTokens: p.maxTokens }));
              }}
            >
              {PROMPT_PRESETS.map(p => (
                <MenuItem key={p.id} value={p.id}>
                  {t(p.label)}
                </MenuItem>
              ))}
              <MenuItem value="custom">{t('Custom')}</MenuItem>
            </TextField>
          </Grid>
          {(
            [
              [
                'concurrency',
                sweep ? 'Highest concurrency' : 'Concurrent requests',
                MAX_CONCURRENCY,
              ],
              ['requests', sweep ? 'Requests per level' : 'Requests in total', MAX_REQUESTS],
              ['maxTokens', 'Max tokens per answer', 32768],
            ] as const
          ).map(([key, label, max]) => (
            <Grid item xs={4} md={8 / 3} key={key}>
              <TextField
                type="number"
                fullWidth
                size="small"
                label={t(label)}
                value={config[key]}
                disabled={running}
                inputProps={{ min: 1, max }}
                onChange={e => setConfig(c => ({ ...c, [key]: Number(e.target.value) }))}
                helperText={key !== 'maxTokens' ? t('at most {{n}}', { n: max }) : undefined}
              />
            </Grid>
          ))}
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              size="small"
              label={t('Prompt text')}
              value={config.prompt}
              disabled={running}
              onChange={e => {
                setPreset('custom');
                setConfig(c => ({ ...c, prompt: e.target.value }));
              }}
            />
          </Grid>
        </Grid>
        {effective.concurrency > BROWSER_CONNECTIONS && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t(
              'Browsers open at most {{n}} connections to one host over HTTP/1.1, which Headlamp desktop uses for its local backend: above {{n}} concurrent requests the rest wait in the browser, and the measured latency includes that wait.',
              { n: BROWSER_CONNECTIONS }
            )}
          </Alert>
        )}
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t(
            'The requests reach the model servers like real traffic and go through the Kubernetes API proxy. Use the numbers to compare endpoints and settings; absolute values include the proxy.'
          )}
        </Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={confirmed}
                disabled={running}
                onChange={e => setConfirmed(e.target.checked)}
              />
            }
            label={t(
              sweep
                ? 'Send up to {{n}} requests to {{targets}}'
                : 'Send {{n}} requests to {{targets}}',
              {
                n: sweep
                  ? effective.requests * sweepLevels(effective.concurrency).length
                  : effective.requests * selected.length,
                targets: selected.map(s => `${s.namespace}/${s.label}`).join(t(' and ')) || '—',
              }
            )}
          />
          <Box sx={{ flexGrow: 1 }} />
          {running ? (
            <Button
              color="error"
              variant="outlined"
              startIcon={<Icon icon="mdi:stop" />}
              onClick={() => abortRef.current?.abort()}
            >
              {t('Stop')}
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={<Icon icon="mdi:speedometer" />}
              disabled={!confirmed || selected.length === 0 || !effective.prompt.trim()}
              onClick={start}
            >
              {t('Start')}
            </Button>
          )}
        </Box>
        {progress && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('{{target}}: {{done}} of {{total}} requests', progress)}
            </Typography>
            <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {levels.length > 0 && sweepTarget && (
        <SweepResults
          target={sweepTarget}
          levels={levels}
          goal={goal}
          replicas={enginesOf(sweepTarget, engines).length}
          expectedPeak={Number(expectedPeak) || undefined}
          prometheus={prometheus.status === 'ready' ? prometheus.endpoint : undefined}
          stopped={sweepStopped}
        />
      )}

      {runs.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
              {t('Results')}
              {runs.some(r => r.stopped) && (
                <Typography component="span" variant="body2" color="warning.main" sx={{ ml: 1 }}>
                  {t('(stopped early: requests cut off are not counted)')}
                </Typography>
              )}
            </Typography>
            <Button
              size="small"
              onClick={() =>
                download('benchmark.json', 'application/json', JSON.stringify(runs, null, 2))
              }
            >
              JSON
            </Button>
            {runs.map(r => (
              <Button
                key={r.id}
                size="small"
                onClick={() =>
                  download(
                    `benchmark-${r.target.replace('/', '-')}.csv`,
                    'text/csv',
                    toCsv(r.results)
                  )
                }
              >
                CSV {runs.length > 1 ? r.target : ''}
              </Button>
            ))}
          </Box>
          <SimpleTable
            data={rows}
            columns={[
              { label: '', getter: (row: (typeof rows)[number]) => t(row.label) },
              ...runs.map(run => ({
                label: `${run.target} (${run.model})`,
                getter: (row: (typeof rows)[number]) => row.value(run),
              })),
            ]}
          />
          <Grid container spacing={2} sx={{ mt: 1 }}>
            {runs.map(run => (
              <Grid item xs={12} md={runs.length > 1 ? 6 : 12} key={run.id}>
                <Typography variant="caption" color="text.secondary">
                  {t('Latency distribution of {{target}}', { target: run.target })}
                </Typography>
                <Histogram results={run.results} />
                {run.summary.errors.map(e => (
                  <Typography key={e.message} variant="caption" color="error" component="div">
                    {e.count} × {e.message}
                  </Typography>
                ))}
              </Grid>
            ))}
          </Grid>
        </Paper>
      )}
    </Box>
  );
}
