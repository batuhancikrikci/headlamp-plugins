/**
 * Serving profile form: builds an LLMInferenceServiceConfig from a few common settings.
 */
import { DESCRIPTION_ANNOTATION } from '../../resources/profile';
import { KubeJson } from '../../resources/types';
import { parseQuantity } from '../../utils/quantity';

export interface ProfileForm {
  name: string;
  namespace: string;
  description: string;
  image: string;
  extraArgs: string;
  setResources: boolean;
  gpuResource: string;
  gpus: number;
  cpu: string;
  memory: string;
  gpuProduct: string;
  /** Profiles can add routing; an empty router in a base profile would not remove it. */
  routing: 'keep' | 'scheduler' | 'route';
  prefillReplicas: number;
}

export function defaultProfileForm(namespace: string): ProfileForm {
  return {
    name: '',
    namespace,
    description: '',
    image: '',
    extraArgs: '',
    setResources: false,
    gpuResource: 'nvidia.com/gpu',
    gpus: 1,
    cpu: '4',
    memory: '32Gi',
    gpuProduct: '',
    routing: 'keep',
    prefillReplicas: 0,
  };
}

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;

export function validateProfile(form: ProfileForm): ProfileErrors {
  const e: ProfileErrors = {};
  if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(form.name) || form.name.length > 253) {
    e.name = 'Use lowercase letters, digits, "-" and "."';
  }
  if (!form.namespace) e.namespace = 'Pick a namespace.';
  if (form.image && /\s/.test(form.image)) e.image = 'The image must not contain spaces.';
  if (form.setResources) {
    if (!Number.isInteger(form.gpus) || form.gpus < 0 || form.gpus > 64)
      e.gpus = 'Enter 0 to 64 GPUs.';
    const q = (v: string) => v.trim() !== '' && isFinite(parseQuantity(v)) && parseQuantity(v) > 0;
    if (!q(form.cpu)) e.cpu = 'Enter a CPU quantity.';
    if (!q(form.memory)) e.memory = 'Enter a memory quantity.';
  }
  if (!Number.isInteger(form.prefillReplicas) || form.prefillReplicas < 0) {
    e.prefillReplicas = 'Enter 0 (no prefill pool) or more.';
  }
  const hasContent =
    form.image ||
    form.extraArgs.trim() ||
    form.setResources ||
    form.gpuProduct ||
    form.routing !== 'keep' ||
    form.prefillReplicas > 0;
  if (!hasContent) e.extraArgs = 'Set at least one option; an empty profile changes nothing.';
  return e;
}

function mainContainer(form: ProfileForm) {
  const gpu = form.gpus > 0 ? { [form.gpuResource]: String(form.gpus) } : {};
  const container: Record<string, unknown> = { name: 'main' };
  if (form.image) container.image = form.image;
  if (form.extraArgs.trim())
    container.env = [{ name: 'VLLM_ADDITIONAL_ARGS', value: form.extraArgs.trim() }];
  if (form.setResources) {
    container.resources = {
      requests: { cpu: form.cpu, memory: form.memory, ...gpu },
      limits: { memory: form.memory, ...gpu },
    };
  }
  return container;
}

export function buildProfile(form: ProfileForm, apiVersion: string): KubeJson {
  const container = mainContainer(form);
  const hasContainer = Object.keys(container).length > 1;
  const template: Record<string, unknown> = {};
  if (hasContainer) template.containers = [container];
  if (form.gpuProduct) template.nodeSelector = { 'nvidia.com/gpu.product': form.gpuProduct };

  const spec: Record<string, unknown> = {};
  if (Object.keys(template).length) spec.template = template;
  if (form.setResources && form.gpus > 1) spec.parallelism = { tensor: form.gpus };
  if (form.routing === 'scheduler') spec.router = { scheduler: {}, route: {}, gateway: {} };
  if (form.routing === 'route') spec.router = { route: {}, gateway: {} };
  if (form.prefillReplicas > 0) {
    spec.prefill = {
      replicas: form.prefillReplicas,
      ...(Object.keys(template).length ? { template } : {}),
      ...(form.setResources && form.gpus > 1 ? { parallelism: { tensor: form.gpus } } : {}),
    };
  }
  return {
    apiVersion,
    kind: 'LLMInferenceServiceConfig',
    metadata: {
      name: form.name,
      namespace: form.namespace,
      labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
      ...(form.description.trim()
        ? { annotations: { [DESCRIPTION_ANNOTATION]: form.description.trim() } }
        : {}),
    },
    spec,
  };
}
