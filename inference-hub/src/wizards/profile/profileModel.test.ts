import { buildProfile, defaultProfileForm, ProfileForm, validateProfile } from './profileModel';

const V = 'serving.kserve.io/v1alpha2';
const form = (patch: Partial<ProfileForm>): ProfileForm => ({
  ...defaultProfileForm('ai'),
  name: 'long-ctx',
  ...patch,
});

describe('serving profile form', () => {
  it('requires at least one option and valid values', () => {
    expect(validateProfile(form({}))).toHaveProperty('extraArgs');
    expect(validateProfile(form({ extraArgs: '--max-model-len=32768' }))).toEqual({});
    expect(validateProfile(form({ name: 'Bad Name', extraArgs: 'x' }))).toHaveProperty('name');
    expect(validateProfile(form({ setResources: true, memory: 'lots' }))).toHaveProperty('memory');
  });

  it('builds only the configured parts', () => {
    expect(
      buildProfile(
        form({ extraArgs: '--enable-prefix-caching', description: 'Prefix caching on' }),
        V
      )
    ).toEqual({
      apiVersion: V,
      kind: 'LLMInferenceServiceConfig',
      metadata: {
        name: 'long-ctx',
        namespace: 'ai',
        labels: { 'app.kubernetes.io/managed-by': 'inference-hub' },
        annotations: { 'inference-hub.batuhancikrikci.github.io/description': 'Prefix caching on' },
      },
      spec: {
        template: {
          containers: [
            {
              name: 'main',
              env: [{ name: 'VLLM_ADDITIONAL_ARGS', value: '--enable-prefix-caching' }],
            },
          ],
        },
      },
    });
  });

  it('adds resources, tensor parallelism, routing and a prefill pool', () => {
    const profile = buildProfile(
      form({
        setResources: true,
        gpus: 4,
        routing: 'scheduler',
        prefillReplicas: 2,
        gpuProduct: 'NVIDIA-H100-80GB-HBM3',
      }),
      V
    );
    const spec = profile.spec as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(spec.parallelism).toEqual({ tensor: 4 });
    expect(spec.router).toEqual({ scheduler: {}, route: {}, gateway: {} });
    expect(spec.template.containers[0].resources.limits['nvidia.com/gpu']).toBe('4');
    expect(spec.template.nodeSelector).toEqual({
      'nvidia.com/gpu.product': 'NVIDIA-H100-80GB-HBM3',
    });
    expect(spec.prefill.replicas).toBe(2);
    expect(spec.prefill.parallelism).toEqual({ tensor: 4 });
  });
});
