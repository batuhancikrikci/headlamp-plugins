/**
 * Form model, validation and spec generation for GatewayConfig. Pure, unit tested.
 *
 * Upstream rules (API v1.1.0):
 * - extProc.kubernetes is Envoy Gateway's KubernetesContainerSpec (image, resources, env, ...).
 *   `image` must match ^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._-]+)?(@sha256:[a-z0-9]+)?$.
 * - globalLLMRequestCosts is a list map keyed by metadataKey; routes override by key.
 * - forwardProxy.address is "host:port" (port required).
 * - A Gateway selects the config with the annotation aigateway.envoyproxy.io/gateway-config,
 *   and must be in the same namespace.
 */
import { costErrors, CostForm, toLLMRequestCosts } from '../../utils/costForm';
import { validateName } from '../../utils/forms';

export const GATEWAY_CONFIG_ANNOTATION = 'aigateway.envoyproxy.io/gateway-config';

export type EnvSource = 'value' | 'secret' | 'configMap';

export interface EnvForm {
  name: string;
  source: EnvSource;
  value: string;
  refName: string;
  refKey: string;
}

export interface GatewayConfigForm {
  name: string;
  namespace: string;
  gateways: string[];
  image: string;
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
  env: EnvForm[];
  costs: CostForm[];
  forwardProxy: string;
}

export const newEnv = (): EnvForm => ({
  name: '',
  source: 'value',
  value: '',
  refName: '',
  refKey: '',
});

export const newGatewayConfigForm = (): GatewayConfigForm => ({
  name: '',
  namespace: 'default',
  gateways: [],
  image: '',
  cpuRequest: '',
  memoryRequest: '',
  cpuLimit: '',
  memoryLimit: '',
  env: [],
  costs: [],
  forwardProxy: '',
});

const IMAGE = /^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._-]+)?(@sha256:[a-z0-9]+)?$/;
const QUANTITY = /^([+-]?[0-9.]+)([eEinumkKMGTP]*[-+]?[0-9]*)$/;
const ENV_NAME = /^[-._a-zA-Z][-._a-zA-Z0-9]*$/;
const CONFIG_KEY = /^[-._a-zA-Z0-9]+$/;
const HOST_PORT = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):([0-9]{1,5})$/;

export function basicsErrors(form: GatewayConfigForm): string[] {
  return [validateName(form.name), validateName(form.namespace, 'Namespace')].filter(
    (e): e is string => !!e
  );
}

export function extProcErrors(form: GatewayConfigForm): string[] {
  const errors: string[] = [];
  if (form.image && !IMAGE.test(form.image)) {
    errors.push('Image must look like "registry/repo:tag" (optionally "@sha256:<digest>").');
  }
  const quantities: Array<[string, string]> = [
    [form.cpuRequest, 'CPU request'],
    [form.memoryRequest, 'Memory request'],
    [form.cpuLimit, 'CPU limit'],
    [form.memoryLimit, 'Memory limit'],
  ];
  quantities.forEach(([value, label]) => {
    if (value && !QUANTITY.test(value)) {
      errors.push(`${label} must be a Kubernetes quantity (e.g. 500m, 1, 256Mi, 1Gi).`);
    }
  });
  const names = new Set<string>();
  form.env.forEach((e, i) => {
    const label = `Environment variable ${i + 1}`;
    if (!ENV_NAME.test(e.name)) errors.push(`${label}: enter a valid variable name.`);
    else if (names.has(e.name)) errors.push(`${label}: "${e.name}" is defined twice.`);
    names.add(e.name);
    if (e.source !== 'value') {
      const refError = validateName(
        e.refName,
        `${label} ${e.source === 'secret' ? 'Secret' : 'ConfigMap'}`
      );
      if (refError) errors.push(refError);
      if (!CONFIG_KEY.test(e.refKey)) errors.push(`${label}: enter the key to read.`);
    }
  });
  return errors;
}

export function trafficErrors(form: GatewayConfigForm): string[] {
  const errors = costErrors(form.costs);
  if (form.forwardProxy) {
    const m = form.forwardProxy.match(HOST_PORT);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) {
      errors.push('Forward proxy must be "host:port", e.g. proxy.corp.local:3128.');
    }
  }
  return errors;
}

function toEnv(e: EnvForm) {
  if (e.source === 'secret') {
    return { name: e.name, valueFrom: { secretKeyRef: { name: e.refName, key: e.refKey } } };
  }
  if (e.source === 'configMap') {
    return { name: e.name, valueFrom: { configMapKeyRef: { name: e.refName, key: e.refKey } } };
  }
  return { name: e.name, value: e.value };
}

/** Builds the GatewayConfig spec (empty sections are pruned by the caller). */
export function toGatewayConfigSpec(form: GatewayConfigForm) {
  return {
    extProc: {
      kubernetes: {
        image: form.image || undefined,
        resources: {
          requests: { cpu: form.cpuRequest || undefined, memory: form.memoryRequest || undefined },
          limits: { cpu: form.cpuLimit || undefined, memory: form.memoryLimit || undefined },
        },
        env: form.env.map(toEnv),
      },
    },
    globalLLMRequestCosts: toLLMRequestCosts(form.costs),
    forwardProxy: form.forwardProxy ? { address: form.forwardProxy } : undefined,
  };
}

// ─── Edit support ──────────────────────────────────────────────────────────

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Env entries the form cannot express (e.g. fieldRef); kept verbatim on save. */
export type PreservedEnv = Json[];

function envToForm(e: Json): EnvForm | null {
  if (!e?.name) return null;
  if (e.valueFrom?.secretKeyRef) {
    const { name, key } = e.valueFrom.secretKeyRef;
    return { ...newEnv(), name: e.name, source: 'secret', refName: name || '', refKey: key || '' };
  }
  if (e.valueFrom?.configMapKeyRef) {
    const { name, key } = e.valueFrom.configMapKeyRef;
    return {
      ...newEnv(),
      name: e.name,
      source: 'configMap',
      refName: name || '',
      refKey: key || '',
    };
  }
  if (e.valueFrom) return null;
  return { ...newEnv(), name: e.name, value: e.value ?? '' };
}

/** Pre-fills the form from an existing GatewayConfig and the Gateways that select it. */
export function formFromGatewayConfig(
  json: Json,
  attachedGateways: string[]
): { form: GatewayConfigForm; preservedEnv: PreservedEnv } {
  const spec: Json = json.spec || {};
  const k8s: Json = spec.extProc?.kubernetes || {};
  const preservedEnv: PreservedEnv = [];
  const env: EnvForm[] = [];
  (k8s.env || []).forEach((e: Json) => {
    const f = envToForm(e);
    if (f) env.push(f);
    else preservedEnv.push(e);
  });
  return {
    form: {
      name: json.metadata?.name || '',
      namespace: json.metadata?.namespace || '',
      gateways: attachedGateways,
      image: k8s.image || '',
      cpuRequest: String(k8s.resources?.requests?.cpu ?? ''),
      memoryRequest: String(k8s.resources?.requests?.memory ?? ''),
      cpuLimit: String(k8s.resources?.limits?.cpu ?? ''),
      memoryLimit: String(k8s.resources?.limits?.memory ?? ''),
      env,
      costs: (spec.globalLLMRequestCosts || []).map((c: Json) => ({
        metadataKey: c.metadataKey || '',
        type: c.type || 'TotalToken',
        cel: c.cel || '',
      })),
      forwardProxy: spec.forwardProxy?.address || '',
    },
    preservedEnv,
  };
}

function setOrDelete(obj: Json, key: string, value: unknown) {
  if (value === undefined || value === '') delete obj[key];
  else obj[key] = value;
}

function dropIfEmpty(obj: Json, key: string) {
  const v = obj[key];
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) {
    delete obj[key];
  }
}

/**
 * Applies the form onto an existing spec, touching only the fields the form manages.
 * Everything else (securityContext, volumeMounts, imageRepository, extra resource types,
 * unsupported env sources, unknown fields) is kept as is.
 */
export function mergeGatewayConfigSpec(
  original: Json | undefined,
  form: GatewayConfigForm,
  preservedEnv: PreservedEnv = []
): Json {
  const spec: Json = JSON.parse(JSON.stringify(original || {}));
  const extProc: Json = { ...(spec.extProc || {}) };
  const k8s: Json = { ...(extProc.kubernetes || {}) };

  setOrDelete(k8s, 'image', form.image);
  const resources: Json = { ...(k8s.resources || {}) };
  const requests: Json = { ...(resources.requests || {}) };
  const limits: Json = { ...(resources.limits || {}) };
  setOrDelete(requests, 'cpu', form.cpuRequest);
  setOrDelete(requests, 'memory', form.memoryRequest);
  setOrDelete(limits, 'cpu', form.cpuLimit);
  setOrDelete(limits, 'memory', form.memoryLimit);
  resources.requests = requests;
  resources.limits = limits;
  dropIfEmpty(resources, 'requests');
  dropIfEmpty(resources, 'limits');
  k8s.resources = resources;
  dropIfEmpty(k8s, 'resources');

  const env = [...form.env.map(toEnv), ...preservedEnv];
  if (env.length > 0) k8s.env = env;
  else delete k8s.env;

  extProc.kubernetes = k8s;
  dropIfEmpty(extProc, 'kubernetes');
  spec.extProc = extProc;
  dropIfEmpty(spec, 'extProc');

  const costs = toLLMRequestCosts(form.costs).map(c =>
    c.cel ? c : { metadataKey: c.metadataKey, type: c.type }
  );
  if (costs.length > 0) spec.globalLLMRequestCosts = costs;
  else delete spec.globalLLMRequestCosts;

  if (form.forwardProxy)
    spec.forwardProxy = { ...(spec.forwardProxy || {}), address: form.forwardProxy };
  else delete spec.forwardProxy;

  return spec;
}

/** Gateways to annotate (newly selected) and to release (deselected) when saving an edit. */
export function gatewayChanges(
  before: string[],
  after: string[]
): { attach: string[]; detach: string[] } {
  return {
    attach: after.filter(g => !before.includes(g)),
    detach: before.filter(g => !after.includes(g)),
  };
}
