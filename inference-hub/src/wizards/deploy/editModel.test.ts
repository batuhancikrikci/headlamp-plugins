import { describe, expect, it } from 'vitest';
import { GpuNode } from '../../resources/gpu';
import { KubeJson } from '../../resources/types';
import { checkFit, withoutEndpoint } from '../../utils/gpuFit';
import {
  buildInferenceService,
  buildLLMInferenceService,
  defaultForm,
  DeployForm,
  validateStep,
} from './deployModel';
import {
  applyFormToEndpoint,
  diffHunks,
  formChanges,
  formFromEndpoint,
  lineDiff,
  restartsPods,
  writableCopy,
} from './editModel';

/** An LLMInferenceService as it comes back from the API server, with fields the form ignores. */
function liveLlm(): KubeJson {
  return {
    apiVersion: 'serving.kserve.io/v1alpha2',
    kind: 'LLMInferenceService',
    metadata: {
      name: 'qwen3-14b-fp8',
      namespace: 'llm',
      resourceVersion: '4711',
      uid: 'abc',
      generation: 3,
      labels: { 'app.kubernetes.io/managed-by': 'inference-hub', team: 'ml' },
      annotations: { 'serving.kserve.io/stop': 'true', note: 'keep me' },
      managedFields: [{ manager: 'kubectl' }],
    } as KubeJson['metadata'],
    spec: {
      model: { uri: 'hf://Qwen/Qwen3-14B-FP8', name: 'qwen3-14b-fp8' },
      baseRefs: [{ name: 'vllm-defaults' }],
      replicas: 1,
      parallelism: { tensor: 2 },
      router: {
        scheduler: { pool: { spec: { targetPorts: [{ number: 8000 }] } } },
        route: {},
        gateway: { refs: [{ name: 'default-gateway', namespace: 'kube-gateway' }] },
      },
      template: {
        tolerations: [{ key: 'nvidia.com/gpu', operator: 'Exists' }],
        nodeSelector: { 'nvidia.com/gpu.product': 'NVIDIA-L40S' },
        containers: [
          {
            name: 'main',
            image: 'vllm/vllm-openai:v0.30.0',
            env: [
              { name: 'HF_HUB_OFFLINE', value: '1' },
              { name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len=32768' },
            ],
            resources: {
              requests: { cpu: '8', memory: '64Gi', 'nvidia.com/gpu': '2' },
              limits: { cpu: '16', memory: '64Gi', 'nvidia.com/gpu': '2' },
            },
          },
          { name: 'sidecar', image: 'busybox' },
        ],
      },
    },
    status: { conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

function liveIsvc(): KubeJson {
  return {
    apiVersion: 'serving.kserve.io/v1beta1',
    kind: 'InferenceService',
    metadata: {
      name: 'gemma',
      namespace: 'llm',
      resourceVersion: '12',
      annotations: { 'serving.kserve.io/deploymentMode': 'Standard' },
    },
    spec: {
      predictor: {
        minReplicas: 1,
        maxReplicas: 1,
        tolerations: [{ key: 'gpu', operator: 'Exists' }],
        model: {
          modelFormat: { name: 'huggingface' },
          storageUri: 'hf://google/gemma-4-26B-A4B-it',
          args: ['--model_name', 'gemma4', '--max_model_len=8192', '--dtype', 'bfloat16'],
          resources: {
            requests: { cpu: '4', memory: '32Gi', 'nvidia.com/gpu': '1' },
            limits: { memory: '32Gi', 'nvidia.com/gpu': '1' },
          },
        },
      },
    },
    status: { url: 'http://gemma.llm' },
  };
}

function edited(live: KubeJson, patch: Partial<DeployForm>) {
  const kind = live.kind as 'LLMInferenceService' | 'InferenceService';
  const { form } = formFromEndpoint(live, kind);
  return applyFormToEndpoint(live, form, { ...form, ...patch });
}

describe('formFromEndpoint', () => {
  it('reads an LLMInferenceService', () => {
    const { form, notes, blocked } = formFromEndpoint(liveLlm(), 'LLMInferenceService', [
      { name: 'qwen3-14b', uri: 'hf://Qwen/Qwen3-14B-FP8' },
    ]);
    expect(blocked).toBeUndefined();
    expect(form).toMatchObject({
      mode: 'llm',
      name: 'qwen3-14b-fp8',
      namespace: 'llm',
      source: 'catalog',
      cacheName: 'qwen3-14b',
      uri: 'hf://Qwen/Qwen3-14B-FP8',
      servedModelName: 'qwen3-14b-fp8',
      profiles: ['vllm-defaults'],
      routing: 'scheduler',
      gatewayName: 'default-gateway',
      gatewayNamespace: 'kube-gateway',
      image: 'vllm/vllm-openai:v0.30.0',
      extraArgs: '--max-model-len=32768',
      gpuResource: 'nvidia.com/gpu',
      gpus: 2,
      cpu: '8',
      memory: '64Gi',
      nodeSelector: { 'nvidia.com/gpu.product': 'NVIDIA-L40S' },
      autoscale: false,
      replicas: 1,
      prefillDecode: false,
    });
    expect(notes).toEqual(
      expect.arrayContaining([
        'Custom router settings are kept unless you change the routing mode.',
        'Other containers of the pod template are kept.',
        'Other environment variables of the container are kept.',
        'Tolerations, affinity and volumes of the pod template are kept.',
      ])
    );
  });

  it('reads an InferenceService, with both forms of --model_name', () => {
    const { form, notes } = formFromEndpoint(liveIsvc(), 'InferenceService');
    expect(form).toMatchObject({
      mode: 'isvc',
      source: 'custom',
      uri: 'hf://google/gemma-4-26B-A4B-it',
      servedModelName: 'gemma4',
      extraArgs: '--max_model_len=8192 --dtype bfloat16',
      isvcDeploymentMode: 'Standard',
      gpus: 1,
      cpu: '4',
      memory: '32Gi',
      replicas: 1,
      autoscale: false,
    });
    expect(notes).toContain('Tolerations, affinity and volumes of the predictor are kept.');
  });

  it('reads autoscaling', () => {
    const live = liveLlm();
    const spec = live.spec as Record<string, any>;
    delete spec.replicas;
    spec.scaling = { minReplicas: 0, maxReplicas: 4 };
    expect(formFromEndpoint(live, 'LLMInferenceService').form).toMatchObject({
      autoscale: true,
      minReplicas: 0,
      maxReplicas: 4,
    });
    const isvc = liveIsvc();
    (isvc.spec as Record<string, any>).predictor.maxReplicas = 3;
    expect(formFromEndpoint(isvc, 'InferenceService').form).toMatchObject({
      autoscale: true,
      minReplicas: 1,
      maxReplicas: 3,
    });
  });

  it('refuses InferenceServices without spec.predictor.model', () => {
    const live = liveIsvc();
    (live.spec as Record<string, any>).predictor = { containers: [{ name: 'kserve-container' }] };
    expect(formFromEndpoint(live, 'InferenceService').blocked).toMatch(/Edit it as YAML/);
  });
});

describe('applyFormToEndpoint', () => {
  it('writes back the same object when nothing changed', () => {
    for (const live of [liveLlm(), liveIsvc()]) {
      expect(edited(live, {})).toEqual(writableCopy(live));
    }
  });

  it('round-trips every object the deploy wizard creates', () => {
    const forms: Array<Partial<DeployForm>> = [
      {},
      { gpus: 2, autoscale: true, minReplicas: 1, maxReplicas: 3 },
      { prefillDecode: true, prefillReplicas: 2, gatewayName: 'gw', gatewayNamespace: 'infra' },
      { routing: 'none', image: 'vllm:custom', extraArgs: '--enable-prefix-caching' },
      { nodeSelector: { pool: 'gpu' }, serviceAccountName: 'hf', profiles: ['a', 'b'] },
    ];
    for (const patch of forms) {
      const form: DeployForm = {
        ...defaultForm('llm'),
        name: 'm',
        uri: 'hf://org/model',
        servedModelName: 'org/model',
        source: 'custom',
        ...patch,
      };
      const llm = buildLLMInferenceService(form, 'serving.kserve.io/v1alpha2');
      const back = formFromEndpoint(llm, 'LLMInferenceService').form;
      expect(applyFormToEndpoint(llm, back, back)).toEqual(llm);
      expect(back).toMatchObject(patch);

      const isvc = buildInferenceService({ ...form, mode: 'isvc' }, 'serving.kserve.io/v1beta1');
      const isvcBack = formFromEndpoint(isvc, 'InferenceService').form;
      expect(applyFormToEndpoint(isvc, isvcBack, isvcBack)).toEqual(isvc);
    }
  });

  it('changes only the replicas', () => {
    const before = writableCopy(liveLlm());
    const after = edited(liveLlm(), { replicas: 3 });
    expect((after.spec as Record<string, any>).replicas).toBe(3);
    (after.spec as Record<string, any>).replicas = 1;
    expect(after).toEqual(before);
  });

  it('switches between fixed replicas and autoscaling', () => {
    const scaled = edited(liveLlm(), { autoscale: true, minReplicas: 1, maxReplicas: 4 });
    expect(scaled.spec).toMatchObject({ scaling: { minReplicas: 1, maxReplicas: 4 } });
    expect((scaled.spec as Record<string, any>).replicas).toBeUndefined();

    const isvc = edited(liveIsvc(), { autoscale: true, minReplicas: 1, maxReplicas: 5 });
    expect((isvc.spec as Record<string, any>).predictor).toMatchObject({
      minReplicas: 1,
      maxReplicas: 5,
    });
  });

  it('changes the GPUs, tensor parallelism and resources, keeping other limits', () => {
    const after = edited(liveLlm(), { gpus: 4, memory: '128Gi' }).spec as Record<string, any>;
    expect(after.parallelism).toEqual({ tensor: 4 });
    expect(after.template.containers[0].resources).toEqual({
      requests: { cpu: '8', memory: '128Gi', 'nvidia.com/gpu': '4' },
      limits: { cpu: '16', memory: '128Gi', 'nvidia.com/gpu': '4' },
    });
    const single = edited(liveLlm(), { gpus: 1 }).spec as Record<string, any>;
    expect(single.parallelism).toBeUndefined();
  });

  it('changes the extra arguments without touching other env vars', () => {
    const env = (edited(liveLlm(), { extraArgs: '--max-model-len=8192' }).spec as any).template
      .containers[0].env;
    expect(env).toEqual([
      { name: 'HF_HUB_OFFLINE', value: '1' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len=8192' },
    ]);
    const cleared = (edited(liveLlm(), { extraArgs: '' }).spec as any).template.containers[0].env;
    expect(cleared).toEqual([{ name: 'HF_HUB_OFFLINE', value: '1' }]);
  });

  it('keeps custom router settings when only the gateway changes', () => {
    const router = (
      edited(liveLlm(), { gatewayName: 'other', gatewayNamespace: '' }).spec as Record<string, any>
    ).router;
    expect(router.scheduler).toEqual({ pool: { spec: { targetPorts: [{ number: 8000 }] } } });
    expect(router.gateway).toEqual({ refs: [{ name: 'other' }] });
  });

  it('rebuilds or removes the router when the routing mode changes', () => {
    expect((edited(liveLlm(), { routing: 'none' }).spec as any).router).toBeUndefined();
    expect((edited(liveLlm(), { routing: 'route' }).spec as any).router).toEqual({
      route: {},
      gateway: { refs: [{ name: 'default-gateway', namespace: 'kube-gateway' }] },
    });
  });

  it('adds and removes the prefill pool', () => {
    const withPrefill = edited(liveLlm(), { prefillDecode: true, prefillReplicas: 2 }).spec as any;
    expect(withPrefill.prefill).toMatchObject({ replicas: 2, parallelism: { tensor: 2 } });
    const live = liveLlm();
    (live.spec as any).prefill = withPrefill.prefill;
    expect((edited(live, { prefillDecode: false }).spec as any).prefill).toBeUndefined();
    expect((edited(live, { prefillReplicas: 3 }).spec as any).prefill.replicas).toBe(3);
  });

  it('keeps labels, annotations (including stop) and the resourceVersion', () => {
    const after = edited(liveLlm(), { replicas: 2, uri: 'hf://Qwen/Qwen3-14B' });
    expect(after.metadata).toMatchObject({
      resourceVersion: '4711',
      labels: { team: 'ml' },
      annotations: { 'serving.kserve.io/stop': 'true', note: 'keep me' },
    });
    expect((after as any).status).toBeUndefined();
    expect((after.metadata as any).managedFields).toBeUndefined();
  });

  it('rewrites the InferenceService args only when the name or arguments change', () => {
    const model = (edited(liveIsvc(), { servedModelName: 'gemma' }).spec as any).predictor.model;
    expect(model.args).toEqual([
      '--model_name=gemma',
      '--max_model_len=8192',
      '--dtype',
      'bfloat16',
    ]);
    expect((edited(liveIsvc(), { replicas: 2 }).spec as any).predictor.model.args).toEqual(
      liveIsvc().spec && (liveIsvc().spec as any).predictor.model.args
    );
  });
});

describe('review helpers', () => {
  it('describes the changes and whether pods restart', () => {
    const { form } = formFromEndpoint(liveLlm(), 'LLMInferenceService');
    const next = { ...form, replicas: 2 };
    expect(formChanges(form, next)).toEqual([{ label: 'Replicas', from: '1', to: '2' }]);
    expect(restartsPods(form, next)).toBe(false);
    expect(restartsPods(form, { ...form, image: 'vllm:new' })).toBe(true);
  });

  it('does not validate fields the API server already accepted', () => {
    const { form } = formFromEndpoint(liveIsvc(), 'InferenceService');
    const noCpu = { ...form, cpu: '' };
    expect(validateStep('resources', noCpu).cpu).toBeDefined();
    expect(validateStep('resources', noCpu, noCpu).cpu).toBeUndefined();
    expect(validateStep('resources', { ...noCpu, cpu: 'x' }, noCpu).cpu).toBeDefined();
  });

  it('diffs lines and keeps context around the changes', () => {
    const lines = lineDiff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nX\ne\nf\ng\nh');
    expect(lines.filter(l => l.kind !== 'same')).toEqual([
      { kind: 'remove', text: 'd' },
      { kind: 'add', text: 'X' },
    ]);
    const hunks = diffHunks(lines, 1);
    expect(hunks.map(l => l && l.text)).toEqual(['c', 'd', 'X', 'e']);
    expect(diffHunks(lineDiff('a', 'a'))).toEqual([]);
  });
});

describe('withoutEndpoint', () => {
  it('frees the GPUs of the edited endpoint for the placement check', () => {
    const node: GpuNode = {
      name: 'gpu-1',
      ready: true,
      unschedulable: false,
      migCapable: false,
      sharing: 'exclusive',
      resources: [{ name: 'nvidia.com/gpu', capacity: 2, allocatable: 2, requested: 2 }],
      workloads: [
        {
          namespace: 'llm',
          pod: 'qwen-0',
          node: 'gpu-1',
          requests: { 'nvidia.com/gpu': 2 },
          endpoint: { kind: 'LLMInferenceService', name: 'qwen' },
        },
      ],
      draDevices: [],
      labels: {},
    };
    const req = { resource: 'nvidia.com/gpu', gpusPerReplica: 2, replicas: 1 };
    expect(checkFit([node], req).fits).toBe(false);
    const freed = withoutEndpoint([node], {
      kind: 'LLMInferenceService',
      name: 'qwen',
      namespace: 'llm',
    });
    expect(checkFit(freed, req).fits).toBe(true);
    expect(
      withoutEndpoint([node], { kind: 'LLMInferenceService', name: 'qwen', namespace: 'other' })[0]
    ).toBe(node);
  });
});
