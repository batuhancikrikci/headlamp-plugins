/**
 * The Prometheus service of the current cluster for the dashboards: found automatically, or
 * entered by hand for the session when none is found.
 */
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { Box, Button, TextField, Typography } from '@mui/material';
import React from 'react';
import { discoverPrometheus, endpointOf, parseService, PrometheusEndpoint } from './prometheus';

/** Services entered by hand, per cluster, for the session. */
const manual = new Map<string, PrometheusEndpoint>();

export type PromState =
  | { status: 'loading' }
  | { status: 'ready'; endpoint: PrometheusEndpoint }
  | { status: 'missing' };

export function usePrometheus(
  cluster: string
): [PromState, (endpoint: PrometheusEndpoint) => void] {
  const [state, setState] = React.useState<PromState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    const chosen = manual.get(cluster);
    if (chosen) {
      setState({ status: 'ready', endpoint: chosen });
      return;
    }
    setState({ status: 'loading' });
    discoverPrometheus(cluster)
      .then(endpoint => {
        if (!cancelled) setState(endpoint ? { status: 'ready', endpoint } : { status: 'missing' });
      })
      .catch(() => !cancelled && setState({ status: 'missing' }));
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

/** The Prometheus state of the cluster on the page. */
export function useClusterPrometheus() {
  const cluster = K8s.useCluster() || '';
  const [prom, choose] = usePrometheus(cluster);
  return { cluster, prom, choose };
}

export function ServicePicker({
  onChoose,
  needs,
}: {
  onChoose: (endpoint: PrometheusEndpoint) => void;
  /** What the panel needs from Prometheus, e.g. "the kubelet's cAdvisor metrics". */
  needs: string;
}) {
  const [text, setText] = React.useState('');
  const service = parseService(text);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        No Prometheus compatible service was found. This needs Prometheus (or Thanos, Mimir,
        VictoriaMetrics) with {needs}; enter its service to use it.
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
