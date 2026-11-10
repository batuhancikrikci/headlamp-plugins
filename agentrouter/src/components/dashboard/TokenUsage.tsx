import { Icon } from '@iconify/react';
import { getCluster } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';
import {
  discoverPrometheus,
  endpointOf,
  parseService,
  PrometheusEndpoint,
  promQuery,
} from '../../api/prometheus';
import type { QuotaPolicyInterface } from '../../resources/quotaPolicy';
import { formatQuota } from '../../resources/quotaPolicy';
import {
  fill,
  ModelUsage,
  modelUsage,
  QuotaRow,
  quotaRows,
  tokenUsageQueries,
  UsageWindow,
  WINDOWS,
} from '../../utils/tokenUsage';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Services typed by hand, per cluster, for the session. */
const manual = new Map<string, PrometheusEndpoint>();

type PromState =
  | { status: 'loading' }
  | { status: 'ready'; endpoint: PrometheusEndpoint }
  | { status: 'missing'; error?: string };

function usePrometheus(): [PromState, (endpoint: PrometheusEndpoint) => void] {
  const cluster = getCluster() || '';
  const [state, setState] = React.useState<PromState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const chosen = manual.get(cluster);
    if (chosen) {
      setState({ status: 'ready', endpoint: chosen });
      return;
    }
    discoverPrometheus(cluster)
      .then(endpoint => {
        if (!cancelled) setState(endpoint ? { status: 'ready', endpoint } : { status: 'missing' });
      })
      .catch(err => {
        if (!cancelled) setState({ status: 'missing', error: (err as Error)?.message });
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, attempt]);
  const choose = (endpoint: PrometheusEndpoint) => {
    manual.set(cluster, endpoint);
    setAttempt(a => a + 1);
  };
  return [state, choose];
}

function PrometheusPicker({
  error,
  onChoose,
}: {
  error?: string;
  onChoose: (endpoint: PrometheusEndpoint) => void;
}) {
  const [text, setText] = React.useState('');
  const service = parseService(text);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        No Prometheus compatible service was found{error ? ` (${error})` : ''}. Token usage comes
        from the gen_ai_client_token_usage metrics that Agent Router exports.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          label="Prometheus service"
          placeholder="monitoring/prometheus-operated:9090"
          value={text}
          onChange={e => setText(e.target.value)}
          error={!!text && !service}
          sx={{ flexGrow: 1 }}
        />
        <Button
          variant="outlined"
          disabled={!service}
          onClick={() => service && onChoose(endpointOf(service))}
        >
          Use
        </Button>
      </Box>
    </Box>
  );
}

function useQueries<T>(
  endpoint: PrometheusEndpoint | undefined,
  queries: string[],
  build: (results: Awaited<ReturnType<typeof promQuery>>[]) => T
): { data?: T; error?: string; loading: boolean } {
  const cluster = getCluster() || '';
  const [state, setState] = React.useState<{ data?: T; error?: string; loading: boolean }>({
    loading: true,
  });
  const key = queries.join('\n');
  React.useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    Promise.all(key.split('\n').map(q => promQuery(endpoint, q, cluster)))
      .then(results => !cancelled && setState({ data: build(results), loading: false }))
      .catch(err => !cancelled && setState({ error: (err as Error).message, loading: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint?.base, key, cluster]);
  return state;
}

function UsageTable({ rows }: { rows: ModelUsage[] }) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Model</TableCell>
          <TableCell align="right">Input tokens</TableCell>
          <TableCell align="right">Output tokens</TableCell>
          <TableCell align="right">Requests</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.model}>
            <TableCell>{r.model}</TableCell>
            <TableCell align="right">{compact.format(r.input)}</TableCell>
            <TableCell align="right">{compact.format(r.output)}</TableCell>
            <TableCell align="right">{compact.format(r.requests)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Tokens and requests per model over a window, from Agent Router's GenAI metrics. */
export function TokenUsagePanel() {
  const [prom, choose] = usePrometheus();
  const [window, setWindow] = React.useState<UsageWindow>('24h');
  const queries = tokenUsageQueries(window);
  const usage = useQueries(
    prom.status === 'ready' ? prom.endpoint : undefined,
    [queries.tokens, queries.requests],
    ([tokens, requests]) => modelUsage(tokens, requests)
  );

  if (prom.status === 'loading') return <CircularProgress size={20} />;
  if (prom.status === 'missing') return <PrometheusPicker error={prom.error} onChoose={choose} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          select
          size="small"
          label="Window"
          value={window}
          onChange={e => setWindow(e.target.value as UsageWindow)}
          sx={{ width: 110 }}
        >
          {WINDOWS.map(w => (
            <MenuItem key={w} value={w}>
              {w}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" color="text.secondary">
          From {prom.endpoint.label}
        </Typography>
      </Box>
      {usage.error ? (
        <Alert severity="error">{usage.error}</Alert>
      ) : usage.loading && !usage.data ? (
        <CircularProgress size={20} />
      ) : usage.data && usage.data.length > 0 ? (
        <UsageTable rows={usage.data} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          No requests through Agent Router in the last {window}.
        </Typography>
      )}
    </Box>
  );
}

function FillBar({ used, row }: { used: number; row: QuotaRow }) {
  const share = fill(used, row.quota.limit) ?? 0;
  const tone = share >= 0.9 ? 'error' : share >= 0.7 ? 'warning' : 'success';
  return (
    <Box sx={{ minWidth: 160 }}>
      <LinearProgress
        variant="determinate"
        color={tone}
        value={Math.min(100, share * 100)}
        aria-label={`${Math.round(share * 100)}% of ${formatQuota(row.quota)}`}
      />
      <Typography variant="caption" color="text.secondary">
        {compact.format(used)} of {formatQuota(row.quota)} ({Math.round(share * 100)}%)
        {share >= 0.9 && (
          <Box component="span" sx={{ ml: 0.5, color: 'error.main' }}>
            <Icon icon="mdi:alert" width={12} /> near the limit
          </Box>
        )}
      </Typography>
    </Box>
  );
}

/**
 * Estimated fill of the QuotaPolicy default buckets and service-wide quotas. The quota service
 * does not export its counters, so this is the total tokens of the backend and model over the
 * quota window.
 */
export function QuotaUsagePanel({ policies }: { policies: QuotaPolicyInterface[] }) {
  const [prom, choose] = usePrometheus();
  const rows = quotaRows(policies);
  const estimable = rows.filter(r => r.query);
  const used = useQueries(
    prom.status === 'ready' ? prom.endpoint : undefined,
    estimable.map(r => r.query!),
    results => results.map(r => Number(r[0]?.value?.[1]) || 0)
  );

  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No QuotaPolicy limits an AIServiceBackend.
      </Typography>
    );
  }
  if (prom.status === 'loading') return <CircularProgress size={20} />;
  if (prom.status === 'missing') return <PrometheusPicker error={prom.error} onChoose={choose} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">
        Estimated from the total tokens of each backend and model over the quota window; the quota
        service keeps the exact counters.
      </Typography>
      {used.error && <Alert severity="error">{used.error}</Alert>}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Policy</TableCell>
            <TableCell>Backend · model</TableCell>
            <TableCell>Used</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell>{row.policy}</TableCell>
              <TableCell>
                {row.backend} · {row.model || 'all models'}
              </TableCell>
              <TableCell>
                {row.reason ? (
                  <Typography variant="body2" color="text.secondary">
                    {formatQuota(row.quota)}: {row.reason}
                  </Typography>
                ) : used.data ? (
                  <FillBar used={used.data[estimable.indexOf(row)]} row={row} />
                ) : (
                  <CircularProgress size={14} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
