import { classifyConditions } from '../utils/health';
import { gpuCount, parseQuantity } from '../utils/quantity';
import {
  fromInferenceService,
  fromLLMInferenceService,
  InferenceServiceJson,
  LLMInferenceServiceJson,
  podRole,
  podSelector,
} from './endpoint';

describe('parseQuantity', () => {
  it.each([
    ['16Gi', 16 * 2 ** 30],
    ['500m', 0.5],
    ['2', 2],
    ['1.5k', 1500],
    ['2e3', 2000],
    ['bogus', NaN],
  ])('%s', (input, expected) => {
    expect(parseQuantity(input)).toEqual(expected);
  });

  it('counts GPU devices including MIG slices', () => {
    expect(gpuCount({ cpu: '4', 'nvidia.com/gpu': '2', 'nvidia.com/mig-1g.10gb': '1' })).toBe(3);
    expect(gpuCount(undefined)).toBe(0);
  });
});

describe('classifyConditions', () => {
  it('treats Ready=True as ready', () => {
    expect(classifyConditions([{ type: 'Ready', status: 'True' }]).health).toBe('ready');
  });

  it('reports the failing sub-condition', () => {
    const summary = classifyConditions([
      { type: 'Ready', status: 'False', reason: 'WorkloadsNotReady' },
      {
        type: 'MainWorkloadReady',
        status: 'False',
        reason: 'ProgressDeadlineExceeded',
        message: 'deployment exceeded its progress deadline',
      },
    ]);
    expect(summary).toMatchObject({ health: 'failed', reason: 'ProgressDeadlineExceeded' });
  });

  it('treats a not-yet-ready rollout as progressing', () => {
    const summary = classifyConditions([
      { type: 'Ready', status: 'False', reason: 'MinimumReplicasUnavailable' },
      { type: 'RouterReady', status: 'Unknown' },
    ]);
    expect(summary.health).toBe('progressing');
  });

  it('ignores informational conditions', () => {
    const summary = classifyConditions([
      { type: 'Ready', status: 'Unknown' },
      { type: 'Hint', status: 'False', severity: 'Info', reason: 'NotFound' },
    ]);
    expect(summary.health).toBe('progressing');
  });

  it('uses the age of objects without conditions', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(classifyConditions([], { createdAt: '2026-01-01T00:00:00Z', now }).health).toBe(
      'progressing'
    );
    expect(classifyConditions(undefined, { createdAt: '2025-01-01T00:00:00Z', now }).health).toBe(
      'unknown'
    );
  });
});

describe('fromLLMInferenceService', () => {
  const llm: LLMInferenceServiceJson = {
    apiVersion: 'serving.kserve.io/v1alpha2',
    kind: 'LLMInferenceService',
    metadata: { name: 'gpt-oss-20b', namespace: 'ai', creationTimestamp: '2026-01-01T00:00:00Z' },
    spec: {
      model: { uri: 'pvc://gpt-oss-20b-pvc', name: 'RedHatAI/gpt-oss-20b' },
      replicas: 2,
      baseRefs: [{ name: 'llmisvc-config-pd-disagg' }],
      template: {
        containers: [{ name: 'main', resources: { limits: { 'nvidia.com/gpu': '1' } } }],
      },
      prefill: {
        replicas: 3,
        template: {
          containers: [{ name: 'main', resources: { limits: { 'nvidia.com/gpu': '2' } } }],
        },
      },
      router: { scheduler: {}, route: {}, gateway: {} },
    },
    status: {
      url: 'http://gw.example/ai/gpt-oss-20b',
      conditions: [{ type: 'Ready', status: 'True' }],
      workloads: { primary: { readyReplicas: 2 } },
    },
  };

  it('maps model, routing features and GPUs', () => {
    const ep = fromLLMInferenceService(llm);
    expect(ep).toMatchObject({
      slug: 'llm',
      servedModelName: 'RedHatAI/gpt-oss-20b',
      engine: 'vLLM · llm-d',
      replicas: 2,
      readyReplicas: 2,
      gpusPerReplica: 1,
      totalGpus: 2 * 1 + 3 * 2,
      profiles: ['llmisvc-config-pd-disagg'],
      url: 'http://gw.example/ai/gpt-oss-20b',
    });
    expect(ep.status.health).toBe('ready');
    expect(ep.features.map(f => f.id)).toEqual(expect.arrayContaining(['scheduler', 'pd']));
    expect(ep.model.provider?.id).toBe('openai');
  });

  it('reports stopped endpoints', () => {
    const stopped = {
      ...llm,
      metadata: { ...llm.metadata, annotations: { 'serving.kserve.io/stop': 'true' } },
    };
    expect(fromLLMInferenceService(stopped).status.health).toBe('stopped');
  });
});

describe('fromInferenceService', () => {
  const isvc: InferenceServiceJson = {
    apiVersion: 'serving.kserve.io/v1beta1',
    kind: 'InferenceService',
    metadata: { name: 'qwen', namespace: 'ai' },
    spec: {
      predictor: {
        minReplicas: 1,
        maxReplicas: 3,
        model: {
          modelFormat: { name: 'huggingface' },
          storageUri: 'hf://Qwen/Qwen2.5-0.5B-Instruct',
          args: ['--model_name=qwen-chat'],
          resources: { requests: { 'nvidia.com/gpu': '1' } },
        },
      },
    },
    status: {
      servingRuntimeName: 'kserve-huggingfaceserver',
      conditions: [{ type: 'Ready', status: 'False', reason: 'Pending' }],
      modelStatus: {
        transitionStatus: 'BlockedByFailedLoad',
        lastFailureInfo: { reason: 'ModelLoadFailed', message: 'CUDA out of memory' },
      },
    },
  };

  it('maps runtime, served name and failures', () => {
    const ep = fromInferenceService(isvc);
    expect(ep).toMatchObject({
      slug: 'isvc',
      servedModelName: 'qwen-chat',
      engine: 'Huggingface · kserve-huggingfaceserver',
      minReplicas: 1,
      maxReplicas: 3,
      gpusPerReplica: 1,
    });
    expect(ep.status).toMatchObject({ health: 'failed', reason: 'ModelLoadFailed' });
    expect(ep.features.map(f => f.id)).toContain('autoscale');
  });
});

describe('pods', () => {
  it('builds selectors and roles', () => {
    expect(podSelector({ kind: 'LLMInferenceService', name: 'x' })).toBe(
      'app.kubernetes.io/name=x,app.kubernetes.io/part-of=llminferenceservice'
    );
    expect(podSelector({ kind: 'InferenceService', name: 'x' })).toBe(
      'serving.kserve.io/inferenceservice=x'
    );
    expect(podRole({ 'app.kubernetes.io/component': 'llminferenceservice-router-scheduler' })).toBe(
      'Scheduler'
    );
    expect(podRole({ 'app.kubernetes.io/component': 'llminferenceservice-workload-prefill' })).toBe(
      'Prefill'
    );
    expect(
      podRole({
        'app.kubernetes.io/component': 'llminferenceservice-workload',
        'llm-d.ai/role': 'decode',
      })
    ).toBe('Decode');
    expect(podRole({ component: 'predictor' })).toBe('Predictor');
  });
});
