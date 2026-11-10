/** Instant PromQL queries of a dashboard panel, repeated every minute. */
import React from 'react';
import { InstantSample, promQuery } from '../overview/prometheus';
import { useClusterPrometheus } from '../overview/usePrometheus';

export function usePromInstant(queries: string[], enabled = true) {
  const { cluster, prom, choose } = useClusterPrometheus();
  const [state, setState] = React.useState<{ results?: InstantSample[][]; error?: string }>({});
  const endpoint = prom.status === 'ready' ? prom.endpoint : undefined;
  const key = queries.join('\n');
  React.useEffect(() => {
    if (!endpoint || !enabled) return;
    let cancelled = false;
    setState({});
    const load = () =>
      Promise.all(queries.map(q => promQuery(endpoint, q, cluster)))
        .then(results => !cancelled && setState({ results }))
        .catch(err => !cancelled && setState({ error: (err as Error).message }));
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // The queries are compared by their text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint?.base, cluster, key, enabled]);
  return { prom, choose, ...state };
}
