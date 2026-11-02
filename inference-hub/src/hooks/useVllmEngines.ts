import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';
import { clusterParams, ListOptions, podProxyPath } from '../api/paths';
import { detectEngines, isScrapable, VllmEngine } from '../resources/engine';
import { PodJson } from '../resources/pod';
import { featuresOf, refreshMs, useSettings } from '../settings/settings';
import { parsePromText } from '../utils/promText';
import {
  isVllmMetrics,
  metricsFromProm,
  metricsFromScrape,
  VLLM_PROM_QUERIES,
  VllmCounters,
  VllmMetrics,
} from '../utils/vllmMetrics';
import { useCurrentCluster } from './useCluster';
import { useCoreList } from './useLive';
import { PrometheusState } from './usePrometheus';
import { usePromInstant } from './usePromQuery';

/** Direct scraping is meant for small fleets; larger ones should use Prometheus. */
export const MAX_SCRAPED_ENGINES = 25;

export type MetricsSource = 'prometheus' | 'direct' | 'none';

export interface EngineMetricsState {
  metrics: Map<string, VllmMetrics>;
  errors: Map<string, string>;
  source: MetricsSource;
  /** Why no metrics are shown, when source is 'none'. */
  reason?: string;
  prometheus: PrometheusState;
  /** Engines skipped by direct scraping because of MAX_SCRAPED_ENGINES. */
  skipped: number;
}

async function scrape(cluster: string, engine: VllmEngine): Promise<string> {
  const path = `${podProxyPath(engine.namespace, engine.pod, engine.port, engine.scheme)}/metrics`;
  const response: Response = await ApiProxy.request(
    path,
    clusterParams(cluster, { isJSON: false, timeout: 10000 })
  );
  return response.text();
}

/** Scrapes /metrics of the given engines through the pod proxy and derives rates between scrapes. */
function useDirectScrape(engines: VllmEngine[], enabled: boolean, intervalMs: number) {
  const cluster = useCurrentCluster();
  const counters = React.useRef(new Map<string, VllmCounters>());
  const [state, setState] = React.useState<{
    metrics: Map<string, VllmMetrics>;
    errors: Map<string, string>;
  }>(() => ({ metrics: new Map(), errors: new Map() }));
  const targets = enabled ? engines.filter(isScrapable).slice(0, MAX_SCRAPED_ENGINES) : [];
  const key = targets.map(e => `${e.key}:${e.scheme}:${e.port}`).join(',');
  const targetsRef = React.useRef(targets);
  targetsRef.current = targets;

  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!(typeof document !== 'undefined' && document.hidden)) {
        const results = await Promise.all(
          targetsRef.current.map(async engine => {
            try {
              const text = await scrape(cluster, engine);
              const samples = parsePromText(text);
              if (!isVllmMetrics(samples)) {
                return { engine, error: 'The /metrics endpoint has no vllm:* series.' };
              }
              const { metrics, counters: next } = metricsFromScrape(
                samples,
                Date.now(),
                counters.current.get(engine.key)
              );
              counters.current.set(engine.key, next);
              return { engine, metrics };
            } catch (err) {
              return { engine, error: (err as Error)?.message || String(err) };
            }
          })
        );
        if (cancelled) return;
        const metrics = new Map<string, VllmMetrics>();
        const errors = new Map<string, string>();
        for (const r of results) {
          if (r.metrics) metrics.set(r.engine.key, r.metrics);
          if (r.error) errors.set(r.engine.key, r.error);
        }
        setState({ metrics, errors });
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cluster, key, intervalMs]);

  return {
    ...state,
    skipped: enabled ? Math.max(0, engines.filter(isScrapable).length - MAX_SCRAPED_ENGINES) : 0,
  };
}

/** Live metrics for the given engines: Prometheus when it has vLLM series, else direct scraping. */
export function useEngineMetrics(engines: VllmEngine[]): EngineMetricsState {
  const settings = useSettings();
  const features = featuresOf(settings);
  const interval = refreshMs(settings);
  const prom = usePromInstant(engines.length > 0 ? VLLM_PROM_QUERIES : null);
  const promMetrics = React.useMemo(
    () => (prom.data ? metricsFromProm(prom.data) : undefined),
    [prom.data]
  );
  const promCovers = !!promMetrics && engines.some(e => promMetrics.has(e.key));
  const promPending =
    prom.prometheus.status === 'loading' || (prom.prometheus.status === 'ready' && prom.loading);
  const scrapeEnabled = features.podMetricsScrape && !promCovers && !promPending;
  const direct = useDirectScrape(engines, scrapeEnabled, interval);

  if (promCovers && promMetrics) {
    return {
      metrics: promMetrics,
      errors: new Map(),
      source: 'prometheus',
      prometheus: prom.prometheus,
      skipped: 0,
    };
  }
  if (scrapeEnabled) {
    return {
      metrics: direct.metrics,
      errors: direct.errors,
      source: 'direct',
      prometheus: prom.prometheus,
      skipped: direct.skipped,
    };
  }
  return {
    metrics: new Map(),
    errors: new Map(),
    source: 'none',
    reason: promPending
      ? undefined
      : 'Prometheus has no vLLM metrics and reading pod metrics is disabled in Settings.',
    prometheus: prom.prometheus,
    skipped: 0,
  };
}

/** Same selector as the GPU inventory, so both share one cached pod list. */
export const ACTIVE_PODS: ListOptions = {
  fieldSelector: 'status.phase!=Succeeded,status.phase!=Failed',
};

/** vLLM engines among the pods selected by `opts` (active pods of all namespaces by default). */
export function useVllmEngines(opts: ListOptions = ACTIVE_PODS) {
  const pods = useCoreList<PodJson>('v1', 'pods', true, opts, 30000);
  const engines = React.useMemo(() => detectEngines(pods.items), [pods.items]);
  return { engines, loading: pods.loading, forbidden: pods.forbidden, error: pods.error };
}
