/** Short introductions and upstream documentation for the kinds Inference Hub edits. */

import type { KindDoc } from '../../common/docs/kindDocs';

export const KIND_DOCS: Record<string, KindDoc> = {
  LLMInferenceService: {
    summary:
      'Serves a large language model with vLLM. Optional llm-d routing (InferencePool and endpoint picker), prefill/decode disaggregation, multi-node workers and autoscaling. Fields left empty come from the referenced LLMInferenceServiceConfigs (spec.baseRefs) and the KServe presets.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/llmisvc/llmisvc-configuration',
  },
  LLMInferenceServiceConfig: {
    summary:
      'A reusable, partial LLMInferenceService spec. Services list configs in spec.baseRefs and inherit their fields; fields set on the service win.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/llmisvc/llmisvc-configuration',
  },
  InferenceService: {
    summary:
      'Serves a model with a KServe runtime (for LLMs usually the Hugging Face runtime with its vLLM backend). spec.predictor describes the model, its storage URI, resources and scaling.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/overview',
  },
  LocalModelCache: {
    summary:
      'Pre-downloads a model to the nodes of the listed LocalModelNodeGroups. Endpoints whose model URI equals sourceModelUri start from the local copy. sourceModelUri is immutable.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/modelcache/localmodel',
  },
  LocalModelNodeGroup: {
    summary:
      'A set of nodes (selected by the persistent volume node affinity) and the local volume where cached models are stored, with a storage limit.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/modelcache/localmodel',
  },
  LocalModelNode: {
    summary: 'Managed by KServe: the models a node should cache and their download status.',
    url: 'https://kserve.github.io/website/docs/model-serving/generative-inference/modelcache/localmodel',
  },
  ClusterStorageContainer: {
    summary:
      'A container that downloads model artifacts for URIs matching its prefixes or regular expressions, run as an init container or a download job.',
    url: 'https://kserve.github.io/website/docs/model-serving/storage/storage-containers',
  },
  InferencePool: {
    summary:
      'A group of model server pods (selector and target ports) behind an endpoint picker that routes each request to the best pod. HTTPRoutes use it as a backend.',
    url: 'https://gateway-api-inference-extension.sigs.k8s.io/api-types/inferencepool/',
  },
  InferenceObjective: {
    summary:
      'Serving objectives for requests to an InferencePool, such as priority when the pool is saturated.',
    url: 'https://github.com/llm-d/llm-d-router',
  },
  InferenceModelRewrite: {
    summary:
      'Rewrites the model name of requests to an InferencePool, for example to split traffic between model versions or LoRA adapters by weight.',
    url: 'https://github.com/llm-d/llm-d-router',
  },
  ClusterPolicy: {
    summary: 'Configuration of the NVIDIA GPU Operator and its components on all GPU nodes.',
    url: 'https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/',
  },
  NVIDIADriver: {
    summary: 'Driver configuration of the GPU Operator for a set of nodes.',
    url: 'https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/',
  },
};
