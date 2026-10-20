import React from 'react';
import { ApiError } from '../api/liveStore';
import {
  fromInferenceService,
  fromLLMInferenceService,
  InferenceServiceJson,
  LLMInferenceServiceJson,
  ModelEndpoint,
} from '../resources/endpoint';
import { clusterSettingsOf, useSettings } from '../settings/settings';
import { useCurrentCluster } from './useCluster';
import { useResourceList } from './useLive';

export interface EndpointsResult {
  endpoints: ModelEndpoint[];
  loading: boolean;
  /** Neither InferenceService nor LLMInferenceService is served. */
  notInstalled: boolean;
  llmServed: boolean;
  isvcServed: boolean;
  errors: ApiError[];
  forbidden: boolean;
}

/** All model endpoints (LLMInferenceService + InferenceService) of the cluster. */
export function useEndpoints(): EndpointsResult {
  const llm = useResourceList<LLMInferenceServiceJson>('llminferenceservices');
  const isvc = useResourceList<InferenceServiceJson>('inferenceservices');

  const endpoints = React.useMemo(
    () => [...llm.items.map(fromLLMInferenceService), ...isvc.items.map(fromInferenceService)],
    [llm.items, isvc.items]
  );

  const served = [llm, isvc].filter(r => !r.notInstalled);
  return {
    endpoints,
    loading: llm.loading || isvc.loading,
    notInstalled: llm.notInstalled && isvc.notInstalled,
    llmServed: !llm.notInstalled,
    isvcServed: !isvc.notInstalled,
    errors: [...llm.errors, ...isvc.errors],
    forbidden: served.length > 0 && served.every(r => r.forbidden),
  };
}

/** Namespace preselected for create flows: the setting, else "default". */
export function useDefaultNamespace(): string {
  const cluster = useCurrentCluster();
  const settings = useSettings();
  return clusterSettingsOf(settings, cluster).defaultNamespace || 'default';
}
