/**
 * Deploy Model wizard: form state, validation and generation of the Kubernetes objects.
 * Everything here is pure so it can be unit tested.
 */
import { KubeJson } from '../../resources/types';
import { uriScheme } from '../../utils/modelInfo';
import { parseQuantity } from '../../utils/quantity';

export type DeployMode = 'llm' | 'isvc';
/** LLMInferenceService routing: llm-d scheduler, plain HTTPRoute, or in-cluster service only. */
export type RoutingMode = 'scheduler' | 'route' | 'none';
export type IsvcDeploymentMode = '' | 'Standard' | 'Knative';

export interface CacheOption {
  /** LocalModelCache name */
  name: string;
  uri: string;
  modelSize?: string;
  nodeGroups: string[];
}

export interface DeployForm {
  // Source
  source: 'catalog' | 'custom';
  cacheName: string;
  uri: string;
  servedModelName: string;
  /** Create a LocalModelCache for a custom URI. */
  addToCatalog: boolean;
  catalogModelSize: string;
  catalogNodeGroups: string[];
  // Identity
  name: string;
  namespace: string;
  // Serving
  mode: DeployMode;
  routing: RoutingMode;
  gatewayName: string;
  gatewayNamespace: string;
  profiles: string[];
  prefillDecode: boolean;
  prefillReplicas: number;
  isvcDeploymentMode: IsvcDeploymentMode;
  runtime: string;
  image: string;
  extraArgs: string;
  serviceAccountName: string;
  // Resources
  gpuResource: string;
  gpus: number;
  cpu: string;
  memory: string;
  nodeSelector: Record<string, string>;
  // Scaling
  autoscale: boolean;
  replicas: number;
  minReplicas: number;
  maxReplicas: number;
}

export function defaultForm(namespace: string): DeployForm {
  return {
    source: 'catalog',
    cacheName: '',
    uri: '',
    servedModelName: '',
    addToCatalog: false,
    catalogModelSize: '',
    catalogNodeGroups: [],
    name: '',
    namespace,
    mode: 'llm',
    routing: 'scheduler',
    gatewayName: '',
    gatewayNamespace: '',
    profiles: [],
    prefillDecode: false,
    prefillReplicas: 1,
    isvcDeploymentMode: '',
    runtime: '',
    image: '',
    extraArgs: '',
    serviceAccountName: '',
    gpuResource: 'nvidia.com/gpu',
    gpus: 1,
    cpu: '4',
    memory: '32Gi',
    nodeSelector: {},
    autoscale: false,
    replicas: 1,
    minReplicas: 1,
    maxReplicas: 3,
  };
}

export const STEPS = ['source', 'serving', 'resources', 'scaling', 'review'] as const;
export type StepId = (typeof STEPS)[number];

export type Errors = Partial<Record<keyof DeployForm, string>>;

const DNS_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const SUPPORTED_SCHEMES = ['hf', 's3', 'gs', 'pvc', 'oci', 'http', 'https', 'azure'];

/**
 * Suggests a DNS-1035 resource name from a model name. Dots are dropped (version numbers stay
 * together) and other invalid characters become "-", e.g. "Qwen/Qwen3.8-27B" -> "qwen38-27b".
 */
export function suggestName(model: string): string {
  const base = model.split('/').pop() || model;
  return (
    base
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[^a-z]+/, '')
      .replace(/-+$/, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'model'
  );
}

/** Served model name suggestion for a URI: "org/name" for Hugging Face, else the last segment. */
export function suggestServedName(uri: string): string {
  const path = uri.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/\/+$/, '');
  if (uriScheme(uri) === 'hf') return path.split('@')[0].split('/').slice(0, 2).join('/');
  return path.split('/').pop()?.split(':')[0] || '';
}

export function validateUri(uri: string): string | undefined {
  const value = uri.trim();
  if (!value) return 'Enter the model storage URI.';
  const scheme = /^([a-z0-9+.-]+):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (!scheme || !SUPPORTED_SCHEMES.includes(scheme === 'huggingface' ? 'hf' : scheme)) {
    return 'Use one of hf://, s3://, gs://, pvc://, oci://, https:// or azure://.';
  }
  const rest = value.slice(scheme.length + 3);
  if (!rest || rest.startsWith('/')) return 'The URI has no path.';
  if (uriScheme(value) === 'hf' && rest.split('/').filter(Boolean).length < 2) {
    return 'Hugging Face URIs look like hf://<organization>/<model>.';
  }
  if (/\s/.test(value)) return 'The URI must not contain spaces.';
  return undefined;
}

function validQuantity(v: string) {
  return v.trim() !== '' && isFinite(parseQuantity(v)) && parseQuantity(v) > 0;
}

export function validateStep(step: StepId, form: DeployForm): Errors {
  const e: Errors = {};
  if (step === 'source' || step === 'review') {
    if (form.source === 'catalog' && !form.cacheName)
      e.cacheName = 'Pick a model from the catalog.';
    const uriError = validateUri(form.uri);
    if (uriError) e.uri = uriError;
    if (!form.servedModelName.trim()) e.servedModelName = 'Enter the model name clients will use.';
    if (!form.name) e.name = 'Enter a name.';
    else if (!DNS_LABEL.test(form.name) || form.name.length > 63) {
      e.name = 'Use lowercase letters, digits and "-", starting with a letter (max 63).';
    }
    if (!form.namespace) e.namespace = 'Pick a namespace.';
    if (form.source === 'custom' && form.addToCatalog) {
      if (!validQuantity(form.catalogModelSize))
        e.catalogModelSize = 'Enter the model size, e.g. 20Gi.';
      if (form.catalogNodeGroups.length === 0)
        e.catalogNodeGroups = 'Pick at least one node group.';
    }
  }
  if (step === 'serving' || step === 'review') {
    if (
      form.mode === 'llm' &&
      form.prefillDecode &&
      (!Number.isInteger(form.prefillReplicas) || form.prefillReplicas < 1)
    ) {
      e.prefillReplicas = 'Prefill replicas must be at least 1.';
    }
    if (form.gatewayName && !DNS_LABEL.test(form.gatewayName.replace(/\./g, '-'))) {
      e.gatewayName = 'Invalid gateway name.';
    }
    if (form.image && /\s/.test(form.image)) e.image = 'The image must not contain spaces.';
  }
  if (step === 'resources' || step === 'review') {
    if (!Number.isInteger(form.gpus) || form.gpus < 0 || form.gpus > 64)
      e.gpus = 'Enter 0 to 64 GPUs.';
    if (!validQuantity(form.cpu)) e.cpu = 'Enter a CPU quantity, e.g. 4 or 500m.';
    if (!validQuantity(form.memory)) e.memory = 'Enter a memory quantity, e.g. 32Gi.';
  }
  if (step === 'scaling' || step === 'review') {
    if (form.autoscale) {
      if (!Number.isInteger(form.minReplicas) || form.minReplicas < 0)
        e.minReplicas = 'Minimum must be 0 or more.';
      if (!Number.isInteger(form.maxReplicas) || form.maxReplicas < Math.max(1, form.minReplicas)) {
        e.maxReplicas = 'Maximum must be at least the minimum (and at least 1).';
      }
    } else if (!Number.isInteger(form.replicas) || form.replicas < 1) {
      e.replicas = 'Replicas must be at least 1.';
    }
  }
  return e;
}

export interface ApiVersions {
  llm?: string;
  isvc?: string;
  cache?: string;
}

function resources(form: DeployForm) {
  const gpu = form.gpus > 0 ? { [form.gpuResource]: String(form.gpus) } : {};
  return {
    requests: { cpu: form.cpu, memory: form.memory, ...gpu },
    limits: { memory: form.memory, ...gpu },
  };
}

function splitArgs(args: string): string[] {
  return (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map(a =>
    a.replace(/^(['"])(.*)\1$/, '$2')
  );
}

function llmContainer(form: DeployForm) {
  return {
    name: 'main',
    ...(form.image ? { image: form.image } : {}),
    ...(form.extraArgs.trim()
      ? { env: [{ name: 'VLLM_ADDITIONAL_ARGS', value: form.extraArgs.trim() }] }
      : {}),
    resources: resources(form),
  };
}

function router(form: DeployForm) {
  const gateway = form.gatewayName
    ? {
        refs: [
          {
            name: form.gatewayName,
            ...(form.gatewayNamespace ? { namespace: form.gatewayNamespace } : {}),
          },
        ],
      }
    : {};
  switch (form.routing) {
    case 'scheduler':
      return { scheduler: {}, route: {}, gateway };
    case 'route':
      return { route: {}, gateway };
    default:
      return undefined;
  }
}

export function buildLLMInferenceService(form: DeployForm, apiVersion: string): KubeJson {
  const podExtras = {
    ...(Object.keys(form.nodeSelector).length ? { nodeSelector: form.nodeSelector } : {}),
    ...(form.serviceAccountName ? { serviceAccountName: form.serviceAccountName } : {}),
  };
  const r = router(form);
  const spec: Record<string, unknown> = {
    model: { uri: form.uri.trim(), name: form.servedModelName.trim() },
    ...(form.profiles.length ? { baseRefs: form.profiles.map(name => ({ name })) } : {}),
    // spec.replicas and spec.scaling are mutually exclusive.
    ...(form.autoscale
      ? { scaling: { minReplicas: form.minReplicas, maxReplicas: form.maxReplicas } }
      : { replicas: form.replicas }),
    ...(form.gpus > 1 ? { parallelism: { tensor: form.gpus } } : {}),
    ...(r ? { router: r } : {}),
    template: { ...podExtras, containers: [llmContainer(form)] },
  };
  if (form.prefillDecode) {
    spec.prefill = {
      replicas: form.prefillReplicas,
      ...(form.gpus > 1 ? { parallelism: { tensor: form.gpus } } : {}),
      template: { ...podExtras, containers: [llmContainer(form)] },
    };
  }
  return {
    apiVersion,
    kind: 'LLMInferenceService',
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
    },
    spec,
  };
}

export function buildInferenceService(form: DeployForm, apiVersion: string): KubeJson {
  const args = splitArgs(form.extraArgs);
  const hasModelName = args.some(a => a.startsWith('--model_name'));
  return {
    apiVersion,
    kind: 'InferenceService',
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
      ...(form.isvcDeploymentMode
        ? { annotations: { 'serving.kserve.io/deploymentMode': form.isvcDeploymentMode } }
        : {}),
    },
    spec: {
      predictor: {
        ...(form.autoscale
          ? { minReplicas: form.minReplicas, maxReplicas: form.maxReplicas }
          : { minReplicas: form.replicas, maxReplicas: form.replicas }),
        ...(Object.keys(form.nodeSelector).length ? { nodeSelector: form.nodeSelector } : {}),
        ...(form.serviceAccountName ? { serviceAccountName: form.serviceAccountName } : {}),
        model: {
          modelFormat: { name: 'huggingface' },
          ...(form.runtime ? { runtime: form.runtime } : {}),
          ...(form.image ? { image: form.image } : {}),
          storageUri: form.uri.trim(),
          args: [...(hasModelName ? [] : [`--model_name=${form.servedModelName.trim()}`]), ...args],
          resources: resources(form),
        },
      },
    },
  };
}

export function buildLocalModelCache(form: DeployForm, apiVersion: string): KubeJson {
  return {
    apiVersion,
    kind: 'LocalModelCache',
    metadata: { name: form.name, labels: { 'app.kubernetes.io/managed-by': 'inference-hub' } },
    spec: {
      sourceModelUri: form.uri.trim(),
      modelSize: form.catalogModelSize,
      nodeGroups: form.catalogNodeGroups,
    },
  };
}

/** All objects the wizard creates, in apply order (the cache first so the endpoint can use it). */
export function buildObjects(form: DeployForm, versions: ApiVersions): KubeJson[] {
  const objects: KubeJson[] = [];
  if (form.source === 'custom' && form.addToCatalog && versions.cache) {
    objects.push(buildLocalModelCache(form, versions.cache));
  }
  if (form.mode === 'llm' && versions.llm)
    objects.push(buildLLMInferenceService(form, versions.llm));
  if (form.mode === 'isvc' && versions.isvc)
    objects.push(buildInferenceService(form, versions.isvc));
  return objects;
}

/** Total GPUs of one deployment: decode/primary replicas plus prefill replicas. */
export function totalGpus(form: DeployForm): number {
  const primary = form.autoscale ? Math.max(1, form.minReplicas) : form.replicas;
  const prefill = form.mode === 'llm' && form.prefillDecode ? form.prefillReplicas : 0;
  return form.gpus * (primary + prefill);
}
