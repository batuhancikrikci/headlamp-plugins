/**
 * A unified view of KServe InferenceService and LLMInferenceService objects.
 */
import { classifyConditions, HealthSummary } from '../utils/health';
import { ModelInfo, parseModelUri } from '../utils/modelInfo';
import { gpuCount } from '../utils/quantity';
import { Condition, KubeJson } from './types';

export type EndpointKind = 'LLMInferenceService' | 'InferenceService';
/** URL segment of the endpoint detail route. */
export type EndpointSlug = 'llm' | 'isvc';

export const STOP_ANNOTATION = 'serving.kserve.io/stop';
export const DEPLOYMENT_MODE_ANNOTATION = 'serving.kserve.io/deploymentMode';

interface ResourceRequirements {
  limits?: Record<string, string>;
  requests?: Record<string, string>;
}

export interface ContainerSpec {
  name?: string;
  image?: string;
  args?: string[];
  command?: string[];
  env?: Array<{ name: string; value?: string }>;
  resources?: ResourceRequirements;
}

interface PodTemplate {
  containers?: ContainerSpec[];
  nodeSelector?: Record<string, string>;
  tolerations?: unknown[];
}

interface Scaling {
  minReplicas?: number;
  maxReplicas?: number;
  wva?: { hpa?: unknown; keda?: unknown };
}

interface Parallelism {
  tensor?: number;
  pipeline?: number;
  data?: number;
  dataLocal?: number;
  expert?: boolean;
}

export interface LLMWorkloadSpec {
  replicas?: number;
  template?: PodTemplate;
  worker?: PodTemplate;
  parallelism?: Parallelism;
  scaling?: Scaling;
  kvCacheOffloading?: unknown;
}

export interface LLMInferenceServiceSpec extends LLMWorkloadSpec {
  model?: {
    uri?: string;
    name?: string;
    lora?: { adapters?: unknown; maxAdapters?: number };
  };
  baseRefs?: Array<{ name: string }>;
  prefill?: LLMWorkloadSpec;
  router?: {
    scheduler?: { pool?: { ref?: { name: string }; spec?: unknown }; replicas?: number };
    route?: { http?: { refs?: Array<{ name: string }>; spec?: unknown } };
    gateway?: { refs?: Array<{ name: string; namespace?: string }> };
    ingress?: unknown;
  };
  storageInitializer?: { enabled?: boolean };
}

interface WorkloadStatus {
  name?: string;
  kind?: string;
  readyReplicas?: number;
}

export interface LLMInferenceServiceStatus {
  url?: string;
  address?: { url?: string };
  addresses?: Array<{ url?: string; name?: string }>;
  conditions?: Condition[];
  appliedConfigs?: Array<{ name: string; namespace?: string; source?: string }>;
  workloads?: {
    primary?: WorkloadStatus;
    prefill?: WorkloadStatus;
    scheduler?: WorkloadStatus;
    service?: WorkloadStatus;
  };
  router?: {
    scheduler?: {
      inferencePool?: { group?: string; name?: string; namespace?: string };
      service?: { name?: string };
    };
    gateways?: Array<{
      name: string;
      namespace?: string;
      httpRoutes?: Array<{ name: string; namespace?: string }>;
    }>;
  };
}

export type LLMInferenceServiceJson = KubeJson<LLMInferenceServiceSpec, LLMInferenceServiceStatus>;

export interface PredictorModel extends ContainerSpec {
  modelFormat?: { name?: string; version?: string };
  runtime?: string;
  storageUri?: string;
  protocolVersion?: string;
}

export interface InferenceServiceSpec {
  predictor?: {
    model?: PredictorModel;
    containers?: ContainerSpec[];
    minReplicas?: number;
    maxReplicas?: number;
    scaleMetric?: string;
    scaleTarget?: number;
    workerSpec?: unknown;
    [framework: string]: unknown;
  };
  transformer?: unknown;
}

export interface InferenceServiceStatus {
  url?: string;
  address?: { url?: string };
  conditions?: Condition[];
  deploymentMode?: string;
  servingRuntimeName?: string;
  clusterServingRuntimeName?: string;
  modelStatus?: {
    transitionStatus?: string;
    states?: { activeModelState?: string; targetModelState?: string };
    lastFailureInfo?: { reason?: string; message?: string };
    copies?: { failedCopies?: number; totalCopies?: number };
  };
  components?: Record<string, { url?: string; restUrl?: string; traffic?: unknown }>;
}

export type InferenceServiceJson = KubeJson<InferenceServiceSpec, InferenceServiceStatus>;

export interface EndpointFeature {
  id: string;
  label: string;
  icon: string;
}

export interface ModelEndpoint {
  kind: EndpointKind;
  slug: EndpointSlug;
  name: string;
  namespace: string;
  apiVersion: string;
  raw: KubeJson;
  /** Model name clients send in OpenAI requests. */
  servedModelName: string;
  modelUri: string;
  model: ModelInfo;
  /** Serving engine or runtime shown to users. */
  engine: string;
  status: HealthSummary;
  url?: string;
  /** Desired decode/primary replicas (undefined when autoscaled without a fixed count). */
  replicas?: number;
  readyReplicas?: number;
  minReplicas?: number;
  maxReplicas?: number;
  /** GPU devices per primary replica. */
  gpusPerReplica: number;
  /** Estimated GPU devices of all replicas (primary + prefill). */
  totalGpus: number;
  features: EndpointFeature[];
  /** LLMInferenceServiceConfig names this endpoint builds on. */
  profiles: string[];
  createdAt?: string;
}

function mainContainer(containers?: ContainerSpec[]): ContainerSpec | undefined {
  return containers?.find(c => c.name === 'main') || containers?.[0];
}

function containerGpus(container?: ContainerSpec): number {
  return Math.max(gpuCount(container?.resources?.limits), gpuCount(container?.resources?.requests));
}

function argValue(args: string[] | undefined, flag: string): string | undefined {
  if (!args) return undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === flag) return args[i + 1];
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return undefined;
}

function isStopped(obj: KubeJson): boolean {
  return obj.metadata.annotations?.[STOP_ANNOTATION] === 'true';
}

export function fromLLMInferenceService(obj: LLMInferenceServiceJson): ModelEndpoint {
  const spec = obj.spec || {};
  const status = obj.status || {};
  const uri = spec.model?.uri || '';
  const servedModelName = spec.model?.name || obj.metadata.name;
  const gpusPerReplica = containerGpus(mainContainer(spec.template?.containers));
  const prefillGpus = containerGpus(mainContainer(spec.prefill?.template?.containers));
  const replicas = spec.replicas;
  const prefillReplicas = spec.prefill?.replicas ?? (spec.prefill ? 1 : 0);

  const features: EndpointFeature[] = [];
  if (spec.router?.scheduler) {
    features.push({ id: 'scheduler', label: 'llm-d scheduler', icon: 'mdi:source-branch' });
  }
  if (spec.prefill) {
    features.push({ id: 'pd', label: 'Prefill/decode split', icon: 'mdi:call-split' });
  }
  if (spec.worker || spec.prefill?.worker) {
    features.push({ id: 'multinode', label: 'Multi-node', icon: 'mdi:server-network' });
  }
  if ((spec.parallelism?.tensor ?? 1) > 1) {
    features.push({
      id: 'tp',
      label: `Tensor parallel ×${spec.parallelism?.tensor}`,
      icon: 'mdi:grid',
    });
  }
  if (spec.parallelism?.expert) {
    features.push({ id: 'ep', label: 'Expert parallel', icon: 'mdi:account-group-outline' });
  }
  if (spec.model?.lora) features.push({ id: 'lora', label: 'LoRA', icon: 'mdi:puzzle-outline' });
  if (spec.kvCacheOffloading) {
    features.push({ id: 'kv', label: 'KV cache offloading', icon: 'mdi:memory' });
  }
  if (spec.scaling)
    features.push({ id: 'autoscale', label: 'Autoscaling', icon: 'mdi:arrow-expand-vertical' });

  const health: HealthSummary = isStopped(obj)
    ? { health: 'stopped', reason: 'Stopped' }
    : classifyConditions(status.conditions, { createdAt: obj.metadata.creationTimestamp });

  return {
    kind: 'LLMInferenceService',
    slug: 'llm',
    name: obj.metadata.name,
    namespace: obj.metadata.namespace || '',
    apiVersion: obj.apiVersion || '',
    raw: obj,
    servedModelName,
    modelUri: uri,
    model: parseModelUri(uri, servedModelName),
    engine: spec.router?.scheduler ? 'vLLM · llm-d' : 'vLLM',
    status: health,
    url: status.url || status.address?.url || status.addresses?.[0]?.url,
    replicas,
    readyReplicas: status.workloads?.primary?.readyReplicas,
    minReplicas: spec.scaling?.minReplicas,
    maxReplicas: spec.scaling?.maxReplicas,
    gpusPerReplica,
    totalGpus:
      gpusPerReplica * (replicas ?? spec.scaling?.minReplicas ?? 1) + prefillGpus * prefillReplicas,
    features,
    profiles: (spec.baseRefs || []).map(r => r.name),
    createdAt: obj.metadata.creationTimestamp,
  };
}

export function fromInferenceService(obj: InferenceServiceJson): ModelEndpoint {
  const predictor = obj.spec?.predictor || {};
  const status = obj.status || {};
  const model = predictor.model;
  const container = model || mainContainer(predictor.containers);
  const uri =
    model?.storageUri ||
    predictor.containers?.flatMap(c => c.env || []).find(e => e.name === 'STORAGE_URI')?.value ||
    '';
  const servedModelName =
    argValue(model?.args, '--model_name') ||
    argValue(model?.args, '--served-model-name') ||
    obj.metadata.name;
  const runtime =
    model?.runtime || status.servingRuntimeName || status.clusterServingRuntimeName || '';
  const format = model?.modelFormat?.name || '';
  const engine = model
    ? [format && format[0].toUpperCase() + format.slice(1), runtime].filter(Boolean).join(' · ') ||
      'KServe'
    : 'Custom container';

  const gpusPerReplica = containerGpus(container);
  const features: EndpointFeature[] = [];
  if (predictor.workerSpec) {
    features.push({ id: 'multinode', label: 'Multi-node', icon: 'mdi:server-network' });
  }
  if (predictor.maxReplicas && predictor.maxReplicas !== predictor.minReplicas) {
    features.push({ id: 'autoscale', label: 'Autoscaling', icon: 'mdi:arrow-expand-vertical' });
  }
  if (obj.spec?.transformer) {
    features.push({ id: 'transformer', label: 'Transformer', icon: 'mdi:swap-horizontal' });
  }

  let health: HealthSummary;
  if (isStopped(obj)) {
    health = { health: 'stopped', reason: 'Stopped' };
  } else {
    health = classifyConditions(status.conditions, { createdAt: obj.metadata.creationTimestamp });
    const failure = status.modelStatus?.lastFailureInfo;
    if (
      health.health !== 'ready' &&
      (status.modelStatus?.transitionStatus === 'BlockedByFailedLoad' ||
        status.modelStatus?.transitionStatus === 'InvalidSpec' ||
        status.modelStatus?.states?.activeModelState === 'FailedToLoad')
    ) {
      health = {
        health: 'failed',
        reason: failure?.reason || status.modelStatus?.transitionStatus,
        message: failure?.message || health.message,
      };
    }
  }

  return {
    kind: 'InferenceService',
    slug: 'isvc',
    name: obj.metadata.name,
    namespace: obj.metadata.namespace || '',
    apiVersion: obj.apiVersion || '',
    raw: obj,
    servedModelName,
    modelUri: uri,
    model: parseModelUri(uri, servedModelName),
    engine,
    status: health,
    url: status.url || status.address?.url,
    replicas: predictor.minReplicas === predictor.maxReplicas ? predictor.minReplicas : undefined,
    minReplicas: predictor.minReplicas,
    maxReplicas: predictor.maxReplicas,
    gpusPerReplica,
    totalGpus: gpusPerReplica * Math.max(1, predictor.minReplicas ?? 1),
    features,
    profiles: [],
    createdAt: obj.metadata.creationTimestamp,
  };
}

export function deploymentModeOf(obj: InferenceServiceJson): string | undefined {
  return obj.status?.deploymentMode || obj.metadata.annotations?.[DEPLOYMENT_MODE_ANNOTATION];
}

/** Label selector of the pods that belong to an endpoint. */
export function podSelector(endpoint: Pick<ModelEndpoint, 'kind' | 'name'>): string {
  return endpoint.kind === 'LLMInferenceService'
    ? `app.kubernetes.io/name=${endpoint.name},app.kubernetes.io/part-of=llminferenceservice`
    : `serving.kserve.io/inferenceservice=${endpoint.name}`;
}

/** Role of a pod inside an endpoint (from KServe/llm-d labels). */
export function podRole(labels: Record<string, string> = {}): string {
  const component = labels['app.kubernetes.io/component'] || '';
  if (component.endsWith('router-scheduler')) return 'Scheduler';
  if (component.includes('prefill')) {
    return component.includes('worker') ? 'Prefill worker' : 'Prefill';
  }
  if (component.includes('workload-worker')) return 'Worker';
  if (component.includes('workload-leader')) return 'Leader';
  if (component.endsWith('workload')) {
    return labels['llm-d.ai/role'] === 'decode' ? 'Decode' : 'Model server';
  }
  const kserve = labels['component'];
  if (kserve === 'predictor') return 'Predictor';
  if (kserve === 'transformer') return 'Transformer';
  return labels['llm-d.ai/role'] ? labels['llm-d.ai/role'] : 'Pod';
}
