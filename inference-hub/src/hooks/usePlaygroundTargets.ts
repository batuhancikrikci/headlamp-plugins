import React from 'react';
import { ChatTarget } from '../api/openai';
import { routesUsingEndpoint } from '../resources/agentRouter';
import { ModelEndpoint } from '../resources/endpoint';
import { VllmEngine } from '../resources/engine';
import { GatewayPath, gatewayPathsOf } from '../resources/gatewayTargets';
import { KubeJson } from '../resources/types';
import { HealthSummary } from '../utils/health';
import { ModelInfo, parseModelUri } from '../utils/modelInfo';
import { reuseUnchanged } from '../utils/stableList';
import { useEndpoints } from './useEndpoints';
import { useResourceList } from './useLive';
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

/** The endpoint reached through a gateway: same model, different path. */
export function gatewayTarget(ep: ModelEndpoint, path: GatewayPath): PlaygroundTarget {
  const { via } = path;
  const route =
    via.source === 'agentRouter' ? `agentrouter/${via.routeName}` : `kserve/${via.pathPrefix}`;
  return {
    id: `gw/${via.namespace}/${via.name}/${route}/${ep.slug}/${ep.namespace}/${ep.name}`,
    kind: 'Gateway',
    namespace: ep.namespace,
    name: ep.name,
    label: `${ep.name} → ${via.name}${via.source === 'agentRouter' ? ' (Agent Router)' : ''}`,
    defaultModel: path.model,
    gateway: via,
    model: ep.model,
    status: ep.status,
  };
}

/**
 * KServe endpoints, each also through the gateways that publish it (KServe routes and Agent
 * Router routes), plus vLLM engine pods that do not belong to an endpoint (e.g. llm-d Helm
 * installs).
 */
export function usePlaygroundTargets() {
  const { endpoints, loading } = useEndpoints();
  const { engines, loading: enginesLoading } = useVllmEngines();
  const httpRoutes = useResourceList<KubeJson>('httproutes', {}, 60000);
  const aiRoutes = useResourceList<KubeJson>('aigatewayroutes', {}, 60000);
  const aiBackends = useResourceList<KubeJson>('aiservicebackends', {}, 60000);
  const previous = React.useRef<PlaygroundTarget[]>([]);
  const built = React.useMemo(() => {
    const viaGateways = endpoints.flatMap(ep =>
      gatewayPathsOf(
        ep,
        httpRoutes.items,
        routesUsingEndpoint(aiRoutes.items, ep.raw, aiBackends.items)
      ).map(path => gatewayTarget(ep, path))
    );
    const list = [
      ...endpoints.map(endpointTarget),
      ...viaGateways,
      ...engines.filter(e => !e.endpoint).map(engineTarget),
    ];
    const rank = (t: PlaygroundTarget) => (t.status.health === 'ready' ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  }, [endpoints, engines, httpRoutes.items, aiRoutes.items, aiBackends.items]);
  // The lists refresh in the background: keep the objects that did not change, so an open picker
  // keeps what the user typed and selected.
  const targets = React.useMemo(() => reuseUnchanged(previous.current, built), [built]);
  previous.current = targets;
  return { targets, loading: loading || enginesLoading };
}

/** The endpoint id ("slug/namespace/name") a target talks to, also through a gateway. */
export function endpointIdOf(target: ChatTarget): string {
  if (target.gateway) return target.gateway.endpointId;
  const slug =
    target.kind === 'LLMInferenceService' ? 'llm' : target.kind === 'Engine' ? 'pod' : 'isvc';
  return `${slug}/${target.namespace}/${target.name}`;
}
