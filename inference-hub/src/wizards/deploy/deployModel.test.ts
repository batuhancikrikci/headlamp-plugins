import {
  buildObjects,
  defaultForm,
  DeployForm,
  suggestName,
  suggestServedName,
  totalGpus,
  validateStep,
  validateUri,
} from './deployModel';

function form(patch: Partial<DeployForm> = {}): DeployForm {
  return {
    ...defaultForm('ai'),
    source: 'custom',
    uri: 'hf://Qwen/Qwen2.5-7B-Instruct',
    servedModelName: 'Qwen/Qwen2.5-7B-Instruct',
    name: 'qwen2-5-7b-instruct',
    ...patch,
  };
}

const V = {
  llm: 'serving.kserve.io/v1alpha2',
  isvc: 'serving.kserve.io/v1beta1',
  cache: 'serving.kserve.io/v1alpha1',
};

describe('suggestions', () => {
  it('derives resource and served names', () => {
    expect(suggestName('Qwen/Qwen2.5-7B-Instruct')).toBe('qwen25-7b-instruct');
    // Dots are removed, not replaced.
    expect(suggestName('Qwen/Qwen3.8-27B')).toBe('qwen38-27b');
    expect(suggestName('mistralai/Mistral-Small-3.2-24B-Instruct-2506')).toBe(
      'mistral-small-32-24b-instruct-2506'
    );
    expect(suggestName('ibm-granite/granite_3.3 8b')).toBe('granite-33-8b');
    const long = suggestName('meta-llama/Meta-Llama-3.1-70B-Instruct-FP8-dynamic-extra-long-name');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^[a-z][-a-z0-9]*[a-z0-9]$/);
    expect(suggestName('1234')).toBe('model');
    expect(suggestServedName('hf://meta-llama/Llama-3.1-8B-Instruct')).toBe(
      'meta-llama/Llama-3.1-8B-Instruct'
    );
    expect(suggestServedName('pvc://models/granite-8b')).toBe('granite-8b');
    expect(suggestServedName('oci://quay.io/org/modelcar:1.0')).toBe('modelcar');
  });
});

describe('validation', () => {
  it('checks URIs', () => {
    expect(validateUri('hf://Qwen/Qwen2.5-7B')).toBeUndefined();
    expect(validateUri('pvc://my-pvc/path')).toBeUndefined();
    expect(validateUri('hf://Qwen')).toMatch(/organization/);
    expect(validateUri('ftp://x/y')).toMatch(/Use one of/);
    expect(validateUri('')).toMatch(/Enter/);
  });

  it('reports errors per step', () => {
    expect(validateStep('source', form())).toEqual({});
    expect(validateStep('source', form({ name: 'Bad_Name' }))).toHaveProperty('name');
    expect(validateStep('source', form({ source: 'catalog', cacheName: '' }))).toHaveProperty(
      'cacheName'
    );
    expect(
      validateStep(
        'source',
        form({ addToCatalog: true, catalogModelSize: '', catalogNodeGroups: [] })
      )
    ).toMatchObject({
      catalogModelSize: expect.any(String),
      catalogNodeGroups: expect.any(String),
    });
    expect(validateStep('resources', form({ cpu: 'lots', gpus: -1 }))).toMatchObject({
      cpu: expect.any(String),
      gpus: expect.any(String),
    });
    expect(
      validateStep('scaling', form({ autoscale: true, minReplicas: 3, maxReplicas: 2 }))
    ).toHaveProperty('maxReplicas');
    expect(validateStep('review', form())).toEqual({});
  });
});

describe('LLMInferenceService generation', () => {
  it('builds a scheduler-routed service with resources and tensor parallelism', () => {
    const [llm] = buildObjects(
      form({ gpus: 2, profiles: ['long-context'], extraArgs: '--max-model-len=32768' }),
      V
    );
    expect(llm).toEqual({
      apiVersion: 'serving.kserve.io/v1alpha2',
      kind: 'LLMInferenceService',
      metadata: {
        name: 'qwen2-5-7b-instruct',
        namespace: 'ai',
        labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
      },
      spec: {
        model: { uri: 'hf://Qwen/Qwen2.5-7B-Instruct', name: 'Qwen/Qwen2.5-7B-Instruct' },
        baseRefs: [{ name: 'long-context' }],
        replicas: 1,
        parallelism: { tensor: 2 },
        router: { scheduler: {}, route: {}, gateway: {} },
        template: {
          containers: [
            {
              name: 'main',
              env: [{ name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len=32768' }],
              resources: {
                requests: { cpu: '4', memory: '32Gi', 'nvidia.com/gpu': '2' },
                limits: { memory: '32Gi', 'nvidia.com/gpu': '2' },
              },
            },
          ],
        },
      },
    });
  });

  it('uses scaling instead of replicas when autoscaling (mutually exclusive)', () => {
    const [llm] = buildObjects(form({ autoscale: true, minReplicas: 1, maxReplicas: 4 }), V);
    const spec = llm.spec as Record<string, unknown>;
    expect(spec.scaling).toEqual({ minReplicas: 1, maxReplicas: 4 });
    expect(spec).not.toHaveProperty('replicas');
  });

  it('adds prefill, gateway refs, node selector and service account', () => {
    const [llm] = buildObjects(
      form({
        prefillDecode: true,
        prefillReplicas: 2,
        gatewayName: 'inference-gw',
        gatewayNamespace: 'gateways',
        nodeSelector: { 'nvidia.com/gpu.product': 'NVIDIA-H100-80GB-HBM3' },
        serviceAccountName: 'hf-reader',
      }),
      V
    );
    const spec = llm.spec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(spec.router.gateway).toEqual({
      refs: [{ name: 'inference-gw', namespace: 'gateways' }],
    });
    expect(spec.prefill.replicas).toBe(2);
    expect(spec.template.nodeSelector).toEqual({
      'nvidia.com/gpu.product': 'NVIDIA-H100-80GB-HBM3',
    });
    expect(spec.prefill.template.serviceAccountName).toBe('hf-reader');
  });

  it('omits the router for in-cluster only services and GPUs for CPU models', () => {
    const [llm] = buildObjects(form({ routing: 'none', gpus: 0 }), V);
    const spec = llm.spec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(spec).not.toHaveProperty('router');
    expect(spec.template.containers[0].resources.limits).toEqual({ memory: '32Gi' });
  });
});

describe('InferenceService generation', () => {
  it('builds a Hugging Face runtime predictor', () => {
    const [isvc] = buildObjects(
      form({
        mode: 'isvc',
        isvcDeploymentMode: 'Standard',
        extraArgs: '--max_model_len 8192 --dtype "bfloat16"',
      }),
      V
    );
    expect(isvc.metadata.annotations).toEqual({ 'serving.kserve.io/deploymentMode': 'Standard' });
    expect((isvc.spec as Record<string, any>).predictor).toMatchObject({
      // eslint-disable-line @typescript-eslint/no-explicit-any
      minReplicas: 1,
      maxReplicas: 1,
      model: {
        modelFormat: { name: 'huggingface' },
        storageUri: 'hf://Qwen/Qwen2.5-7B-Instruct',
        args: [
          '--model_name=Qwen/Qwen2.5-7B-Instruct',
          '--max_model_len',
          '8192',
          '--dtype',
          'bfloat16',
        ],
      },
    });
  });
});

describe('catalog', () => {
  it('creates the LocalModelCache first for custom URIs', () => {
    const objects = buildObjects(
      form({ addToCatalog: true, catalogModelSize: '16Gi', catalogNodeGroups: ['gpu-workers'] }),
      V
    );
    expect(objects.map(o => o.kind)).toEqual(['LocalModelCache', 'LLMInferenceService']);
    expect(objects[0]).toMatchObject({
      metadata: { name: 'qwen2-5-7b-instruct' },
      spec: {
        sourceModelUri: 'hf://Qwen/Qwen2.5-7B-Instruct',
        modelSize: '16Gi',
        nodeGroups: ['gpu-workers'],
      },
    });
    expect(objects[0].metadata).not.toHaveProperty('namespace');
  });

  it('counts GPUs of all replicas', () => {
    expect(totalGpus(form({ gpus: 2, replicas: 3 }))).toBe(6);
    expect(totalGpus(form({ gpus: 1, prefillDecode: true, prefillReplicas: 2 }))).toBe(3);
  });
});
