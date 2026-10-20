import React from 'react';
import { PrometheusEndpoint, resolvePrometheus } from '../api/prometheus';
import {
  clusterSettingsOf,
  DEFAULT_PROMETHEUS,
  PrometheusSettings,
  useSettings,
} from '../settings/settings';
import { useCurrentCluster } from './useCluster';

export type PrometheusState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string; retry: () => void }
  | { status: 'ready'; endpoint: PrometheusEndpoint; retry: () => void };

/** Resolves the Prometheus endpoint configured (or auto-discovered) for the current cluster. */
export function usePrometheus(): PrometheusState {
  const cluster = useCurrentCluster();
  const settings = useSettings();
  const prom: PrometheusSettings =
    clusterSettingsOf(settings, cluster).prometheus || DEFAULT_PROMETHEUS;
  const configKey = JSON.stringify(prom);
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<PrometheusState>({ status: 'loading' });
  const retry = React.useCallback(() => setAttempt(a => a + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    const config: PrometheusSettings = JSON.parse(configKey);
    if (config.mode === 'off') {
      setState({ status: 'off' });
      return;
    }
    setState({ status: 'loading' });
    resolvePrometheus(config, cluster, attempt > 0)
      .then(endpoint => {
        if (cancelled) return;
        setState(
          endpoint
            ? { status: 'ready', endpoint, retry }
            : {
                status: 'unavailable',
                reason:
                  config.mode === 'auto'
                    ? 'No Prometheus compatible service was found in the cluster.'
                    : 'The Prometheus endpoint is not configured.',
                retry,
              }
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'unavailable',
            reason: (err as Error)?.message || String(err),
            retry,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cluster, configKey, attempt, retry]);

  return state;
}
