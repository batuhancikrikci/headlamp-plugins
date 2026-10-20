import { fromLLMInferenceService } from './endpoint';
import { podGpus, podHealth, PodJson } from './pod';
import { endpointsUsingProfile, summarizeProfile } from './profile';

function pod(status: PodJson['status'], extra: Partial<PodJson> = {}): PodJson {
  return {
    metadata: { name: 'p', namespace: 'ai' },
    spec: {
      containers: [{ name: 'main', resources: { limits: { 'nvidia.com/gpu': '2' } } }],
    },
    status,
    ...extra,
  };
}

describe('podHealth', () => {
  it('is ready when running with all containers ready', () => {
    expect(
      podHealth(
        pod({
          phase: 'Running',
          containerStatuses: [{ name: 'main', ready: true, restartCount: 0 }],
        })
      ).health
    ).toBe('ready');
  });

  it('reports image pull and crash loops as failures', () => {
    const pulling = pod({
      phase: 'Pending',
      containerStatuses: [
        {
          name: 'main',
          ready: false,
          restartCount: 0,
          state: { waiting: { reason: 'ImagePullBackOff', message: 'not found' } },
        },
      ],
    });
    expect(podHealth(pulling)).toMatchObject({ health: 'failed', reason: 'ImagePullBackOff' });
    const crashing = pod({
      phase: 'Running',
      containerStatuses: [
        {
          name: 'main',
          ready: false,
          restartCount: 7,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
        },
      ],
    });
    expect(podHealth(crashing).health).toBe('failed');
  });

  it('reports unschedulable pods (e.g. no free GPU) as failures', () => {
    const p = pod({
      phase: 'Pending',
      conditions: [
        {
          type: 'PodScheduled',
          status: 'False',
          reason: 'Unschedulable',
          message: '0/3 nodes are available: 3 Insufficient nvidia.com/gpu.',
        },
      ],
    });
    expect(podHealth(p)).toMatchObject({ health: 'failed', reason: 'Unschedulable' });
  });

  it('treats a starting model server as progressing', () => {
    const p = pod({
      phase: 'Running',
      containerStatuses: [{ name: 'main', ready: false, restartCount: 0, state: { running: {} } }],
    });
    expect(podHealth(p).health).toBe('progressing');
  });

  it('counts GPUs', () => {
    expect(podGpus(pod({}))).toBe(2);
  });
});

describe('serving profiles', () => {
  const profile = {
    apiVersion: 'serving.kserve.io/v1alpha2',
    kind: 'LLMInferenceServiceConfig',
    metadata: { name: 'long-context', namespace: 'ai' },
    spec: {
      template: {
        containers: [
          {
            name: 'main',
            image: 'vllm/vllm-openai:v0.30.0',
            env: [{ name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len=32768' }],
          },
        ],
      },
      router: { scheduler: {} },
    },
  };

  it('summarizes what a profile configures', () => {
    const summary = summarizeProfile(profile);
    expect(summary).toMatchObject({
      builtIn: false,
      image: 'vllm/vllm-openai:v0.30.0',
      extraArgs: '--max-model-len=32768',
    });
    expect(summary.aspects.map(a => a.id)).toEqual(['server', 'scheduler']);
    expect(
      summarizeProfile({ ...profile, metadata: { name: 'kserve-config-llm-template' } }).builtIn
    ).toBe(true);
  });

  it('finds services by baseRefs or applied configs', () => {
    const referencing = fromLLMInferenceService({
      metadata: { name: 'a', namespace: 'ai' },
      spec: { baseRefs: [{ name: 'long-context' }] },
    });
    const otherNamespace = fromLLMInferenceService({
      metadata: { name: 'b', namespace: 'other' },
      spec: { baseRefs: [{ name: 'long-context' }] },
    });
    const applied = fromLLMInferenceService({
      metadata: { name: 'c', namespace: 'ai' },
      status: { appliedConfigs: [{ name: 'long-context', namespace: 'ai', source: 'UserRef' }] },
    });
    const summary = summarizeProfile(profile);
    expect(
      endpointsUsingProfile(summary, [referencing, otherNamespace, applied]).map(e => e.name)
    ).toEqual(['a', 'c']);
  });
});
