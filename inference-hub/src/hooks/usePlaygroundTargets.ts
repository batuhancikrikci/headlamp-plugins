import React from 'react';
import { ChatTarget } from '../api/openai';
import { ModelEndpoint } from '../resources/endpoint';
import { VllmEngine } from '../resources/engine';
import { HealthSummary } from '../utils/health';
import { ModelInfo, parseModelUri } from '../utils/modelInfo';
import { useEndpoints } from './useEndpoints';
import { useVllmEngines } from './useVllmEngines';

export interface PlaygroundTarget extends ChatTarget {
  label: string;
  model: ModelInfo;
  status: HealthSummary;
}

export function endpointTarget(ep: ModelEndpoint): PlaygroundTarget {
  return {
    id: `${ep.slug}/${ep.namespace}/${ep.name}`,
    kind: ep.kind,
    namespace: ep.namespace,
    name: ep.name,
    label: ep.name,
    defaultModel: ep.servedModelName,
    publicUrl: ep.url,
    model: ep.model,
    status: ep.status,
  };
}

export function engineTarget(engine: VllmEngine): PlaygroundTarget {
  const model = engine.servedModelName || engine.pod;
  return {
    id: `pod/${engine.namespace}/${engine.pod}`,
    kind: 'Engine',
    namespace: engine.namespace,
    name: engine.pod,
    label: engine.pod,
    defaultModel: model,
    pod: { port: engine.port, scheme: engine.scheme },
    model: parseModelUri('', model),
    status: engine.health,
  };
}

/** KServe endpoints plus vLLM engine pods that do not belong to one (e.g. llm-d Helm installs). */
export function usePlaygroundTargets() {
  const { endpoints, loading } = useEndpoints();
  const { engines, loading: enginesLoading } = useVllmEngines();
  const targets = React.useMemo(() => {
    const list = [
      ...endpoints.map(endpointTarget),
      ...engines.filter(e => !e.endpoint).map(engineTarget),
    ];
    const rank = (t: PlaygroundTarget) => (t.status.health === 'ready' ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  }, [endpoints, engines]);
  return { targets, loading: loading || enginesLoading };
}
