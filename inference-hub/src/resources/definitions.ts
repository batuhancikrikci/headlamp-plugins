/**
 * The Kubernetes APIs Inference Hub works with.
 *
 * Only API groups and resource plurals are listed here, never versions: the served version of
 * every resource is discovered per cluster at runtime (see api/discovery.ts). Some kinds moved
 * between API groups across releases, so a definition may list several candidate groups in
 * preference order (newest first); every group found in the cluster is used.
 */

export type StackId = 'kserve' | 'inference' | 'gatewayApi' | 'nvidia' | 'dra' | 'lws';

export type ResourceId =
  | 'inferenceservices'
  | 'llminferenceservices'
  | 'llminferenceserviceconfigs'
  | 'localmodelcaches'
  | 'localmodelnodes'
  | 'localmodelnodegroups'
  | 'clusterstoragecontainers'
  | 'inferencepools'
  | 'inferenceobjectives'
  | 'inferencemodelrewrites'
  | 'gateways'
  | 'httproutes'
  | 'clusterpolicies'
  | 'nvidiadrivers'
  | 'leaderworkersets'
  | 'resourceslices';

export interface ResourceDefinition {
  id: ResourceId;
  kind: string;
  /** Resource plural as served by the API server. */
  plural: string;
  /** Candidate API groups, preferred first. */
  groups: string[];
  namespaced: boolean;
  stack: StackId;
}

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  inferenceservices: {
    id: 'inferenceservices',
    kind: 'InferenceService',
    plural: 'inferenceservices',
    groups: ['serving.kserve.io'],
    namespaced: true,
    stack: 'kserve',
  },
  llminferenceservices: {
    id: 'llminferenceservices',
    kind: 'LLMInferenceService',
    plural: 'llminferenceservices',
    groups: ['serving.kserve.io'],
    namespaced: true,
    stack: 'kserve',
  },
  llminferenceserviceconfigs: {
    id: 'llminferenceserviceconfigs',
    kind: 'LLMInferenceServiceConfig',
    plural: 'llminferenceserviceconfigs',
    groups: ['serving.kserve.io'],
    namespaced: true,
    stack: 'kserve',
  },
  localmodelcaches: {
    id: 'localmodelcaches',
    kind: 'LocalModelCache',
    plural: 'localmodelcaches',
    groups: ['serving.kserve.io'],
    namespaced: false,
    stack: 'kserve',
  },
  localmodelnodes: {
    id: 'localmodelnodes',
    kind: 'LocalModelNode',
    plural: 'localmodelnodes',
    groups: ['serving.kserve.io'],
    namespaced: false,
    stack: 'kserve',
  },
  localmodelnodegroups: {
    id: 'localmodelnodegroups',
    kind: 'LocalModelNodeGroup',
    plural: 'localmodelnodegroups',
    groups: ['serving.kserve.io'],
    namespaced: false,
    stack: 'kserve',
  },
  clusterstoragecontainers: {
    id: 'clusterstoragecontainers',
    kind: 'ClusterStorageContainer',
    plural: 'clusterstoragecontainers',
    groups: ['serving.kserve.io'],
    namespaced: false,
    stack: 'kserve',
  },
  inferencepools: {
    id: 'inferencepools',
    kind: 'InferencePool',
    plural: 'inferencepools',
    // Only the GA API: KServe also mirrors pools into the experimental group, which would
    // show every pool twice.
    groups: ['inference.networking.k8s.io'],
    namespaced: true,
    stack: 'inference',
  },
  inferenceobjectives: {
    id: 'inferenceobjectives',
    kind: 'InferenceObjective',
    plural: 'inferenceobjectives',
    // Moved from the Inference Extension (<= v1.5) to the llm-d router.
    groups: ['llm-d.ai', 'inference.networking.x-k8s.io'],
    namespaced: true,
    stack: 'inference',
  },
  inferencemodelrewrites: {
    id: 'inferencemodelrewrites',
    kind: 'InferenceModelRewrite',
    plural: 'inferencemodelrewrites',
    groups: ['llm-d.ai', 'inference.networking.x-k8s.io'],
    namespaced: true,
    stack: 'inference',
  },
  gateways: {
    id: 'gateways',
    kind: 'Gateway',
    plural: 'gateways',
    groups: ['gateway.networking.k8s.io'],
    namespaced: true,
    stack: 'gatewayApi',
  },
  httproutes: {
    id: 'httproutes',
    kind: 'HTTPRoute',
    plural: 'httproutes',
    groups: ['gateway.networking.k8s.io'],
    namespaced: true,
    stack: 'gatewayApi',
  },
  clusterpolicies: {
    id: 'clusterpolicies',
    kind: 'ClusterPolicy',
    plural: 'clusterpolicies',
    groups: ['nvidia.com'],
    namespaced: false,
    stack: 'nvidia',
  },
  nvidiadrivers: {
    id: 'nvidiadrivers',
    kind: 'NVIDIADriver',
    plural: 'nvidiadrivers',
    groups: ['nvidia.com'],
    namespaced: false,
    stack: 'nvidia',
  },
  leaderworkersets: {
    id: 'leaderworkersets',
    kind: 'LeaderWorkerSet',
    plural: 'leaderworkersets',
    groups: ['leaderworkerset.x-k8s.io'],
    namespaced: true,
    stack: 'lws',
  },
  resourceslices: {
    id: 'resourceslices',
    kind: 'ResourceSlice',
    plural: 'resourceslices',
    groups: ['resource.k8s.io'],
    namespaced: false,
    stack: 'dra',
  },
};

export const RESOURCE_LIST: ResourceDefinition[] = Object.values(RESOURCES);

/** All API groups Inference Hub may use, without duplicates. */
export const ALL_GROUPS: string[] = Array.from(new Set(RESOURCE_LIST.flatMap(r => r.groups)));

export interface StackInfo {
  id: StackId;
  name: string;
  description: string;
  /** Resources whose presence means the stack is installed. */
  anyOf: ResourceId[];
  /** Short install hint shown when the stack is missing. */
  installHint: string;
  /** Copyable install command (versions resolve to the latest release). */
  installCommand?: string;
  docsUrl: string;
  optional?: boolean;
}

export const STACKS: StackInfo[] = [
  {
    id: 'kserve',
    name: 'KServe',
    description: 'Model serving: InferenceService, LLMInferenceService and the local model cache.',
    anyOf: ['inferenceservices', 'llminferenceservices', 'localmodelcaches'],
    installHint:
      'Install the KServe CRDs and controllers. LLMInferenceService needs the llmisvc charts ' +
      'in addition to the core ones.',
    installCommand: [
      'helm install kserve-crd oci://ghcr.io/kserve/charts/kserve-crd -n kserve --create-namespace',
      'helm install kserve oci://ghcr.io/kserve/charts/kserve -n kserve',
      'helm install kserve-llmisvc-crd oci://ghcr.io/kserve/charts/kserve-llmisvc-crd -n kserve',
      'helm install kserve-llmisvc oci://ghcr.io/kserve/charts/kserve-llmisvc-resources -n kserve',
    ].join('\n'),
    docsUrl: 'https://kserve.github.io/website/docs/getting-started/quickstart-guide',
  },
  {
    id: 'inference',
    name: 'Inference Extension & llm-d',
    description:
      'Model-aware routing: InferencePool, InferenceObjective and the llm-d endpoint picker.',
    anyOf: ['inferencepools', 'inferenceobjectives'],
    installHint:
      'Install the Gateway API Inference Extension CRDs. InferenceObjective and ' +
      'InferenceModelRewrite ship with the llm-d router.',
    installCommand:
      'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/latest/download/manifests.yaml',
    docsUrl: 'https://gateway-api-inference-extension.sigs.k8s.io/guides/',
  },
  {
    id: 'gatewayApi',
    name: 'Gateway API',
    description: 'Gateway and HTTPRoute resources that expose inference endpoints.',
    anyOf: ['gateways', 'httproutes'],
    installHint: 'Install the Gateway API standard channel CRDs and a Gateway controller.',
    installCommand:
      'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml',
    docsUrl: 'https://gateway-api.sigs.k8s.io/guides/',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA GPU Operator',
    description: 'GPU drivers, device plugin, GPU feature discovery and DCGM exporter.',
    anyOf: ['clusterpolicies', 'nvidiadrivers'],
    installHint: 'Install the GPU Operator with Helm on clusters with NVIDIA GPUs.',
    installCommand: [
      'helm repo add nvidia https://helm.ngc.nvidia.com/nvidia && helm repo update',
      'helm install gpu-operator nvidia/gpu-operator -n gpu-operator --create-namespace',
    ].join('\n'),
    docsUrl: 'https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/',
  },
  {
    id: 'dra',
    name: 'NVIDIA DRA driver',
    description:
      'Dynamic Resource Allocation of GPUs: the driver publishes GPUs as ResourceSlices (driver gpu.nvidia.com).',
    anyOf: ['resourceslices'],
    installHint:
      'The DRA API is part of Kubernetes; GPUs appear once the NVIDIA DRA driver is installed with GPU allocation enabled.',
    installCommand: [
      'helm install dra-driver-nvidia-gpu oci://registry.k8s.io/dra-driver-nvidia/charts/dra-driver-nvidia-gpu \\',
      '  --create-namespace --namespace dra-driver-nvidia-gpu \\',
      '  --set gpuResourcesEnabledOverride=true',
    ].join('\n'),
    docsUrl: 'https://dra-driver-nvidia-gpu.sigs.k8s.io/docs/install/',
    optional: true,
  },
  {
    id: 'lws',
    name: 'LeaderWorkerSet',
    description: 'Multi-node serving (used by LLMInferenceService worker specs).',
    anyOf: ['leaderworkersets'],
    installHint: 'Install LeaderWorkerSet if you serve models across several nodes.',
    installCommand:
      'kubectl apply --server-side -f https://github.com/kubernetes-sigs/lws/releases/latest/download/manifests.yaml',
    docsUrl: 'https://lws.sigs.k8s.io/docs/installation/',
    optional: true,
  },
];
