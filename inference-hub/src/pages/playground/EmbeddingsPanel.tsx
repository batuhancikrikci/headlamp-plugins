import { Icon } from '@iconify/react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import React from 'react';
import {
  ChatError,
  createEmbeddings,
  EmbeddingsResult,
  isPoolingTaskError,
  rerankDocuments,
  RerankResult,
  ResolvedTarget,
  resolveTarget,
} from '../../api/openai';
import { t } from '../../common/i18n';
import { GatewayAccess } from '../../components/playground/GatewayAccess';
import { useCurrentCluster } from '../../hooks/useCluster';
import { PlaygroundTarget } from '../../hooks/usePlaygroundTargets';
import { norm, similarityMatrix } from '../../utils/vectors';

const EXAMPLE_TEXTS = [
  'How do I reset my password?',
  'I forgot my login password and cannot sign in.',
  'What are the opening hours of the store?',
  'When does the shop open on Saturday?',
].join('\n');

const EXAMPLE_QUERY = 'Which GPU has the most memory?';
const EXAMPLE_DOCUMENTS = [
  'The NVIDIA B200 has 192 GB of HBM3e memory.',
  'Kubernetes schedules pods onto nodes.',
  'The H100 SXM comes with 80 GB of HBM3.',
  'Coffee is best brewed at around 93 °C.',
].join('\n');

/** Up to this many lines are sent in one request. */
const MAX_LINES = 32;

type Mode = 'embeddings' | 'rerank';

function lines(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
}

function short(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function explain(error: string, mode: Mode): string {
  if (!isPoolingTaskError(error)) return error;
  return `${error} ${
    mode === 'embeddings'
      ? t(
          'The model does not seem to serve embeddings: use an embedding model (for example Qwen3-Embedding or bge-m3); vLLM serves them with --runner pooling.'
        )
      : t(
          'The model does not seem to serve reranking: use a reranker or cross-encoder (for example bge-reranker or Qwen3-Reranker); vLLM serves them with --runner pooling.'
        )
  }`;
}

function SimilarityTable({ texts, result }: { texts: string[]; result: EmbeddingsResult }) {
  const matrix = similarityMatrix(result.vectors);
  // The most similar pair of different texts.
  let best: [number, number] | null = null;
  matrix.forEach((row, i) =>
    row.forEach((v, j) => {
      if (j > i && (!best || v > matrix[best[0]][best[1]])) best = [i, j];
    })
  );
  const pair = best as [number, number] | null;
  const dims = result.vectors[0]?.length || 0;
  const length = result.vectors[0] ? norm(result.vectors[0]) : 0;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {[
          t('{{n}} vectors of {{d}} dimensions', { n: result.vectors.length, d: dims }),
          t('length {{v}}', { v: length.toFixed(3) }),
          result.promptTokens !== undefined ? t('{{v}} tokens', { v: result.promptTokens }) : null,
          t('{{v}} ms', { v: Math.round(result.totalMs) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      {pair && texts.length > 2 && (
        <Typography variant="body2">
          {t('Most similar: #{{a}} and #{{b}} ({{v}})', {
            a: pair[0] + 1,
            b: pair[1] + 1,
            v: matrix[pair[0]][pair[1]].toFixed(3),
          })}
        </Typography>
      )}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={t('Cosine similarity')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('Text')}</TableCell>
              {texts.map((_, j) => (
                <TableCell key={j} align="center">
                  #{j + 1}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {texts.map((text, i) => (
              <TableRow key={i}>
                <TableCell sx={{ maxWidth: 320 }}>
                  <Tooltip title={text}>
                    <span>
                      #{i + 1} {short(text)}
                    </span>
                  </Tooltip>
                </TableCell>
                {matrix[i].map((v, j) => (
                  <TableCell
                    key={j}
                    align="center"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      // One hue, darker for more similar pairs; the diagonal stays plain.
                      bgcolor: theme =>
                        i === j
                          ? undefined
                          : alpha(theme.palette.primary.main, Math.max(0, v) * 0.35),
                      color: i === j ? 'text.secondary' : undefined,
                    }}
                  >
                    {v.toFixed(3)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t(
          'Cosine similarity of every pair: 1 means the same direction. Similar texts should score clearly higher than unrelated ones.'
        )}
      </Typography>
    </Box>
  );
}

function RerankTable({ documents, result }: { documents: string[]; result: RerankResult }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {[
          result.promptTokens !== undefined ? t('{{v}} tokens', { v: result.promptTokens }) : null,
          t('{{v}} ms', { v: Math.round(result.totalMs) }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Table size="small" aria-label={t('Reranked documents')}>
        <TableHead>
          <TableRow>
            <TableCell>{t('Rank')}</TableCell>
            <TableCell>{t('Relevance')}</TableCell>
            <TableCell>{t('Document')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {result.results.map((r, rank) => (
            <TableRow key={r.index}>
              <TableCell>{rank + 1}</TableCell>
              <TableCell sx={{ minWidth: 160 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(0, Math.min(1, r.score)) * 100}
                    sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
                    aria-hidden
                  />
                  <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.score.toFixed(3)}
                  </Typography>
                </Box>
              </TableCell>
              <TableCell>
                #{r.index + 1} {documents[r.index] ?? ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/** Embeddings and rerank test against an endpoint that serves a pooling model. */
export function EmbeddingsPanel({
  targets,
  initialTargetId,
}: {
  targets: PlaygroundTarget[];
  initialTargetId?: string | null;
}) {
  const cluster = useCurrentCluster();
  const ready = targets.filter(target => target.status.health === 'ready');
  const [targetId, setTargetId] = React.useState<string>(
    () => ready.find(target => target.id === initialTargetId)?.id || ready[0]?.id || ''
  );
  const target = ready.find(x => x.id === targetId);
  const [resolved, setResolved] = React.useState<ResolvedTarget | null>(null);
  const [resolveError, setResolveError] = React.useState<string | null>(null);
  const [model, setModel] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('embeddings');
  const [texts, setTexts] = React.useState(EXAMPLE_TEXTS);
  const [query, setQuery] = React.useState(EXAMPLE_QUERY);
  const [documents, setDocuments] = React.useState(EXAMPLE_DOCUMENTS);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [embedded, setEmbedded] = React.useState<{
    texts: string[];
    result: EmbeddingsResult;
  } | null>(null);
  const [reranked, setReranked] = React.useState<{
    documents: string[];
    result: RerankResult;
  } | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setResolved(null);
    setResolveError(null);
    if (!target) return;
    let cancelled = false;
    resolveTarget(cluster, target)
      .then(r => {
        if (cancelled) return;
        setResolved(r);
        setModel(r.models.includes(target.defaultModel) ? target.defaultModel : r.models[0] || '');
      })
      .catch((err: ChatError) => !cancelled && setResolveError(err.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, targetId]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const inputs = mode === 'embeddings' ? lines(texts) : lines(documents);
  const canRun =
    !!resolved &&
    !!model &&
    !running &&
    inputs.length > 0 &&
    (mode === 'embeddings' || !!query.trim());

  const run = async () => {
    if (!resolved || !canRun) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      if (mode === 'embeddings') {
        const result = await createEmbeddings(cluster, resolved, model, inputs, controller.signal);
        setEmbedded({ texts: inputs, result });
      } else {
        const result = await rerankDocuments(
          cluster,
          resolved,
          model,
          query.trim(),
          inputs,
          controller.signal
        );
        setReranked({ documents: inputs, result });
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(explain((err as Error).message, mode));
    } finally {
      setRunning(false);
    }
  };

  if (ready.length === 0) {
    return <Alert severity="info">{t('No ready endpoint or vLLM server to test.')}</Alert>;
  }

  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={5}>
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select
            size="small"
            label={t('Endpoint')}
            value={targetId}
            disabled={running}
            onChange={e => setTargetId(e.target.value)}
          >
            {ready.map(x => (
              <MenuItem key={x.id} value={x.id}>
                {x.namespace}/{x.label} · {x.defaultModel}
              </MenuItem>
            ))}
          </TextField>
          <GatewayAccess target={target} disabled={running} />
          {resolveError ? (
            <Alert severity="error">{resolveError}</Alert>
          ) : !resolved ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t('Connecting to the model server…')}</Typography>
            </Box>
          ) : (
            <TextField
              select
              size="small"
              label={t('Model')}
              value={resolved.models.includes(model) ? model : ''}
              disabled={running || resolved.models.length === 0}
              onChange={e => setModel(e.target.value)}
            >
              {resolved.models.map(m => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, v) => v && setMode(v)}
            aria-label={t('Test')}
          >
            <ToggleButton value="embeddings">{t('Embeddings')}</ToggleButton>
            <ToggleButton value="rerank">{t('Rerank')}</ToggleButton>
          </ToggleButtonGroup>
          {mode === 'embeddings' ? (
            <TextField
              label={t('Texts, one per line')}
              multiline
              minRows={6}
              maxRows={16}
              value={texts}
              onChange={e => setTexts(e.target.value)}
              helperText={t('Up to {{n}} lines; each is embedded and compared with the others.', {
                n: MAX_LINES,
              })}
            />
          ) : (
            <>
              <TextField
                size="small"
                label={t('Query')}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <TextField
                label={t('Documents, one per line')}
                multiline
                minRows={6}
                maxRows={16}
                value={documents}
                onChange={e => setDocuments(e.target.value)}
                helperText={t('Up to {{n}} lines, ordered by relevance to the query.', {
                  n: MAX_LINES,
                })}
              />
            </>
          )}
          <Box>
            <Button
              variant="contained"
              startIcon={<Icon icon={mode === 'embeddings' ? 'mdi:vector-triangle' : 'mdi:sort'} />}
              disabled={!canRun}
              onClick={run}
            >
              {mode === 'embeddings' ? t('Embed') : t('Rerank')}
            </Button>
          </Box>
        </Paper>
      </Grid>
      <Grid item xs={12} md={7}>
        <Paper variant="outlined" sx={{ p: 2, minHeight: 240 }}>
          {running && <LinearProgress sx={{ mb: 2 }} />}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {mode === 'embeddings' && embedded ? (
            <SimilarityTable texts={embedded.texts} result={embedded.result} />
          ) : mode === 'rerank' && reranked ? (
            <RerankTable documents={reranked.documents} result={reranked.result} />
          ) : (
            !running &&
            !error && (
              <Typography variant="body2" color="text.secondary">
                {mode === 'embeddings'
                  ? t(
                      'Embeds the texts with an embedding model (/v1/embeddings) and shows how similar they are to each other.'
                    )
                  : t(
                      'Orders the documents by relevance to the query with a reranker (/v1/rerank).'
                    )}
              </Typography>
            )
          )}
        </Paper>
      </Grid>
    </Grid>
  );
}
