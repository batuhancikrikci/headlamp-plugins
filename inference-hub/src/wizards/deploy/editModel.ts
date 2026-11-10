/**
 * Editing an existing endpoint with the Deploy Model wizard: the form of a live object, and the
 * live object with the form applied. Everything here is pure so it can be unit tested.
 *
 * The form is applied field by field, and only where the form differs from the form of the live
 * object. Everything the wizard does not know about (labels, annotations, other containers and
 * env vars, tolerations, custom router settings, ...) stays as it is, and saving an unchanged
 * form writes back the same object.
 */
import { ContainerSpec, EndpointKind, STOP_ANNOTATION } from '../../resources/endpoint';
import { KubeJson } from '../../resources/types';
import {
  defaultForm,
  DeployForm,
  IsvcDeploymentMode,
  prefillSpec,
  routerFor,
  RoutingMode,
  splitArgs,
} from './deployModel';

type Json = Record<string, any>;

const VLLM_ARGS_ENV = 'VLLM_ADDITIONAL_ARGS';
const DEPLOYMENT_MODE_ANNOTATION = 'serving.kserve.io/deploymentMode';
const NON_GPU_RESOURCES = new Set(['cpu', 'memory', 'ephemeral-storage', 'pods']);

export interface EditSource {
  form: DeployForm;
  /** Settings the wizard does not show; they are kept as they are. */
  notes: string[];
  /** Why the wizard cannot edit this object (edit it as YAML instead). */
  blocked?: string;
}

/** A catalog entry (LocalModelCache) by name and source URI. */
export interface CatalogRef {
  name: string;
  uri: string;
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

/** The model server container of a pod template: the one named "main", else the first. */
function mainContainer(template: Json | undefined): ContainerSpec | undefined {
  const containers = (template?.containers || []) as ContainerSpec[];
  return containers.find(c => c.name === 'main') || containers[0];
}

/** GPU resource name and count of a container (limits first, then requests). */
function gpuOf(container: ContainerSpec | undefined): { resource?: string; count: number } {
  const limits = container?.resources?.limits || {};
  const requests = container?.resources?.requests || {};
  for (const source of [limits, requests]) {
    const resource = Object.keys(source).find(
      key => !NON_GPU_RESOURCES.has(key) && !key.startsWith('hugepages-')
    );
    if (resource) return { resource, count: Number(source[resource]) || 0 };
  }
  return { count: 0 };
}

function resourceFields(container: ContainerSpec | undefined, form: DeployForm) {
  const gpu = gpuOf(container);
  const requests = container?.resources?.requests || {};
  const limits = container?.resources?.limits || {};
  return {
    gpuResource: gpu.resource || form.gpuResource,
    gpus: gpu.count,
    cpu: requests.cpu || limits.cpu || '',
    memory: requests.memory || limits.memory || '',
  };
}

function catalogFields(uri: string, catalog: CatalogRef[]) {
  const entry = catalog.find(c => c.uri === uri);
  return entry
    ? { source: 'catalog' as const, cacheName: entry.name }
    : { source: 'custom' as const };
}

function llmSource(obj: KubeJson, catalog: CatalogRef[]): EditSource {
  const spec = asObject(obj.spec);
  const template = asObject(spec.template);
  const main = mainContainer(template);
  const notes: string[] = [];
  const form = defaultForm(obj.metadata.namespace || '');
  const uri = spec.model?.uri || '';
  Object.assign(form, {
    mode: 'llm',
    name: obj.metadata.name,
    uri,
    servedModelName: spec.model?.name || '',
    ...catalogFields(uri, catalog),
    profiles: (spec.baseRefs || []).map((r: Json) => r.name).filter(Boolean),
    image: main?.image || '',
    extraArgs: main?.env?.find(e => e.name === VLLM_ARGS_ENV)?.value || '',
    serviceAccountName: template.serviceAccountName || '',
    nodeSelector: { ...(template.nodeSelector || {}) },
    prefillDecode: !!spec.prefill,
    prefillReplicas: spec.prefill?.replicas ?? 1,
  });
  Object.assign(form, resourceFields(main, form));

  if (spec.scaling) {
    Object.assign(form, {
      autoscale: true,
      minReplicas: spec.scaling.minReplicas ?? 1,
      maxReplicas: spec.scaling.maxReplicas ?? Math.max(1, spec.scaling.minReplicas ?? 1),
    });
  } else {
    form.replicas = spec.replicas ?? 1;
  }

  const router = asObject(spec.router);
  const routing: RoutingMode = router.scheduler ? 'scheduler' : router.route ? 'route' : 'none';
  const gatewayRefs = (router.gateway?.refs || []) as Array<{ name: string; namespace?: string }>;
  Object.assign(form, {
    routing,
    gatewayName: gatewayRefs[0]?.name || '',
    gatewayNamespace: gatewayRefs[0]?.namespace || '',
  });

  if (gatewayRefs.length > 1) {
    notes.push('Only the first gateway is shown; changing it replaces all gateway references.');
  }
  if (router.ingress || Object.keys(asObject(router.scheduler)).length || router.route?.http) {
    notes.push('Custom router settings are kept unless you change the routing mode.');
  }
  const containers = (template.containers || []) as ContainerSpec[];
  if (containers.length > 1) notes.push('Other containers of the pod template are kept.');
  if (main?.args?.length || main?.command?.length) {
    notes.push(
      'The container command and args are kept; extra arguments here go to VLLM_ADDITIONAL_ARGS.'
    );
  }
  const otherEnv = (main?.env || []).filter(e => e.name !== VLLM_ARGS_ENV);
  if (otherEnv.length) notes.push('Other environment variables of the container are kept.');
  if (template.tolerations || template.affinity || template.volumes) {
    notes.push('Tolerations, affinity and volumes of the pod template are kept.');
  }
  const parallelism = asObject(spec.parallelism);
  if (Object.keys(parallelism).some(k => k !== 'tensor')) {
    notes.push('Parallelism settings other than tensor parallelism are kept.');
  }
  if ((parallelism.tensor ?? 1) !== Math.max(1, form.gpus)) {
    notes.push(
      `Tensor parallelism (${
        parallelism.tensor ?? 1
      }) differs from the GPUs per replica; it changes only when you change the GPU count.`
    );
  }
  if (spec.worker) notes.push('Multi-node workers (spec.worker) are kept.');
  if (spec.kvCacheOffloading) notes.push('KV cache offloading settings are kept.');
  if (spec.model?.lora) notes.push('LoRA adapter settings are kept.');
  if (spec.scaling?.wva) notes.push('Workload variant autoscaler settings are kept.');
  return { form, notes };
}

/** Served model name and other args of an InferenceService model. */
function parseIsvcArgs(args: string[] = []): { servedModelName: string; extraArgs: string } {
  let servedModelName = '';
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--model_name=')) {
      servedModelName = arg.slice('--model_name='.length);
    } else if (arg === '--model_name' && i + 1 < args.length) {
      servedModelName = args[++i];
    } else {
      rest.push(/\s/.test(arg) ? `"${arg}"` : arg);
    }
  }
  return { servedModelName, extraArgs: rest.join(' ') };
}

function isvcSource(obj: KubeJson, catalog: CatalogRef[]): EditSource {
  const predictor = asObject(asObject(obj.spec).predictor);
  const model = predictor.model as Json | undefined;
  const form = defaultForm(obj.metadata.namespace || '');
  form.mode = 'isvc';
  form.name = obj.metadata.name;
  if (!model) {
    return {
      form,
      notes: [],
      blocked:
        'This InferenceService uses a custom predictor instead of spec.predictor.model. Edit it as YAML.',
    };
  }
  const uri = model.storageUri || '';
  const { servedModelName, extraArgs } = parseIsvcArgs(model.args);
  Object.assign(form, {
    uri,
    servedModelName,
    extraArgs,
    ...catalogFields(uri, catalog),
    runtime: model.runtime || '',
    image: model.image || '',
    serviceAccountName: predictor.serviceAccountName || '',
    nodeSelector: { ...(predictor.nodeSelector || {}) },
    isvcDeploymentMode: (obj.metadata.annotations?.[DEPLOYMENT_MODE_ANNOTATION] ||
      '') as IsvcDeploymentMode,
  });
  Object.assign(form, resourceFields(model, form));
  const min = predictor.minReplicas ?? 1;
  const max = predictor.maxReplicas ?? min;
  if (min === max && min >= 1) {
    form.replicas = min;
  } else {
    Object.assign(form, { autoscale: true, minReplicas: min, maxReplicas: Math.max(max, 1) });
  }

  const notes: string[] = [];
  if (model.command?.length) notes.push('The model container command is kept.');
  if (model.env?.length) notes.push('Environment variables of the model container are kept.');
  if (predictor.tolerations || predictor.affinity || predictor.volumes) {
    notes.push('Tolerations, affinity and volumes of the predictor are kept.');
  }
  if (predictor.containers?.length) notes.push('Additional predictor containers are kept.');
  if (predictor.workerSpec) notes.push('Multi-node workers (workerSpec) are kept.');
  if (asObject(obj.spec).transformer) notes.push('The transformer is kept.');
  return { form, notes };
}

/** The wizard form of a live endpoint. */
export function formFromEndpoint(
  obj: KubeJson,
  kind: EndpointKind,
  catalog: CatalogRef[] = []
): EditSource {
  return kind === 'LLMInferenceService' ? llmSource(obj, catalog) : isvcSource(obj, catalog);
}

/** Removes fields that are noise when writing an object back (status, managedFields). */
export function writableCopy(obj: KubeJson): KubeJson {
  const copy = clone(obj) as KubeJson & { status?: unknown };
  delete copy.status;
  delete (copy.metadata as Json).managedFields;
  return copy;
}

/**
 * Whether the content an edit writes (spec, labels, annotations, …) differs between two versions
 * of an endpoint. Status updates and the bookkeeping fields of metadata are ignored: KServe
 * updates the status all the time, and those changes neither conflict with an edit nor need the
 * user's attention.
 */
export function editableContentChanged(before: KubeJson, after: KubeJson): boolean {
  const content = (obj: KubeJson) => {
    const copy = writableCopy(obj);
    const meta = copy.metadata as Json;
    for (const key of ['resourceVersion', 'generation', 'creationTimestamp', 'uid']) {
      delete meta[key];
    }
    return copy;
  };
  return !same(content(before), content(after));
}

type FormKey = keyof DeployForm;

function changed(original: DeployForm, form: DeployForm, ...keys: FormKey[]): boolean {
  return keys.some(key => !same(original[key], form[key]));
}

function setOrDelete(target: Json, key: string, value: unknown) {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function dropEmpty(target: Json, key: string) {
  const value = target[key];
  if (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) {
    delete target[key];
  }
}

/** Writes CPU, memory and GPU requests/limits of the form into a container. */
function applyResources(container: Json, original: DeployForm, form: DeployForm) {
  if (!changed(original, form, 'cpu', 'memory', 'gpus', 'gpuResource')) return;
  container.resources = container.resources || {};
  const res = container.resources as Json;
  res.requests = res.requests || {};
  res.limits = res.limits || {};
  if (changed(original, form, 'cpu')) setOrDelete(res.requests, 'cpu', form.cpu);
  if (changed(original, form, 'memory')) {
    setOrDelete(res.requests, 'memory', form.memory);
    setOrDelete(res.limits, 'memory', form.memory);
  }
  if (changed(original, form, 'gpus', 'gpuResource')) {
    delete res.requests[original.gpuResource];
    delete res.limits[original.gpuResource];
    if (form.gpus > 0) {
      res.requests[form.gpuResource] = String(form.gpus);
      res.limits[form.gpuResource] = String(form.gpus);
    }
  }
  dropEmpty(res, 'requests');
  dropEmpty(res, 'limits');
  dropEmpty(container, 'resources');
}

/** Sets or removes VLLM_ADDITIONAL_ARGS, keeping the other env vars. */
function applyVllmArgs(container: Json, args: string) {
  const env = ((container.env || []) as Array<{ name: string; value?: string }>).filter(
    e => e.name !== VLLM_ARGS_ENV
  );
  const value = args.trim();
  const index = ((container.env || []) as Array<{ name: string }>).findIndex(
    e => e.name === VLLM_ARGS_ENV
  );
  if (value) env.splice(index >= 0 ? index : env.length, 0, { name: VLLM_ARGS_ENV, value });
  setOrDelete(container, 'env', env);
}

/** Applies the container and pod settings of the form to an LLMInferenceService workload. */
function applyLlmWorkload(workload: Json, original: DeployForm, form: DeployForm) {
  workload.template = workload.template || {};
  const template = workload.template as Json;
  template.containers = template.containers || [];
  let main = mainContainer(template) as Json | undefined;
  if (!main) {
    main = { name: 'main' };
    template.containers.push(main);
  }
  if (changed(original, form, 'image')) setOrDelete(main, 'image', form.image);
  if (changed(original, form, 'extraArgs')) applyVllmArgs(main, form.extraArgs);
  applyResources(main, original, form);
  if (changed(original, form, 'gpus')) {
    workload.parallelism = workload.parallelism || {};
    setOrDelete(workload.parallelism, 'tensor', form.gpus > 1 ? form.gpus : undefined);
    dropEmpty(workload, 'parallelism');
  }
  if (changed(original, form, 'nodeSelector')) {
    setOrDelete(
      template,
      'nodeSelector',
      Object.keys(form.nodeSelector).length ? form.nodeSelector : undefined
    );
  }
  if (changed(original, form, 'serviceAccountName')) {
    setOrDelete(template, 'serviceAccountName', form.serviceAccountName);
  }
}

// The model of an endpoint (URI and served name) never changes: clients and routes depend on it,
// so a different model is a new endpoint. The form fields are read-only and ignored here.

function applyLlm(spec: Json, original: DeployForm, form: DeployForm) {
  if (changed(original, form, 'profiles')) {
    setOrDelete(
      spec,
      'baseRefs',
      form.profiles.map(name => ({ name }))
    );
  }
  if (changed(original, form, 'autoscale', 'replicas', 'minReplicas', 'maxReplicas')) {
    // spec.replicas and spec.scaling are mutually exclusive.
    if (form.autoscale) {
      delete spec.replicas;
      spec.scaling = {
        ...(spec.scaling || {}),
        minReplicas: form.minReplicas,
        maxReplicas: form.maxReplicas,
      };
    } else {
      delete spec.scaling;
      spec.replicas = form.replicas;
    }
  }
  if (changed(original, form, 'routing')) {
    setOrDelete(spec, 'router', routerFor(form));
  } else if (changed(original, form, 'gatewayName', 'gatewayNamespace') && spec.router) {
    spec.router.gateway = form.gatewayName
      ? {
          ...(spec.router.gateway || {}),
          refs: [
            {
              name: form.gatewayName,
              ...(form.gatewayNamespace ? { namespace: form.gatewayNamespace } : {}),
            },
          ],
        }
      : {};
  }
  applyLlmWorkload(spec, original, form);
  if (changed(original, form, 'prefillDecode')) {
    if (form.prefillDecode) spec.prefill = prefillSpec(form);
    else delete spec.prefill;
  } else if (form.prefillDecode && spec.prefill) {
    if (changed(original, form, 'prefillReplicas')) spec.prefill.replicas = form.prefillReplicas;
    applyLlmWorkload(spec.prefill, original, form);
  }
}

function applyIsvc(spec: Json, original: DeployForm, form: DeployForm) {
  spec.predictor = spec.predictor || {};
  const predictor = spec.predictor as Json;
  predictor.model = predictor.model || {};
  const model = predictor.model as Json;
  if (changed(original, form, 'runtime')) setOrDelete(model, 'runtime', form.runtime);
  if (changed(original, form, 'image')) setOrDelete(model, 'image', form.image);
  if (changed(original, form, 'extraArgs')) {
    const args = splitArgs(form.extraArgs).filter(a => !a.startsWith('--model_name'));
    setOrDelete(model, 'args', [
      ...(original.servedModelName ? [`--model_name=${original.servedModelName}`] : []),
      ...args,
    ]);
  }
  applyResources(model, original, form);
  if (changed(original, form, 'autoscale', 'replicas', 'minReplicas', 'maxReplicas')) {
    predictor.minReplicas = form.autoscale ? form.minReplicas : form.replicas;
    predictor.maxReplicas = form.autoscale ? form.maxReplicas : form.replicas;
  }
  if (changed(original, form, 'nodeSelector')) {
    setOrDelete(
      predictor,
      'nodeSelector',
      Object.keys(form.nodeSelector).length ? form.nodeSelector : undefined
    );
  }
  if (changed(original, form, 'serviceAccountName')) {
    setOrDelete(predictor, 'serviceAccountName', form.serviceAccountName);
  }
}

/**
 * The live object with the changes of the form. `original` is the form of the live object
 * (formFromEndpoint); fields equal to it are not touched.
 */
export function applyFormToEndpoint(
  live: KubeJson,
  original: DeployForm,
  form: DeployForm
): KubeJson {
  const obj = writableCopy(live);
  obj.spec = obj.spec || {};
  if (live.kind === 'LLMInferenceService') applyLlm(obj.spec as Json, original, form);
  else applyIsvc(obj.spec as Json, original, form);
  return obj;
}

export interface FormChange {
  label: string;
  from: string;
  to: string;
}

const CHANGE_LABELS: Array<[FormKey[], string, (f: DeployForm) => string]> = [
  [['routing'], 'Routing', f => f.routing],
  [
    ['gatewayName', 'gatewayNamespace'],
    'Gateway',
    f =>
      f.gatewayName ? `${f.gatewayNamespace ? `${f.gatewayNamespace}/` : ''}${f.gatewayName}` : '',
  ],
  [['profiles'], 'Serving profiles', f => f.profiles.join(', ')],
  [
    ['prefillDecode', 'prefillReplicas'],
    'Prefill/decode split',
    f => (f.prefillDecode ? `${f.prefillReplicas} prefill replica(s)` : 'off'),
  ],
  [['runtime'], 'Runtime', f => f.runtime],
  [['image'], 'Container image', f => f.image],
  [['extraArgs'], 'Extra arguments', f => f.extraArgs],
  [['serviceAccountName'], 'Service account', f => f.serviceAccountName],
  [['gpus', 'gpuResource'], 'GPUs per replica', f => `${f.gpus} × ${f.gpuResource}`],
  [['cpu'], 'CPU', f => f.cpu],
  [['memory'], 'Memory', f => f.memory],
  [
    ['nodeSelector'],
    'Node selector',
    f =>
      Object.entries(f.nodeSelector)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
  ],
  [
    ['autoscale', 'replicas', 'minReplicas', 'maxReplicas'],
    'Replicas',
    f => (f.autoscale ? `${f.minReplicas} – ${f.maxReplicas} (autoscaling)` : String(f.replicas)),
  ],
];

/** The changes of the form, in words, for the review step. */
export function formChanges(original: DeployForm, form: DeployForm): FormChange[] {
  return CHANGE_LABELS.filter(([keys]) => changed(original, form, ...keys)).map(
    ([, label, value]) => ({ label, from: value(original) || '—', to: value(form) || '—' })
  );
}

/** Changes that make KServe replace the model server pods. */
export function restartsPods(original: DeployForm, form: DeployForm): boolean {
  return changed(
    original,
    form,
    'runtime',
    'image',
    'extraArgs',
    'serviceAccountName',
    'gpus',
    'gpuResource',
    'cpu',
    'memory',
    'nodeSelector',
    'prefillDecode'
  );
}

/** The model of an endpoint object: its URI and the name clients send. */
export function endpointModel(obj: KubeJson): { uri: string; name: string } {
  const spec = asObject(obj.spec);
  if (obj.kind === 'LLMInferenceService') {
    return { uri: spec.model?.uri || '', name: spec.model?.name || '' };
  }
  const model = asObject(asObject(spec.predictor).model);
  return {
    uri: model.storageUri || '',
    name: parseIsvcArgs(model.args).servedModelName,
  };
}

/** Error when an edit changes the model of an endpoint, which is not allowed. */
export function modelChangeError(live: KubeJson, edited: KubeJson): string | undefined {
  const before = endpointModel(live);
  const after = endpointModel(edited);
  if (before.uri === after.uri && before.name === after.name) return undefined;
  return `The model of an endpoint cannot change (${
    before.name || before.uri
  }). Deploy a new endpoint for another model.`;
}

export function isStoppedObject(obj: KubeJson): boolean {
  return obj.metadata.annotations?.[STOP_ANNOTATION] === 'true';
}

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

/** Line diff (longest common subsequence); fine for the size of one Kubernetes object. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i++] });
    } else {
      out.push({ kind: 'add', text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: 'remove', text: a[i++] });
  while (j < b.length) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** Changed lines with `context` unchanged lines around them; gaps are marked with null. */
export function diffHunks(lines: DiffLine[], context = 3): Array<DiffLine | null> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    ) {
      keep.add(k);
    }
  });
  const out: Array<DiffLine | null> = [];
  let last = -1;
  [...keep]
    .sort((x, y) => x - y)
    .forEach(index => {
      if (last >= 0 && index > last + 1) out.push(null);
      out.push(lines[index]);
      last = index;
    });
  return out;
}
